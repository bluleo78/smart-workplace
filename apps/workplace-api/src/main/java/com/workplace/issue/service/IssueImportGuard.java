package com.workplace.issue.service;

import com.workplace.global.security.PermissionChecker;
import com.workplace.issue.exception.IssueImportException;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 가져오기 공통 관문 — 이슈 가져오기({@link IssueImportService})와 관계 일괄 가져오기({@link IssueRelationImportService})가
 * 같은 규칙({@link #requireImportAccess})으로 호출자와 프로젝트를 거른다. 남의 이름·시각으로 기록을 남기는 기능이라 두 곳의 규칙이 어긋나면 안 되므로
 * 한 곳에 둔다.
 */
@Component
@RequiredArgsConstructor
public class IssueImportGuard {

  private final UserRepository userRepository;
  private final PermissionChecker permissionChecker;
  private final ProjectAccessGuard accessGuard;

  /**
   * 호출자가 이 테넌트의 ADMIN 역할을 가진 사람인지 — 워크스페이스 전체를 건드리는 일(부모 에픽 링크 일괄 변환)에 쓴다. 프로젝트 하나에 가져오는 일은 {@link
   * #requireImportAccess} 가 그 프로젝트 OWNER 도 받는다. AI 구성원(AI 키 포함)은 ADMIN 이어도 403.
   */
  public UserResponse requireHumanAdmin(long callerId) {
    UserResponse caller = requireHuman(callerId);
    if (!permissionChecker.userHasRole(callerId, "ADMIN")) throw IssueImportException.forbidden();
    return caller;
  }

  /** 호출자가 사람인지 — 없는 사용자·AI 구성원(AI 키 포함)은 403. 남의 이름으로 기록을 남기는 일이라 두 관문 모두 사람만 받는다. */
  private UserResponse requireHuman(long callerId) {
    UserResponse caller =
        userRepository.findById(callerId).orElseThrow(IssueImportException::forbidden);
    if (UserKind.isAgent(caller.kind())) throw IssueImportException.forbidden();
    return caller;
  }

  /** 가져오기를 허락받은 호출자와 대상 프로젝트. */
  public record ImportAccess(UserResponse caller, ProjectRow project) {}

  /**
   * 이 프로젝트에 가져오기를 실행해도 되는 사람인지 보고 대상 프로젝트를 돌려준다(WP-1239) — 테넌트 ADMIN 이거나, 이 팀 프로젝트의 OWNER 인 사람만.
   *
   * <p>OWNER 는 자기 프로젝트에만 가져온다 — 원작성자·시각을 지정하는 경로라 권한 밖 프로젝트는 403 이다. 누구나 프로젝트를 만들어 OWNER 가 되고 멤버를
   * 넣을 수 있으니, OWNER 가 그 멤버의 이름으로 기록을 남길 수 있다는 점은 받아들인 위험이다(이슈 챗 결정 — 이관을 팀장이 직접 하게). 가져온 이슈마다
   * imported_by 와 감사 로그가 실제 실행자를 남긴다. AI 구성원(AI 키 포함)은 ADMIN·OWNER 여도 403 — 남의 이름으로 기록을 남기는 일이라 사람이
   * 책임지게 둔다.
   *
   * <p>ADMIN 이 아닌 호출자에게는 프로젝트가 없음(404)과 권한 없음을 가르지 않고 모두 403 으로 답한다 — 남의 프로젝트 키가 있는지 알려 주지 않는다. 자기
   * 개인 프로젝트는 ADMIN 과 같이 400(IMPORT_PERSONAL_PROJECT), ADMIN 은 지금처럼 없으면 404.
   */
  public ImportAccess requireImportAccess(long callerId, String projectKey) {
    UserResponse caller = requireHuman(callerId);
    if (permissionChecker.userHasRole(callerId, "ADMIN")) {
      return new ImportAccess(caller, resolveImportProject(projectKey));
    }
    // assertWithRole(OWNER) 를 쓰지 않는다 — 그쪽은 못 보는 프로젝트를 404 로 알려 주고 개인 프로젝트를 거르지 않는다.
    ProjectRow project;
    try {
      project = accessGuard.resolve(projectKey);
    } catch (ProjectNotFoundException e) {
      throw IssueImportException.forbidden();
    }
    if (!accessGuard.isOwner(project, callerId)) throw IssueImportException.forbidden();
    // 개인 프로젝트는 소유자도 OWNER 지만 가져오기 대상이 아니다 — 남의 개인 프로젝트는 위에서 403 이라 여기 오는 것은 자기 것뿐이다.
    if (project.isPersonal()) throw IssueImportException.personalProject();
    return new ImportAccess(caller, project);
  }

  /** 가져올 프로젝트 — 없으면 404, 개인 프로젝트는 ADMIN 우회가 없어 가져오지 않는다(400). */
  public ProjectRow resolveImportProject(String projectKey) {
    ProjectRow project = accessGuard.resolve(projectKey);
    if (project.isPersonal()) throw IssueImportException.personalProject();
    return project;
  }
}
