package com.workplace.issue.service;

import com.workplace.drive.dto.DriveLinkResponse;
import com.workplace.drive.service.DriveLinkService;
import com.workplace.file.service.FileUploadService;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectAccessGuard;
import java.io.IOException;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 이슈 ↔ 드라이브 파일 링크. 이슈 권한(추가=본문 편집, 조회·다운로드·삭제 선검증=조회)을 검사하고 파일 측은 DriveLinkService 에 위임. */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueDriveLinkService {

  /** 드라이브 링크 소스 타입: 이슈 */
  private static final String SOURCE = "ISSUE";

  private final ProjectAccessGuard accessGuard;
  private final IssueRepository issueRepository;
  private final DriveLinkService driveLinks;
  private final IssueChangeNotifier changeNotifier;

  /**
   * 이슈에 드라이브 파일 링크 추가. 권한은 본문 편집·파일 첨부와 동일(assertContentWritable: 멤버/ADMIN 또는 OPEN reporter 본인) —
   * 같은 첨부 영역에서 업로드는 되는데 링크만 403 이 나지 않게 맞춘다(WP-202).
   */
  public void add(long callerId, String key, int number, long driveFileId) {
    var target = resolveWritableIssue(callerId, key, number);
    driveLinks.createLink(callerId, driveFileId, SOURCE, target.issueId());
    notifyUpdated(callerId, target);
  }

  /**
   * 이슈 드라이브 링크 삭제. 링크 생성자 본인 또는 OWNER(타인 링크 포함)만 — 판정은 DriveLinkService.removeLink. 선검증은 조회 가드라
   * OPEN 비멤버도 자기가 건 링크는 지울 수 있다(WP-202).
   */
  public void remove(long callerId, String key, int number, long driveFileId) {
    var target = resolveReadableIssue(callerId, key, number);
    boolean canManage = isOwner(key, callerId);
    driveLinks.removeLink(callerId, driveFileId, SOURCE, target.issueId(), canManage);
    notifyUpdated(callerId, target);
  }

  /** 이슈에 연결된 드라이브 파일 목록 조회 — 조회 가드(OPEN 은 테넌트 전원 개방, 상세 프로퍼티 레일 로드용). */
  @Transactional(readOnly = true)
  public List<DriveLinkResponse> list(long callerId, String key, int number) {
    long issueId = resolveReadableIssue(callerId, key, number).issueId();
    return driveLinks.listLinks(SOURCE, issueId);
  }

  /**
   * 이슈에 링크된 드라이브 파일 내용 다운로드. 이슈 조회 권한만으로 인가 — 드라이브 스페이스 멤버십 불필요(크로스 링크 핵심 속성). 목록과 같은 조회 가드라 OPEN 은
   * 목록에 보이는 링크를 비멤버도 열 수 있다(WP-202).
   */
  @Transactional(readOnly = true)
  public FileUploadService.FileContentResult content(
      long callerId, String key, int number, long driveFileId) throws IOException {
    long issueId = resolveReadableIssue(callerId, key, number).issueId();
    return driveLinks.getLinkContent(SOURCE, issueId, driveFileId);
  }

  /** 링크 변경을 실시간 무효화로 알림 — 이미 검증한 project 를 재사용한다(중복 조회 방지). */
  private void notifyUpdated(long callerId, ResolvedIssue target) {
    changeNotifier.updated(target.project(), target.number(), target.issueId(), callerId);
  }

  /** 권한 검증을 마친 project 와 이슈 번호·id. */
  private record ResolvedIssue(ProjectRow project, int number, long issueId) {}

  /** 본문 편집 권한(assertContentWritable) 검사 후 반환 — 링크 추가 전용. reporter 판정에 이슈 row 가 필요해 이슈를 먼저 조회한다. */
  private ResolvedIssue resolveWritableIssue(long callerId, String key, int number) {
    var project = accessGuard.resolve(key);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(key, number));
    accessGuard.assertContentWritable(project, issue.reporterId(), callerId);
    return new ResolvedIssue(project, number, issue.id());
  }

  /** 조회 가드(OPEN 개방) 검사 후 반환 — 목록·다운로드·삭제 선검증용. */
  private ResolvedIssue resolveReadableIssue(long callerId, String key, int number) {
    var project = accessGuard.assertReadable(key, callerId);
    long issueId =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(key, number))
            .id();
    return new ResolvedIssue(project, number, issueId);
  }

  /** 호출자가 프로젝트 OWNER 인지 확인. */
  private boolean isOwner(String key, long callerId) {
    try {
      accessGuard.assertWithRole(key, callerId, "OWNER");
      return true;
    } catch (ProjectAccessDeniedException ignored) {
      return false;
    }
  }
}
