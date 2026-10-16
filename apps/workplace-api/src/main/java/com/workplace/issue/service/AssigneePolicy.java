package com.workplace.issue.service;

import com.workplace.issue.exception.InvalidAssigneeForProjectException;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.user.dto.AssigneeInfo;
import java.util.Collection;
import java.util.HashSet;
import java.util.Set;

/**
 * 이슈 담당자로 허용되는 사용자 id 집합 계산. 개인(PERSONAL)·팀(TEAM) 공통으로 프로젝트 멤버만 담당자로 허용한다. 개인 프로젝트에 AGENT 를 담당자로
 * 두려면 먼저 ProjectService.addMember 로 멤버 등록이 필요하다.
 */
final class AssigneePolicy {
  private AssigneePolicy() {}

  /** 허용 담당자 = 프로젝트 멤버 집합. 개인·팀 구분 없이 동일 규칙 적용. */
  static Set<Long> allowedAssigneeIds(ProjectRow project, ProjectMemberRepository memberRepo) {
    return new HashSet<>(memberRepo.findUserIdsByProject(project.id()));
  }

  /**
   * 새로 담당자가 되는 사용자는 이 워크스페이스에서 활성이어야 한다 — 전역 비활성 계정(#624)과 워크스페이스에서 정지된 구성원(WP-417, 멤버십 SUSPENDED)을
   * 함께 막는다. 이슈 생성과 담당자 교체가 같은 규칙을 이 한 곳에서 쓴다. 활성 여부는 {@code UserRepository.findAssigneeInfos(ids,
   * tenantId)} 가 워크스페이스 기준으로 채운 값이다. 이미 담당 중인 사람을 그대로 두는 것은 막지 않도록 호출측이 새로 추가되는 사용자만 넘긴다(교체는 diff 의
   * 추가분, 생성은 전원).
   *
   * @throws InvalidAssigneeForProjectException 추가 대상 중 이 워크스페이스에서 활성이 아닌 사용자가 있을 때
   */
  static void requireActive(Collection<AssigneeInfo> newAssignees) {
    if (newAssignees.stream().anyMatch(u -> !u.isActive())) {
      throw new InvalidAssigneeForProjectException();
    }
  }
}
