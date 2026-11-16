package com.workplace.issue.service;

import com.workplace.drive.api.DriveFileUsage;
import com.workplace.drive.service.DriveQuotaService;
import com.workplace.file.api.ImageSniffer;
import com.workplace.file.api.StagedFile;
import com.workplace.file.api.StagedFileClaimer;
import com.workplace.file.exception.StagedFileUnusableException;
import com.workplace.global.util.SafeFileNames;
import com.workplace.issue.dto.IssueBodyImageResponse;
import com.workplace.issue.dto.IssueTextLimits;
import com.workplace.issue.exception.AttachmentNotFoundException;
import com.workplace.issue.exception.IssueBodyImageLimitException;
import com.workplace.issue.exception.IssueBodyImageRejectedException;
import com.workplace.issue.repository.IssueBodyImageRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.service.ProjectAccessGuard;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 이슈 본문·코멘트 이미지(WP-199, WP-362) — 업로드·조회 인가·저장 시 연결 동기화.
 *
 * <p>이슈 생성 다이얼로그에서도 올려야 하므로 업로드는 이슈 없이 "이 프로젝트에 이슈를 만들 수 있는가" 로 판정한다. 실제로 이슈에 붙는
 * 시점(syncIssueImages)은 IssueService·IssueCommentService 의 생성/편집 가드를 통과한 뒤라, 편집 권한이 없는 사람이 올린 이미지는
 * 어느 이슈에도 붙지 못하고 만료로 수거된다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueBodyImageService {

  private final ProjectAccessGuard accessGuard;
  private final IssueAttachmentStorage storage;
  private final IssueBodyImageRepository repo;
  // 테넌트 쿼터 — 위키 본문 이미지(#759)와 같이 드라이브 쿼터·잠금을 공유한다.
  private final DriveQuotaService quota;
  // 드라이브로 가져간 본문 이미지(WP-1392)는 drive_file 이 같은 file 행을 쓴다 — 강등에서 빼려고 묻는다(WP-722 와 같은 포트).
  private final DriveFileUsage driveFileUsage;
  // 본문 자리표시(WP-1634) — upload_file 로 올린 스테이징 파일의 소유·만료·미바인딩을 검사하고 잠근다.
  private final StagedFileClaimer stagedFileClaimer;

  @Value("${workplace.storage.issue-image.max-file-size-bytes:10485760}")
  private long maxFileSizeBytes;

  @Value("${workplace.storage.issue-image.max-pending-per-user:50}")
  private int maxPendingPerUser;

  // 본문에서 빠진 이미지를 바로 지우지 않고 유예 후 수거 — 되돌리기·재삽입·동시 편집 여유.
  @Value("${workplace.storage.issue-image.demote-grace-hours:168}")
  private int demoteGraceHours;

  /**
   * 이슈의 이미지 연결 상태를 맞춘다 — 방금 저장한 글(본문 또는 코멘트)에 새로 들어간 것은 이 이슈에 연결(만료 해제)하고, 이전 글에 있던 것이 본문·살아 있는 코멘트
   * 어디에도 남지 않았으면 강등(유예 후 만료 재무장)한다.
   *
   * <p>왜 이슈 단위인가(WP-362): 코멘트 이미지도 본문 이미지와 같은 이슈에 연결된다. 본문만 보고 빠진 것을 강등하면 본문을 고칠 때 코멘트 이미지가, 코멘트만
   * 보면 코멘트를 고칠 때 본문 이미지가 사라진다.
   *
   * <p>건너뛰기: 이전·새 글 모두 이미지 참조가 없으면(대부분의 저장) 아무 쿼리도 하지 않는다. 이전 글에 참조가 없으면 새로 빠질 것도 없으므로 강등 판정(이슈의 모든
   * 글 읽기)을 생략한다 — 코멘트 작성은 연결만 한다.
   *
   * <p>호출자 계약: 인가하지 않는다. IssueService(본문 생성·편집)·IssueCommentService(코멘트 작성·수정·삭제)가 권한을 통과시키고 글을 저장한
   * 뒤 같은 트랜잭션에서 호출한다. 연결 대상은 "이 프로젝트에 내가 올린 미연결 임시 파일" 또는 "이미 이 이슈 것" 뿐이라, 글에 남의 id 를 적어도 만료를 풀거나
   * 소유를 옮길 수 없다. 대상이 아닌 id·이미 수거된 id 는 건너뛰고 저장은 실패시키지 않는다(며칠 지난 초안 저장 등) — 화면은 "불러올 수 없음" 으로 표시된다.
   *
   * @param beforeText 저장 전 글 — 새로 만든 글이면 null
   * @param savedText 방금 저장한 글 — 코멘트 삭제처럼 새 글이 없으면 null
   */
  public void syncIssueImages(
      ProjectRow project, long issueId, long callerId, String beforeText, String savedText) {
    boolean mayDrop = IssueBodyImageResponse.mayReferenceImages(beforeText);
    if (!mayDrop && !IssueBodyImageResponse.mayReferenceImages(savedText)) return;
    repo.lockIssue(issueId);
    Set<Long> added = IssueBodyImageResponse.idsIn(savedText, project.key());
    repo.claim(issueId, repo.lockClaimable(project.id(), issueId, callerId, added));
    if (!mayDrop) return;
    Set<Long> referenced = new HashSet<>();
    for (String text : repo.textsReferencingImages(issueId)) {
      referenced.addAll(IssueBodyImageResponse.idsIn(text, project.key()));
    }
    List<Long> dropped =
        repo.fileIdsOfIssue(issueId).stream().filter(id -> !referenced.contains(id)).toList();
    demote(dropped);
  }

  /**
   * 본문 자리표시 해석 결과(WP-1634).
   *
   * @param body 자리표시를 실제 주소·표기로 바꾼 본문 — 저장·이벤트·이미지 연결에 이 값을 쓴다
   * @param attachmentFileIds 이미지가 아니라 이슈 첨부로 붙여야 할 스테이징 파일 id(본문 순서, 중복 없음) — 이슈 행이 있어야 붙일 수 있어
   *     호출자가 저장 뒤 같은 트랜잭션에서 {@link IssueAttachmentService#attachStaged} 로 붙인다
   */
  public record ResolvedBody(String body, List<Long> attachmentFileIds) {}

  /**
   * 본문·댓글의 스테이징 파일 자리표시({@code ![설명](file:123)}, {@code [이름](file:123)})를 해석한다(WP-1634).
   *
   * <p>왜: MCP(외부 AI)는 이미지 바이트를 본문에 넣을 수 없어 upload_file 로 올린 fileId 를 원하는 자리에 적는다. 이미지는 그 파일을 이
   * 프로젝트의 본문 이미지(미연결 임시 매핑, 업로더=호출자)로 넘겨받고 웹과 같은 {@code /issue-images/{fileId}} 주소로 바꾼다 — 이어지는
   * {@link #syncIssueImages} 가 이슈에 연결·만료 해제한다. 이미지가 아닌 파일은 이슈 첨부로 붙이도록 돌려주고, 그 자리는 굵은 파일 이름 + 「(첨부
   * 파일)」로 바꾼다 (웹에 첨부 하나를 여는 주소가 없고, API 주소 링크는 인증 헤더가 없어 열리지 않는다).
   *
   * <p>파일을 복사하지 않고 같은 file 행을 넘겨받는다 — 저장소 객체가 하나라 지우는 경로도 만료 스윕 하나다. 클레임은 KEEP_TEMPORARY(만료 유지)로
   * file 행을 잠근 채 소유(호출자)·범주(ATTACHMENT)·만료 전·어디에도 묶이지 않음을 검사한다. 남의 파일 번호를 적어도 가져갈 수 없다.
   *
   * <p>같은 번호가 여러 번 나오면 한 번만 옮기고 모두 같은 주소로 바꾼다. 코드 블록·인라인 코드 안은 건드리지 않는다({@link
   * IssueBodyFilePlaceholders}). 자리표시가 없으면(웹 편집기 저장 등) 쿼리 없이 그대로 돌려준다.
   *
   * <p>호출자 계약: 인가하지 않는다 — 이슈 만들기·고치기·댓글 쓰기의 가드를 통과한 뒤, 글을 저장하기 전에 같은 쓰기 트랜잭션에서 부른다. 어느 번호든 못 쓰면 예외로
   * 트랜잭션이 롤백돼 글도 파일 이동도 남지 않는다.
   *
   * @throws IssueBodyImageRejectedException 쓸 수 없는 번호(남의·없는·만료·이미 붙인 파일)·크기 상한을 넘는 이미지·바꾼 본문이 길이
   *     상한을 넘음(400)
   */
  public ResolvedBody resolveStagedPlaceholders(ProjectRow project, long callerId, String body) {
    List<IssueBodyFilePlaceholders.Placeholder> found = IssueBodyFilePlaceholders.find(body);
    if (found.isEmpty()) return new ResolvedBody(body, List.of());

    Set<Long> ids = new LinkedHashSet<>();
    for (var p : found) {
      ids.add(parseId(p.rawId()));
    }
    List<StagedFile> staged;
    try {
      staged =
          stagedFileClaimer.claim(
              callerId, List.copyOf(ids), StagedFileClaimer.Retention.KEEP_TEMPORARY);
    } catch (StagedFileUnusableException e) {
      // 클레임 공용 처리기는 번호를 응답에서 숨기지만(남의 id 떠보기 방지), 여기 번호는 호출자가 본문에 직접 적은 값이라 알려 줘도 새는 것이 없다 —
      // 원인은 하나의 문구로 묶어 남의 파일·없는 파일·만료를 가르지 않는다.
      throw unusable(String.valueOf(e.fileId()));
    }

    // 파일마다 바꿔 넣을 글 — 이미지는 본문 이미지 주소, 그 밖은 굵은 이름.
    Map<Long, String> images = new HashMap<>();
    Map<Long, String> others = new HashMap<>();
    List<Long> attachments = new ArrayList<>();
    for (StagedFile f : staged) {
      byte[] head = storage.readHead(f.fileId(), f.storagePath(), ImageSniffer.HEAD_BYTES);
      Optional<String> mime = ImageSniffer.detect(head);
      if (mime.isPresent()) {
        if (f.sizeBytes() > maxFileSizeBytes) {
          throw new IssueBodyImageRejectedException(
              "본문의 file:"
                  + f.fileId()
                  + "("
                  + f.originalName()
                  + ") 이미지는 "
                  + maxFileSizeBytes / (1024 * 1024)
                  + "MB 까지 넣을 수 있어요.");
        }
        // 웹 업로드 본문 이미지와 같은 모양으로 바꾸고 미연결 임시 매핑을 단다 — 이 뒤로는 웹에서 올린 이미지와 똑같이 연결·강등·수거된다.
        storage.adoptStagedAsImage(f.fileId(), mime.get());
        repo.insertPending(f.fileId(), project.id(), callerId);
        images.put(f.fileId(), IssueBodyImageResponse.urlOf(project.key(), f.fileId()));
      } else {
        attachments.add(f.fileId());
        others.put(f.fileId(), "**" + escapeMarkdown(f.originalName()) + "** (첨부 파일)");
      }
    }

    StringBuilder out = new StringBuilder(body.length() + found.size() * 48);
    int cursor = 0;
    for (var p : found) {
      long id = Long.parseLong(p.rawId());
      out.append(body, cursor, p.start());
      String url = images.get(id);
      // 링크 꼴로 적은 이미지도 본문 이미지로 넣는다 — issue-images 주소는 인증 헤더가 있어야 열려 링크로는 쓸 수 없다.
      out.append(url != null ? "![" + p.alt() + "](" + url + ")" : others.get(id));
      cursor = p.end();
    }
    out.append(body, cursor, body.length());

    // 주소가 자리표시보다 길어 요청 검증(BODY_MAX)을 지난 본문이 상한을 넘을 수 있다 — 저장 전에 다시 본다.
    if (out.length() > IssueTextLimits.BODY_MAX) {
      throw new IssueBodyImageRejectedException(
          "파일 자리표시를 주소로 바꾸면 본문이 " + IssueTextLimits.BODY_MAX + "자를 넘어요. 본문을 줄여 주세요.");
    }
    return new ResolvedBody(out.toString(), List.copyOf(attachments));
  }

  /** 자리표시 번호 해석 — 19자리지만 Long 범위를 넘는 값은 있을 수 없는 파일이라 같은 거절 문구로 알린다. */
  private static long parseId(String rawId) {
    try {
      return Long.parseLong(rawId);
    } catch (NumberFormatException e) {
      throw unusable(rawId);
    }
  }

  private static IssueBodyImageRejectedException unusable(String id) {
    return new IssueBodyImageRejectedException(
        "본문의 file:"
            + id
            + " 은 넣을 수 없어요 — 내가 올렸고 아직 어디에도 붙이지 않은, 24시간이 지나지 않은 파일만 넣을 수 있어요. 파일을 다시 올려 주세요.");
  }

  /** 파일 이름의 마크다운 특수 문자를 이스케이프한다 — 이름의 *·_·[ 등이 굵게·링크를 깨지 않게. */
  private static String escapeMarkdown(String name) {
    return name.replaceAll("([\\\\`*_\\[\\]<>#~|])", "\\\\$1");
  }

  /**
   * 가져오기(WP-883) — 새로 가져온 글(본문 또는 댓글)이 참조하는 이미지를 이 이슈에 연결하고 올린 사람·시각을 원본 값으로 되돌린다. 대상은 호출자가 올린 미연결
   * 임시 이미지뿐이다(남의 id 는 건너뜀). 이미 이 이슈에 붙은 이미지는 다시 되돌리지 않는다 — 본문과 댓글이 같은 이미지를 가리키면 처음 붙인 글(본문 → 댓글 순)의
   * 작성자·시각이 남는다. 새 글이라 강등 판정은 없다. 인가하지 않는다 — 호출자(가져오기 서비스)가 관리자 여부를 이미 확인했다.
   *
   * @param uploadedBy 원래 글 작성자, at 원래 글 시각
   */
  public void claimForImport(
      ProjectRow project,
      long issueId,
      long callerId,
      String text,
      long uploadedBy,
      OffsetDateTime at) {
    if (!IssueBodyImageResponse.mayReferenceImages(text)) return;
    repo.lockIssue(issueId);
    Set<Long> ids = IssueBodyImageResponse.idsIn(text, project.key());
    // 이번에 처음 붙는 것(호출자가 올린 미연결 임시 이미지)만 — 앞선 본문·댓글이 이미 붙인 이미지는 그 글의 작성자·시각을 지킨다.
    List<Long> pending = repo.lockPendingOf(project.id(), callerId, ids);
    repo.claim(issueId, pending);
    repo.reassign(issueId, pending, uploadedBy, at);
  }

  /** 강등·보존 시 새로 걸 만료 시각(지금 + 유예) — 강등과 스윕 보존 정책이 같은 유예를 쓰도록 한 곳에서 계산한다. */
  public OffsetDateTime graceExpiry() {
    return OffsetDateTime.now(ZoneOffset.UTC).plusHours(demoteGraceHours);
  }

  /**
   * 삭제된 이슈들에 연결된 본문 이미지를 모두 강등한다 — 유예 후 만료 재무장.
   *
   * <p>왜: 이슈가 soft-delete 되면 syncIssueImages 가 다시 불리지 않아 이미지의 만료가 영영 해제 상태로 남아 저장 공간이 샌다. 다른 이슈 본문에
   * 복사돼 아직 참조 중이면 스윕 시점의 보존 정책이 만료를 다시 미룬다. 호출자(IssueService.softDelete)가 부모+자식 id 를 함께 넘긴다.
   */
  public void demoteAllOfIssues(Collection<Long> issueIds) {
    if (issueIds.isEmpty()) return;
    List<Long> fileIds = repo.fileIdsOfIssues(issueIds);
    demote(fileIds);
  }

  /**
   * 강등 — 모두 강등 표시(demoted_at)하되, 만료 재무장은 드라이브가 쓰지 않는 이미지에만 한다(WP-1392).
   *
   * <p>왜 나누나: 강등 표시는 「이 이슈에서 더 이상 보이지 않음」이라 드라이브 사용과 무관하게 찍어야 첨부 모아보기에서 빠지고 드라이브 영구 삭제 보호(보이는
   * 첨부)에서도 풀린다. 반면 가져오기는 file 행을 복사하지 않고 drive_file 이 같은 행을 가리키게 하므로(만료도 해제), 그 file 에 만료를 다시 걸면 만료
   * 스윕이 드라이브 파일의 원본까지 지운다 — 이슈 첨부 삭제가 드라이브 사용 중인 file 은 연결만 끊는 것(WP-722)과 같은 규칙으로, 그 file 의 회수는
   * 드라이브가 맡는다. 본문 매핑은 그대로 남아 이슈에 다시 넣으면 claim 이 표시를 지운다.
   */
  private void demote(List<Long> fileIds) {
    if (fileIds.isEmpty()) return;
    Set<Long> inDrive = driveFileUsage.referencedAmong(fileIds);
    repo.demote(fileIds.stream().filter(id -> !inDrive.contains(id)).toList(), graceExpiry());
    repo.markDemoted(inDrive);
  }

  /** 업로드 — 이슈 생성 가능자. 매직바이트로 이미지인지 판정하고 임시 파일 + 미연결 매핑으로 저장한다. */
  public IssueBodyImageResponse upload(long callerId, String projectKey, MultipartFile file) {
    var project = accessGuard.assertIssueCreatable(projectKey, callerId);
    if (file.isEmpty()) throw new IssueBodyImageRejectedException("빈 파일입니다.");
    if (file.getSize() > maxFileSizeBytes) {
      // 한도 문구는 설정값에서 만든다 — 설정을 바꿔도 안내가 어긋나지 않게.
      throw new IssueBodyImageRejectedException(
          "이미지는 " + maxFileSizeBytes / (1024 * 1024) + "MB 까지 올릴 수 있습니다.");
    }
    // Content-Type 은 위조 가능 — 앞부분 매직바이트로 판정한다.
    String mime =
        ImageSniffer.detectUpload(file)
            .orElseThrow(
                () -> new IssueBodyImageRejectedException("PNG·JPEG·GIF·WebP 이미지만 올릴 수 있습니다."));
    // 저장 없이 업로드만 반복하는 남용 차단 — 저장(연결)하거나 하루 지나 수거되면 풀린다.
    if (repo.countPending(project.id(), callerId) >= maxPendingPerUser) {
      throw new IssueBodyImageLimitException("저장하지 않은 이미지가 너무 많습니다. 이슈를 저장한 뒤 다시 시도하세요.");
    }
    quota.assertWithinQuotaLocked(file.getSize());

    // 저장 이름과 응답 이름이 어긋나지 않게 한 번만 계산해 함께 쓴다.
    // 경로 구분자·제어 문자는 "_" 로, 빈 이름은 대체 이름으로(WP-737).
    String name = SafeFileNames.sanitize(file.getOriginalFilename(), "image");
    Long fileId = storage.storeTemporaryImage(file, callerId, mime, name);
    repo.insertPending(fileId, project.id(), callerId);
    return new IssueBodyImageResponse(
        fileId, IssueBodyImageResponse.urlOf(project.key(), fileId), name, mime, file.getSize());
  }

  /**
   * 본문 표시용 조회. 프로젝트 키로 조회 권한을 보고, 파일이 실제로 그 프로젝트의 이슈 이미지인지는 매핑으로 따로 확인한다 — 키만 보면 아무 OPEN 프로젝트 키를 붙여
   * 다른 프로젝트 파일을 열 수 있다(IDOR). 존재 여부를 숨기려고 불일치는 모두 404 로 통일한다.
   *
   * <p>연결된 이미지는 원본 이슈가 soft-delete 되어도 조회 권한만 있으면 열린다: 본문을 복사해 다른 이슈에 붙여넣은 사본이 원본 삭제로 깨지면 안 되기
   * 때문이다. 원본 삭제 시 저장 공간 회수는 {@link #demoteAllOfIssues} 의 강등 + 보존 정책(다른 이슈 본문 참조 확인)이 맡는다. 미연결 임시
   * 이미지는 올린 사람만 볼 수 있다.
   */
  @Transactional(readOnly = true)
  public IssueAttachmentStorage.StoredFile load(long callerId, String projectKey, long fileId) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var meta =
        repo.findMeta(fileId)
            // ProjectRow.id() 는 Long — 박싱 비교 오류를 피하려고 equals 사용.
            .filter(m -> project.id().equals(m.projectId()))
            .orElseThrow(() -> new AttachmentNotFoundException(fileId));
    // 저장 전 임시 이미지는 올린 사람만 — 남의 작성 중 이미지를 id 추측으로 보지 못하게.
    if (meta.issueId() == null && meta.uploadedBy() != callerId) {
      throw new AttachmentNotFoundException(fileId);
    }
    // 연결된 이미지는 원본 이슈의 삭제 여부와 무관하게 서빙한다 — 다른 이슈 본문에 복사된 사본이 원본 삭제로 깨지면 안 된다.
    return storage.load(fileId);
  }
}
