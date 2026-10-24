package com.workplace.issue.service;

import com.workplace.drive.api.DriveFileUsage;
import com.workplace.file.api.StagedFile;
import com.workplace.file.api.StagedFileClaimer;
import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
import com.workplace.fileai.service.ExtractedTextService;
import com.workplace.issue.dto.IssueAttachmentResponse;
import com.workplace.issue.exception.AttachmentLimitExceededException;
import com.workplace.issue.exception.AttachmentNotFoundException;
import com.workplace.issue.exception.AttachmentTooLargeException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueAttachmentRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectAccessGuard;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/** 이슈 첨부 라이프사이클 — 멤버/한도/사이즈 가드 + history 기록. */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueAttachmentService {

  private final IssueAttachmentRepository repo;
  private final IssueAttachmentStorage storage;
  private final IssueRepository issueRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueHistoryRecorder historyRecorder;
  private final IssueChangeNotifier changeNotifier;
  private final ApplicationEventPublisher eventPublisher;
  private final ExtractedTextService extractedText;
  private final StagedFileClaimer stagedFileClaimer;
  private final DriveFileUsage driveFileUsage;

  @Value("${workplace.storage.attachment.max-file-size-bytes:26214400}")
  private long maxFileSize;

  @Value("${workplace.storage.attachment.max-per-issue:10}")
  private int maxPerIssue;

  /**
   * 다중 multipart 업로드 — 본문 편집 권한 + 사이즈 + 누적 한도 가드 후 일괄 저장 + history 1건.
   *
   * <p>권한은 본문 편집과 동일(assertContentWritable: 멤버/ADMIN 또는 OPEN reporter 본인). 예전엔 assertMember 라 OPEN
   * 프로젝트에서 본문은 고칠 수 있는 비멤버 reporter 만 첨부가 403 이 나 사용자마다 결과가 달랐다(WP-202).
   */
  public List<IssueAttachmentResponse> upload(
      Long callerId, String projectKey, int number, List<MultipartFile> files) {
    var project = accessGuard.resolve(projectKey);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    accessGuard.assertContentWritable(project, issue.reporterId(), callerId);

    if (files == null || files.isEmpty()) {
      return List.of();
    }

    // 1) 개별 사이즈 게이트 — 하나라도 초과면 즉시 400. 디스크 쓰기 전에 차단.
    for (MultipartFile mf : files) {
      if (mf.getSize() > maxFileSize) {
        throw new AttachmentTooLargeException(mf.getOriginalFilename(), maxFileSize);
      }
    }

    // 2) 누적 한도 — 현재 + 신규 > 10 이면 409.
    // 동시 업로드 TOCTOU 레이스(#625) 방지 — 카운트 조회 전에 이슈 단위 advisory lock 으로 직렬화.
    // 트랜잭션 종료 시 자동 해제되므로 별도 unlock 불필요.
    repo.advisoryLockIssue(issue.id());
    int current = repo.countByIssue(issue.id());
    if (current + files.size() > maxPerIssue) {
      throw new AttachmentLimitExceededException(current, files.size(), maxPerIssue);
    }

    // 3) 디스크 저장 + 매핑 INSERT — 트랜잭션 안에서 일괄 수행.
    List<IssueAttachmentResponse> added = new ArrayList<>();
    for (MultipartFile mf : files) {
      Long fileId = storage.storeAndInsert(mf, callerId);
      repo.insert(fileId, issue.id(), callerId);
      IssueAttachmentResponse row =
          repo.findById(fileId).orElseThrow(() -> new AttachmentNotFoundException(fileId));
      added.add(row);
      // 이슈 첨부는 업로드 즉시 영구 파일 → 여기서 텍스트 추출을 요청한다(WP-242). 첨부는 요약·임베딩 없는 TEXT_ONLY.
      eventPublisher.publishEvent(
          FileExtractionRequestedEvent.of(fileId, row.mimeType(), ExtractionProfile.TEXT_ONLY));
    }

    // 4) history 한 건 — payload 에 added 만 포함.
    historyRecorder.recordAttachmentsChanged(callerId, issue.id(), added, List.of());
    changeNotifier.updated(project, number, issue.id(), callerId);

    return added;
  }

  /**
   * 먼저 올려 둔 스테이징 파일(WP-421)을 이 이슈의 첨부로 가져온다(WP-422) — upload 와 같은 권한(본문 편집)·한도·크기 규칙, 같은 이력·알림. 외부
   * MCP 가 파일을 올려 두고 붙이는 경로다. 알림은 작업 쓰기({@code updated})라 MCP 경유면 담당 AI 작업이 시작된다 — 이슈를 만드는 중의 첨부는 이
   * 메서드가 아니라 {@link #attachStaged} 를 직접 불러 알림을 내지 않는다.
   *
   * @throws com.workplace.file.exception.StagedFileUnusableException 남의 파일·만료·이미 묶인 파일 등(400)
   */
  public List<IssueAttachmentResponse> claim(
      Long callerId, String projectKey, int number, List<Long> fileIds) {
    var project = accessGuard.resolve(projectKey);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    accessGuard.assertContentWritable(project, issue.reporterId(), callerId);

    // 요청은 비어 있을 수 없고(@NotEmpty) 클레임은 하나라도 못 묶으면 예외라, 여기까지 오면 늘 묶인 첨부가 있다.
    List<IssueAttachmentResponse> added = attachStaged(project, issue.id(), callerId, fileIds);
    changeNotifier.updated(project, number, issue.id(), callerId);
    return added;
  }

  /**
   * 스테이징 파일을 이슈 첨부로 묶는다. <b>권한 판정과 알림을 하지 않는다</b> — 호출자 몫이다({@link #claim} 은 본문 편집 권한 + 작업 쓰기 알림,
   * 이슈 생성은 생성 권한 + 생성 알림). 호출자의 쓰기 트랜잭션 안에서 불러야 한다.
   *
   * <p>순서: 이슈 단위 advisory lock(동시 업로드·클레임 직렬화, upload 와 같은 #625) → 누적 한도 → 클레임(파일 잠금·소유/만료/중복 바인딩
   * 검사·영구화) → 크기 상한 → 매핑 INSERT. 어느 검사든 실패하면 예외로 트랜잭션이 롤백돼 아무것도 묶이지 않는다.
   */
  public List<IssueAttachmentResponse> attachStaged(
      ProjectRow project, long issueId, long callerId, List<Long> fileIds) {
    if (fileIds == null || fileIds.isEmpty()) {
      return List.of();
    }

    List<StagedFile> staged = claimStaged(issueId, callerId, fileIds, maxPerIssue);
    for (StagedFile f : staged) {
      repo.insert(f.fileId(), issueId, callerId);
    }
    List<IssueAttachmentResponse> added = loadAdded(issueId, staged);
    for (StagedFile f : staged) {
      requestTextExtraction(f);
    }

    historyRecorder.recordAttachmentsChanged(callerId, issueId, added, List.of());
    return added;
  }

  /** 가져오기(WP-883)가 넘기는 첨부 한 건 — 파일, 원 첨부자, 원 첨부 시각. */
  public record ImportedAttachment(long fileId, long attachedBy, OffsetDateTime attachedAt) {}

  /**
   * 가져오기용 첨부 — {@link #attachStaged} 와 같은 잠금·스테이징 클레임(호출자 소유·만료·중복 바인딩 검사)·파일 크기 상한·텍스트 추출 요청을 거치되,
   * 첨부자·시각을 원본 값으로 기록하고 <b>이력·알림은 남기지 않는다</b>(원래 이력은 가져오기가 따로 옮긴다). 개수 상한은 일반 경로(10)가 아니라 호출자가 넘기는
   * 가져오기 상한(maxCount, 요청 DTO 의 상한)이다 — 다른 트래커의 이슈에는 첨부가 더 많을 수 있다. 호출자의 쓰기 트랜잭션 안에서 불러야 하며, 권한 판정은
   * 호출자 몫이다.
   *
   * @return 붙인 첨부 수(응답의 첨부 개수를 다시 세지 않게)
   */
  public int attachImported(
      long issueId, long callerId, List<ImportedAttachment> items, int maxCount) {
    if (items == null || items.isEmpty()) {
      return 0;
    }
    List<Long> fileIds = items.stream().map(ImportedAttachment::fileId).toList();
    List<StagedFile> staged = claimStaged(issueId, callerId, fileIds, maxCount);
    Map<Long, ImportedAttachment> byFile = new HashMap<>();
    for (ImportedAttachment it : items) {
      byFile.put(it.fileId(), it);
    }
    for (StagedFile f : staged) {
      ImportedAttachment it = byFile.get(f.fileId());
      repo.insert(f.fileId(), issueId, it.attachedBy(), it.attachedAt());
      requestTextExtraction(f);
    }
    return staged.size();
  }

  /**
   * 첨부 공통 앞단 — 이슈 단위 advisory lock(동시 업로드·클레임 직렬화, upload 와 같은 #625) → 누적 한도(limit) → 클레임(파일
   * 잠금·소유/만료/중복 바인딩 검사·영구화) → 크기 상한. 스테이징 상한(링크 25MB 등)과 이슈 첨부 상한이 어긋날 수 있어 목적지 상한을 다시 본다. 어느 검사든
   * 예외로 트랜잭션이 롤백돼 클레임(영구화)도 함께 취소된다.
   */
  private List<StagedFile> claimStaged(long issueId, long callerId, List<Long> fileIds, int limit) {
    repo.advisoryLockIssue(issueId);
    int current = repo.countByIssue(issueId);
    if (current + fileIds.size() > limit) {
      throw new AttachmentLimitExceededException(current, fileIds.size(), limit);
    }
    List<StagedFile> staged =
        stagedFileClaimer.claim(callerId, fileIds, StagedFileClaimer.Retention.PERMANENT);
    for (StagedFile f : staged) {
      if (f.sizeBytes() > maxFileSize) {
        throw new AttachmentTooLargeException(f.originalName(), maxFileSize);
      }
    }
    return staged;
  }

  /** 방금 묶은 행(첨부자 이름·시각 포함)을 한 번에 읽는다 — 이슈 첨부는 한도 안이라 이슈 전체를 읽어 입력 순서로 고른다. */
  private List<IssueAttachmentResponse> loadAdded(long issueId, List<StagedFile> staged) {
    Map<Long, IssueAttachmentResponse> byId = new HashMap<>();
    for (IssueAttachmentResponse r : repo.findByIssue(issueId)) {
      byId.put(r.fileId(), r);
    }
    List<IssueAttachmentResponse> added = new ArrayList<>(staged.size());
    for (StagedFile f : staged) {
      IssueAttachmentResponse r = byId.get(f.fileId());
      if (r == null) {
        throw new AttachmentNotFoundException(f.fileId());
      }
      added.add(r);
    }
    return added;
  }

  /** 클레임은 추출 이벤트를 내지 않는다 — 업로드와 같이 바인딩한 쪽이 TEXT_ONLY 추출을 요청한다(WP-242). */
  private void requestTextExtraction(StagedFile f) {
    eventPublisher.publishEvent(
        FileExtractionRequestedEvent.of(f.fileId(), f.mimeType(), ExtractionProfile.TEXT_ONLY));
  }

  /** 이슈 첨부 목록 조회 — 조회 가드(OPEN 은 테넌트 전원 개방). 업로드는 본문 편집 권한, 삭제는 첨부자/OWNER 로 별도 게이트. */
  @Transactional(readOnly = true)
  public List<IssueAttachmentResponse> list(Long callerId, String projectKey, int number) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    return listByIssueId(issue.id());
  }

  /**
   * issueId 로 첨부 목록(추출 상태 포함). <b>권한 판정을 하지 않는다</b> — 호출자가 이미 열람 권한을 확인했어야 한다(WP-244: 이슈 챗 스레드 경유
   * 조회는 chat 모듈이 스레드 열람 가드로 판정한 뒤 부른다).
   */
  @Transactional(readOnly = true)
  public List<IssueAttachmentResponse> listByIssueId(long issueId) {
    // 첨부별 추출 상태를 한 번에 붙인다(WP-242). 행이 없으면 NONE(배포 전 첨부).
    return extractedText.attach(
        repo.findByIssue(issueId),
        IssueAttachmentResponse::fileId,
        IssueAttachmentResponse::withExtraction);
  }

  /** fileId 가 이 이슈의 첨부인지. 권한 판정 없음 — {@link #listByIssueId} 와 같은 전제(WP-244). */
  @Transactional(readOnly = true)
  public boolean isAttachedToIssue(long issueId, long fileId) {
    return repo.findById(fileId).map(a -> Long.valueOf(issueId).equals(a.issueId())).orElse(false);
  }

  /**
   * issueId 기준 다운로드. 권한 판정 없음 — {@link #listByIssueId} 와 같은 전제(WP-244). 다른 이슈의 fileId·없는 fileId 는
   * 404 로 통일(정보 누출 방지).
   */
  @Transactional(readOnly = true)
  public IssueAttachmentStorage.StoredFile downloadByIssueId(long issueId, Long fileId) {
    if (!isAttachedToIssue(issueId, fileId)) {
      throw new AttachmentNotFoundException(fileId);
    }
    return storage.load(fileId);
  }

  /**
   * 다운로드 — 조회 가드 + 이슈-첨부 일관성 검증 후 디스크에서 메타+경로 반환. 목록과 같은 assertReadable 이라 OPEN 프로젝트는 목록에 보이는 첨부를
   * 비멤버도 내려받을 수 있다(WP-202 — 비멤버 reporter 가 자기 첨부를 못 여는 문제 방지).
   */
  @Transactional(readOnly = true)
  public IssueAttachmentStorage.StoredFile download(
      Long callerId, String projectKey, int number, Long fileId) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    // 다른 이슈의 첨부 ID로 요청하면 정보 누출 방지를 위해 404 로 통일한다.
    return downloadByIssueId(issue.id(), fileId);
  }

  /**
   * 첨부 추출 텍스트 구간 읽기(WP-242). 권한·소속 판정은 download 와 같다 — 조회 가드(비멤버 403) + 다른 이슈의 fileId·없는 fileId 는
   * 404. 상태·사유·자르기는 fileai 공용 서비스가 맡는다.
   */
  @Transactional(readOnly = true)
  public ExtractedTextSlice readText(
      Long callerId, String projectKey, int number, Long fileId, int offset, int limit) {
    // 권한 규칙은 resolveViewFileId 한 곳에 — /text 와 /view 가 같은 가드를 쓴다(같은 readOnly 트랜잭션 안에서 실행).
    return extractedText.read(
        resolveViewFileId(callerId, projectKey, number, fileId), offset, limit);
  }

  /**
   * 이미지 보기용 파일 id 확인(WP-250, R5) — {@link #readText} 와 같은 가드(조회 권한 + 이 이슈의 첨부)를 거쳐 core file.id 만
   * 돌려준다.
   */
  @Transactional(readOnly = true)
  public long resolveViewFileId(Long callerId, String projectKey, int number, Long fileId) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    var att = repo.findById(fileId).orElseThrow(() -> new AttachmentNotFoundException(fileId));
    if (!att.issueId().equals(issue.id())) {
      throw new AttachmentNotFoundException(fileId);
    }
    return fileId;
  }

  /**
   * 삭제 — 첨부자 본인 또는 프로젝트 OWNER. 매핑 + file row + 디스크 정리 후 history(드라이브가 쓰는 file 은 매핑만). 선검증은 조회 가드로
   * 두어 OPEN 프로젝트의 비멤버 첨부자도 자기 첨부를 지울 수 있게 한다(WP-202). 그 외 비멤버는 아래 첨부자/OWNER 판정에서 거부된다.
   */
  public void delete(Long callerId, String projectKey, int number, Long fileId) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    var att = repo.findById(fileId).orElseThrow(() -> new AttachmentNotFoundException(fileId));
    if (!att.issueId().equals(issue.id())) {
      throw new AttachmentNotFoundException(fileId);
    }

    boolean isAttacher = att.attachedById().equals(callerId);
    boolean isOwner = false;
    if (!isAttacher) {
      // 첨부자 아니면 OWNER 인지 검증 — Phase 1 IssueService.softDelete 와 동일 패턴.
      try {
        accessGuard.assertWithRole(projectKey, callerId, "OWNER");
        isOwner = true;
      } catch (ProjectAccessDeniedException ignored) {
        // OWNER 도 아님 — 아래 분기에서 거부.
      }
    }
    if (!isAttacher && !isOwner) {
      throw new ProjectAccessDeniedException("첨부 삭제는 첨부자 또는 OWNER 만 가능합니다");
    }

    repo.delete(fileId);
    // 드라이브로 가져간 첨부는 drive_file 이 같은 file 행을 쓰므로 이슈 연결만 끊는다(WP-722) — file 행·원본은 드라이브 수명주기가 정리한다.
    if (!driveFileUsage.referencesFile(fileId)) {
      storage.deleteFileRowAndBinary(fileId);
    }
    historyRecorder.recordAttachmentsChanged(callerId, issue.id(), List.of(), List.of(att));
    changeNotifier.updated(project, number, issue.id(), callerId);
  }
}
