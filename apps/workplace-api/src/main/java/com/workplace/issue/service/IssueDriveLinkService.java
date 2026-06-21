package com.workplace.issue.service;

import com.workplace.drive.dto.DriveLinkResponse;
import com.workplace.drive.service.DriveLinkService;
import com.workplace.file.service.FileUploadService;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectAccessGuard;
import java.io.IOException;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 이슈 ↔ 드라이브 파일 링크. 이슈 멤버십을 검사하고 파일 측은 DriveLinkService 에 위임. */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueDriveLinkService {

  /** 드라이브 링크 소스 타입: 이슈 */
  private static final String SOURCE = "ISSUE";

  private final ProjectAccessGuard accessGuard;
  private final IssueRepository issueRepository;
  private final DriveLinkService driveLinks;

  /** 이슈에 드라이브 파일 링크 추가. 호출자가 프로젝트 멤버인지 검증. */
  public void add(long callerId, String key, int number, long driveFileId) {
    long issueId = resolveIssueId(callerId, key, number);
    driveLinks.createLink(callerId, driveFileId, SOURCE, issueId);
  }

  /** 이슈 드라이브 링크 삭제. OWNER 는 타인 링크도 삭제 가능. */
  public void remove(long callerId, String key, int number, long driveFileId) {
    long issueId = resolveIssueId(callerId, key, number);
    boolean canManage = isOwner(key, callerId);
    driveLinks.removeLink(callerId, driveFileId, SOURCE, issueId, canManage);
  }

  /** 이슈에 연결된 드라이브 파일 목록 조회. */
  @Transactional(readOnly = true)
  public List<DriveLinkResponse> list(long callerId, String key, int number) {
    long issueId = resolveIssueId(callerId, key, number);
    return driveLinks.listLinks(SOURCE, issueId);
  }

  /** 이슈에 링크된 드라이브 파일 내용 다운로드. 이슈 멤버십만으로 인가 — 드라이브 스페이스 멤버십 불필요(크로스 링크 핵심 속성). */
  @Transactional(readOnly = true)
  public FileUploadService.FileContentResult content(
      long callerId, String key, int number, long driveFileId) throws IOException {
    // 이슈 멤버십 검사 = 다운로드 인가
    long issueId = resolveIssueId(callerId, key, number);
    return driveLinks.getLinkContent(SOURCE, issueId, driveFileId);
  }

  /** 프로젝트 멤버십 검사 후 이슈 id 반환. */
  private long resolveIssueId(long callerId, String key, int number) {
    var project = accessGuard.assertMember(key, callerId);
    return issueRepository
        .findByProjectAndNumber(project.id(), number)
        .orElseThrow(() -> new IssueNotFoundException(key, number))
        .id();
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
