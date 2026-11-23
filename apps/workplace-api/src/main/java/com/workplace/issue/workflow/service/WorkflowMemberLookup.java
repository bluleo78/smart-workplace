package com.workplace.issue.workflow.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.workflow.domain.ActiveMember;
import com.workplace.issue.workflow.domain.ProjectMembers;
import com.workplace.project.dto.MemberResponse;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.user.dto.AssigneeInfo;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 프로젝트의 활성 실효 구성원(직접 + 조직도 부서)을 검증기의 {@link ProjectMembers} 로 옮긴다. 구성원·정지·AI 실행 방식은 수시로 바뀌므로 담아 두지
 * 않고 부를 때마다 읽는다. 부르는 쪽 트랜잭션 안에서 돈다(RLS).
 */
@Component
@RequiredArgsConstructor
class WorkflowMemberLookup {

  private final ProjectMemberRepository memberRepository;
  private final UserRepository userRepository;

  /**
   * 지금의 활성 구성원. 종류(kind)는 사용자 행의 값 그대로 쓴다 — 사람도 agent_runtime 이 INTERNAL 이라 실행 방식으로 AI 를 추정하면 사람을
   * 내부 AI 로 잘못 본다.
   */
  ProjectMembers membersOf(long projectId) {
    return ProjectMembers.of(
        activeInfos(projectId).stream()
            .map(u -> new ProjectMembers.Member(u.username(), u.kind(), u.agentRuntime()))
            .toList());
  }

  /**
   * 지금의 활성 구성원을 id·저장된 username 으로(WP-1985 실행 판정용). {@link #membersOf} 와 같은 걸러내기라 정의 검증과 실행이 같은 사람을
   * 구성원으로 본다. 역할과의 맞춤은 정확한 username 으로 {@code RunRoleMembers} 가 한다.
   */
  List<ActiveMember> activeMembersOf(long projectId) {
    return activeInfos(projectId).stream()
        .map(u -> new ActiveMember(u.id(), u.username()))
        .toList();
  }

  /** 실효 구성원 중 프로젝트 활성 + 워크스페이스 활성인 사용자 정보. */
  private List<AssigneeInfo> activeInfos(long projectId) {
    List<String> usernames =
        memberRepository.findEffectiveByProject(projectId).stream()
            .filter(MemberResponse::active)
            .map(MemberResponse::username)
            .toList();
    return userRepository.findAssigneeInfosByUsernames(usernames, TenantContext.get()).stream()
        .filter(AssigneeInfo::isActive)
        .toList();
  }
}
