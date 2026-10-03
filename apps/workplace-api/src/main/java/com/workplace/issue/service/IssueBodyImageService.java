package com.workplace.issue.service;

import com.workplace.drive.service.DriveQuotaService;
import com.workplace.file.api.ImageSniffer;
import com.workplace.global.util.UnicodeNames;
import com.workplace.issue.dto.IssueBodyImageResponse;
import com.workplace.issue.exception.AttachmentNotFoundException;
import com.workplace.issue.exception.IssueBodyImageLimitException;
import com.workplace.issue.exception.IssueBodyImageRejectedException;
import com.workplace.issue.repository.IssueBodyImageRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.service.ProjectAccessGuard;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 이슈 본문 이미지(WP-199) — 업로드·조회 인가·저장 시 본문 동기화.
 *
 * <p>이슈 생성 다이얼로그에서도 올려야 하므로 업로드는 이슈 없이 "이 프로젝트에 이슈를 만들 수 있는가" 로 판정한다. 실제로 이슈에 붙는 시점(syncWithBody)은
 * IssueService 의 생성/본문 편집 가드를 통과한 뒤라, 편집 권한이 없는 사람이 올린 이미지는 어느 이슈에도 붙지 못하고 만료로 수거된다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueBodyImageService {

  private final ProjectAccessGuard accessGuard;
  private final IssueAttachmentStorage storage;
  private final IssueBodyImageRepository repo;
  private final IssueRepository issueRepository;
  // 테넌트 쿼터 — 위키 본문 이미지(#759)와 같이 드라이브 쿼터·잠금을 공유한다.
  private final DriveQuotaService quota;

  @Value("${workplace.storage.issue-image.max-file-size-bytes:10485760}")
  private long maxFileSizeBytes;

  @Value("${workplace.storage.issue-image.max-pending-per-user:50}")
  private int maxPendingPerUser;

  // 본문에서 빠진 이미지를 바로 지우지 않고 유예 후 수거 — 되돌리기·재삽입·동시 편집 여유.
  @Value("${workplace.storage.issue-image.demote-grace-hours:168}")
  private int demoteGraceHours;

  /**
   * 저장된 본문과 이미지 연결 상태를 맞춘다 — 참조된 것은 이 이슈에 연결(만료 해제), 빠진 것은 강등(유예 후 만료 재무장).
   *
   * <p>호출자 계약: 인가하지 않는다. IssueService.create/update 가 생성·본문 편집 권한을 통과시킨 뒤 같은 트랜잭션에서 호출한다. 연결 대상은 "이
   * 프로젝트에 내가 올린 미연결 임시 파일" 또는 "이미 이 이슈 것" 뿐이라, 본문에 남의 id 를 적어도 만료를 풀거나 소유를 옮길 수 없다. 대상이 아닌 id·이미
   * 수거된 id 는 건너뛰고 저장은 실패시키지 않는다(며칠 지난 초안 저장 등) — 화면은 "불러올 수 없음" 으로 표시된다.
   */
  public void syncWithBody(ProjectRow project, long issueId, long callerId, String body) {
    Set<Long> referenced = referencedFileIds(project.key(), body);
    List<Long> claimable = repo.lockClaimable(project.id(), issueId, callerId, referenced);
    repo.claim(issueId, claimable);
    List<Long> dropped =
        repo.fileIdsOfIssue(issueId).stream().filter(id -> !referenced.contains(id)).toList();
    repo.demote(dropped, OffsetDateTime.now(ZoneOffset.UTC).plusHours(demoteGraceHours));
  }

  /** 본문에서 이 프로젝트 키의 이미지 참조 fileId 를 뽑는다. 키는 그대로 인용한다(PERSONAL 키는 자동 생성이라 문자 집합을 가정하지 않음). */
  private static Set<Long> referencedFileIds(String projectKey, String body) {
    Set<Long> ids = new LinkedHashSet<>();
    if (body == null || body.isBlank()) return ids;
    // \d{1,19}: Long.MAX_VALUE 자릿수. 범위를 넘는 값은 parseLong 이 던지므로 건너뛴다 — 본문은 자유 텍스트라 저장이 깨지면 안 된다.
    Matcher m =
        Pattern.compile(
                "/api/v1/projects/" + Pattern.quote(projectKey) + "/issue-images/(\\d{1,19})")
            .matcher(body);
    while (m.find()) {
      try {
        ids.add(Long.parseLong(m.group(1)));
      } catch (NumberFormatException ignored) {
        // overflow — 무시
      }
    }
    return ids;
  }

  /** 업로드 — 이슈 생성 가능자. 매직바이트로 이미지인지 판정하고 임시 파일 + 미연결 매핑으로 저장한다. */
  public IssueBodyImageResponse upload(long callerId, String projectKey, MultipartFile file) {
    var project = accessGuard.assertIssueCreatable(projectKey, callerId);
    if (file.isEmpty()) throw new IssueBodyImageRejectedException("빈 파일입니다.");
    if (file.getSize() > maxFileSizeBytes) {
      throw new IssueBodyImageRejectedException("이미지는 10MB 까지 올릴 수 있습니다.");
    }
    // Content-Type 은 위조 가능 — 앞부분 바이트로 판정한다(getInputStream 은 호출마다 새 스트림이라 저장 스트림을 소비하지 않음).
    byte[] head;
    try (InputStream in = file.getInputStream()) {
      head = in.readNBytes(ImageSniffer.HEAD_BYTES);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    String mime =
        ImageSniffer.detect(head)
            .orElseThrow(
                () -> new IssueBodyImageRejectedException("PNG·JPEG·GIF·WebP 이미지만 올릴 수 있습니다."));
    // 저장 없이 업로드만 반복하는 남용 차단 — 저장(연결)하거나 하루 지나 수거되면 풀린다.
    if (repo.countPending(project.id(), callerId) >= maxPendingPerUser) {
      throw new IssueBodyImageLimitException("저장하지 않은 이미지가 너무 많습니다. 이슈를 저장한 뒤 다시 시도하세요.");
    }
    quota.assertWithinQuotaLocked(file.getSize());

    Long fileId = storage.storeTemporaryImage(file, callerId, mime);
    repo.insertPending(fileId, project.id(), callerId);
    String name =
        file.getOriginalFilename() != null && !file.getOriginalFilename().isBlank()
            ? UnicodeNames.toNfc(file.getOriginalFilename())
            : "image";
    return new IssueBodyImageResponse(
        fileId, IssueBodyImageResponse.urlOf(project.key(), fileId), name, mime, file.getSize());
  }

  /**
   * 본문 표시용 조회. 프로젝트 키로 조회 권한을 보고, 파일이 실제로 그 프로젝트의 이슈 이미지인지는 매핑으로 따로 확인한다 — 키만 보면 아무 OPEN 프로젝트 키를 붙여
   * 다른 프로젝트 파일을 열 수 있다(IDOR). 존재 여부를 숨기려고 불일치는 모두 404 로 통일한다.
   */
  @Transactional(readOnly = true)
  public IssueAttachmentStorage.StoredFile load(long callerId, String projectKey, long fileId) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var meta =
        repo.findMeta(fileId)
            // ProjectRow.id() 는 Long — 박싱 비교 오류를 피하려고 equals 사용.
            .filter(m -> project.id().equals(m.projectId()))
            .orElseThrow(() -> new AttachmentNotFoundException(fileId));
    if (meta.issueId() == null) {
      // 저장 전 임시 이미지는 올린 사람만 — 남의 작성 중 이미지를 id 추측으로 보지 못하게.
      if (meta.uploadedBy() != callerId) throw new AttachmentNotFoundException(fileId);
    } else if (issueRepository.findById(meta.issueId()).isEmpty()) {
      // 삭제된 이슈의 이미지는 내리지 않는다.
      throw new AttachmentNotFoundException(fileId);
    }
    return storage.load(fileId);
  }
}
