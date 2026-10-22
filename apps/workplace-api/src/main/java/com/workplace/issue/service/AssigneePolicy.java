package com.workplace.issue.service;

import com.workplace.issue.exception.InactiveAssigneeException;
import com.workplace.issue.exception.InvalidAssigneeForProjectException;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.user.dto.AssigneeInfo;
import java.util.Collection;

/**
 * 이슈 담당자로 허용되는 사용자 id 집합 계산. 개인(PERSONAL)·팀(TEAM) 공통으로 프로젝트 멤버만 담당자로 허용한다. 개인 프로젝트에 AGENT 를 담당자로
 * 두려면 먼저 ProjectService.addMember 로 멤버 등록이 필요하다.
 */
final class AssigneePolicy {
  private AssigneePolicy() {}

  /**
   * 담당자로 지정할 사용자는 모두 프로젝트 멤버여야 한다. 개인·팀 구분 없이 동일 규칙 적용. 멤버 행을 공유 잠금한 채 확인한다(WP-775) — 동시에 들어온 멤버
   * 제거가 먼저 커밋되면 그 사람은 멤버가 아니라 거절되고, 지정이 먼저면 제거가 이 지정의 커밋을 기다렸다 담당자 정리(#714)로 함께 지운다. 잠그지 않고 읽으면 둘 다
   * 성공해 비멤버 담당자가 남았다.
   *
   * @throws InvalidAssigneeForProjectException 프로젝트 멤버가 아닌 사용자가 있을 때
   */
  static void requireMembers(
      ProjectRow project, Collection<Long> userIds, ProjectMemberRepository memberRepo) {
    if (!memberRepo.lockMemberUserIds(project.id(), userIds).containsAll(userIds)) {
      throw new InvalidAssigneeForProjectException();
    }
  }

  /**
   * 새로 담당자가 되는 사용자는 이 워크스페이스에서 활성이어야 한다 — 전역 비활성 계정(#624)과 워크스페이스에서 정지된 구성원(WP-417, 멤버십 SUSPENDED)을
   * 함께 막는다. 이슈 생성과 담당자 교체가 같은 규칙을 이 한 곳에서 쓴다. 활성 여부는 {@code UserRepository.findAssigneeInfos(ids,
   * tenantId)} 가 워크스페이스 기준으로 채운 값이다. 이미 담당 중인 사람을 그대로 두는 것은 막지 않도록 호출측이 새로 추가되는 사용자만 넘긴다(교체는 diff 의
   * 추가분, 생성은 전원).
   *
   * @throws InactiveAssigneeException 추가 대상 중 이 워크스페이스에서 활성이 아닌 사용자가 있을 때(WP-487 — 멤버 아님과 구분되는 메시지)
   */
  static void requireActive(Collection<AssigneeInfo> newAssignees) {
    if (newAssignees.stream().anyMatch(u -> !u.isActive())) {
      throw new InactiveAssigneeException();
    }
  }
}
