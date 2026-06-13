package com.workplace.project.service;

import com.workplace.global.security.PermissionChecker;
import com.workplace.project.dto.MemberRow;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.repository.ProjectRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 프로젝트 접근/역할 보장 가드. 컨트롤러 단의 {@code @RequirePermission} 외에 프로젝트별 멤버십/역할 체크가 필요할 때 서비스에서 호출한다. ADMIN
 * 역할은 팀(TEAM) 프로젝트 접근을 우회하지만, 개인(PERSONAL) 프로젝트는 완전 비공개라 소유자만 접근할 수 있다(ADMIN도 제외).
 */
@Service
@RequiredArgsConstructor
public class ProjectAccessGuard {

  private final ProjectRepository projectRepository;
  private final ProjectMemberRepository memberRepository;
  private final PermissionChecker permissionChecker;

  /**
   * 프로젝트가 존재하고, 호출자가 멤버(또는 ADMIN)인지 확인. 통과 시 프로젝트 row 반환.
   *
   * @throws ProjectNotFoundException 프로젝트가 없거나 soft-deleted 인 경우
   * @throws ProjectAccessDeniedException 멤버가 아닌 경우
   */
  public ProjectRow assertMember(String projectKey, Long userId) {
    return assertWithRole(projectKey, userId, null);
  }

  /**
   * 프로젝트 멤버십을 보장하며, requiredRole 이 지정되면 해당 역할 보유까지 검증. ADMIN 은 모든 검증을 우회.
   *
   * @param projectKey 프로젝트 key
   * @param userId 호출자 ID
   * @param requiredRole 요구 역할 (null 이면 멤버십만 검증)
   * @return 검증된 프로젝트 row
   */
  public ProjectRow assertWithRole(String projectKey, Long userId, String requiredRole) {
    ProjectRow project =
        projectRepository
            .findByKey(projectKey)
            .orElseThrow(() -> new ProjectNotFoundException(projectKey));
    boolean isPersonal = "PERSONAL".equals(project.type());
    // ADMIN 은 멤버십/역할 검증을 우회 — 단, PERSONAL 은 소유자만 접근 (완전 비공개)
    if (!isPersonal && permissionChecker.userHasRole(userId, "ADMIN")) {
      return project;
    }
    MemberRow member =
        memberRepository
            .find(project.id(), userId)
            .orElseThrow(() -> new ProjectAccessDeniedException("프로젝트 멤버가 아닙니다"));
    if (requiredRole != null && !requiredRole.equals(member.role())) {
      throw new ProjectAccessDeniedException("권한이 부족합니다: " + requiredRole + " 필요");
    }
    return project;
  }
}
