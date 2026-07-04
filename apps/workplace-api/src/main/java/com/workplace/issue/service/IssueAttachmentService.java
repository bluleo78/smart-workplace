package com.workplace.issue.service;

import com.workplace.issue.dto.IssueAttachmentResponse;
import com.workplace.issue.exception.AttachmentLimitExceededException;
import com.workplace.issue.exception.AttachmentNotFoundException;
import com.workplace.issue.exception.AttachmentTooLargeException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.repository.IssueAttachmentRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
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

  @Value("${workplace.storage.attachment.max-file-size-bytes:26214400}")
  private long maxFileSize;

  @Value("${workplace.storage.attachment.max-per-issue:10}")
  private int maxPerIssue;

  /** 다중 multipart 업로드 — 멤버 + 사이즈 + 누적 한도 가드 후 일괄 저장 + history 1건. */
  public List<IssueAttachmentResponse> upload(
      Long callerId, String projectKey, int number, List<MultipartFile> files) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

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
      added.add(repo.findById(fileId).orElseThrow(() -> new AttachmentNotFoundException(fileId)));
    }

    // 4) history 한 건 — payload 에 added 만 포함.
    historyRecorder.recordAttachmentsChanged(callerId, issue.id(), added, List.of());

    return added;
  }

  /** 이슈 첨부 목록 조회 — 조회 가드(OPEN 은 테넌트 전원 개방). 다운로드/업로드/삭제는 여전히 멤버 게이트. */
  @Transactional(readOnly = true)
  public List<IssueAttachmentResponse> list(Long callerId, String projectKey, int number) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    return repo.findByIssue(issue.id());
  }

  /** 다운로드 — 멤버 가드 + 이슈-첨부 일관성 검증 후 디스크에서 메타+경로 반환. */
  @Transactional(readOnly = true)
  public IssueAttachmentStorage.StoredFile download(
      Long callerId, String projectKey, int number, Long fileId) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    var att = repo.findById(fileId).orElseThrow(() -> new AttachmentNotFoundException(fileId));
    if (!att.issueId().equals(issue.id())) {
      // 다른 이슈의 첨부 ID로 요청 — 정보 누출 방지를 위해 404 로 통일.
      throw new AttachmentNotFoundException(fileId);
    }
    return storage.load(fileId);
  }

  /** 삭제 — 첨부자 본인 또는 프로젝트 OWNER. 매핑 + file row + 디스크 정리 후 history. */
  public void delete(Long callerId, String projectKey, int number, Long fileId) {
    var project = accessGuard.assertMember(projectKey, callerId);
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
  }
}
