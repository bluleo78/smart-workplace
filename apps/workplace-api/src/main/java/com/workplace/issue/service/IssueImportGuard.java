package com.workplace.issue.service;

import com.workplace.global.security.PermissionChecker;
import com.workplace.issue.exception.IssueImportException;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 가져오기 공통 관문 — 이슈 가져오기({@link IssueImportService})와 관계 일괄 가져오기({@link IssueRelationImportService})가
 * 같은 규칙으로 호출자와 프로젝트를 거른다. 남의 이름·시각으로 기록을 남기는 기능이라 두 곳의 규칙이 어긋나면 안 되므로 한 곳에 둔다.
 */
@Component
@RequiredArgsConstructor
public class IssueImportGuard {

  private final UserRepository userRepository;
  private final PermissionChecker permissionChecker;
  private final ProjectAccessGuard accessGuard;

  /**
   * 호출자가 이 테넌트의 ADMIN 역할을 가진 사람인지 — 프로젝트 OWNER 도 안 된다(누구나 프로젝트를 만들면 소유자라 사실상 모두에게 열린다). AI 구성원(AI 키
   * 포함)은 ADMIN 이어도 403.
   */
  public UserResponse requireHumanAdmin(long callerId) {
    UserResponse caller =
        userRepository.findById(callerId).orElseThrow(IssueImportException::forbidden);
    if (UserKind.isAgent(caller.kind()) || !permissionChecker.userHasRole(callerId, "ADMIN")) {
      throw IssueImportException.forbidden();
    }
    return caller;
  }

  /** 가져올 프로젝트 — 없으면 404, 개인 프로젝트는 ADMIN 우회가 없어 가져오지 않는다(400). */
  public ProjectRow resolveImportProject(String projectKey) {
    ProjectRow project = accessGuard.resolve(projectKey);
    if (project.isPersonal()) throw IssueImportException.personalProject();
    return project;
  }
}
