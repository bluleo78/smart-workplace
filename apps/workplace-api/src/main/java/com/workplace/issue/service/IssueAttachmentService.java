package com.workplace.issue.service;

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
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.ArrayList;
import java.util.List;
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
        throw new AttachmentTooLargeException(mf.getSize(), maxFileSize);
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
    var project = accessGuard.assertReadable(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    var att = repo.findById(fileId).orElseThrow(() -> new AttachmentNotFoundException(fileId));
    if (!att.issueId().equals(issue.id())) {
      throw new AttachmentNotFoundException(fileId);
    }
    return extractedText.read(fileId, offset, limit);
  }

  /**
   * 삭제 — 첨부자 본인 또는 프로젝트 OWNER. 매핑 + file row + 디스크 정리 후 history. 선검증은 조회 가드로 두어 OPEN 프로젝트의 비멤버 첨부자도
   * 자기 첨부를 지울 수 있게 한다(WP-202). 그 외 비멤버는 아래 첨부자/OWNER 판정에서 거부된다.
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
    storage.deleteFileRowAndBinary(fileId);
    historyRecorder.recordAttachmentsChanged(callerId, issue.id(), List.of(), List.of(att));
    changeNotifier.updated(project, number, issue.id(), callerId);
  }
}
