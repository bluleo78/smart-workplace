package com.workplace.issue.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.IssueRecurrenceRow;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.outbound.ImplicitChatAgents;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRecurrenceRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.AssigneeInfo;
import com.workplace.user.dto.UserKind;
import com.workplace.user.repository.UserRepository;
import com.workplace.user.service.ServerAgentResolver;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 실행 일정이 걸린 작업의 이슈챗에서 멘션 없이도 답할 담당 AI 를 판정한다(WP-1377, {@link ImplicitChatAgents} 구현).
 *
 * <p>chat 쪽 빈(ChatMessageService·ChatThreadService)이 부르므로 chat 빈에 의존하지 않는다 — {@link
 * IssueRecurrenceFollowUpService} 와 같은 까닭(빈 순환 방지). 읽기만 하며 호출자의 트랜잭션(RLS 컨텍스트)에 합류한다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class IssueImplicitChatAgentService implements ImplicitChatAgents {

  private final IssueRecurrenceRepository recurrenceRepository;
  private final IssueRepository issueRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final ProjectRepository projectRepository;
  private final UserRepository userRepository;

  /**
   * 일정 → 일정 AI 가 담당인지 → 외부 AI 담당이 없는지 → 일정 AI(서버 실행·활성) → 글쓴이(일정 건 사람 또는 사람 담당자, 개인 비서면 주인만) → 개인/팀
   * 순으로 판정한다. 대부분의 이슈엔 일정이 없어 첫 조회에서 끝난다.
   */
  @Override
  public Optional<ImplicitChatAgent> resolve(long issueId, long actorId) {
    // 지운 일정(묘비)은 없는 일정이다. 꺼짐·멈춤·끝난 한 번만은 행이 남아 있어 포함한다(확정 규칙 1).
    IssueRecurrenceRow row = recurrenceRepository.find(issueId).orElse(null);
    if (row == null || row.deleted()) return Optional.empty();
    long agentId = row.agentUserId();

    // WP-1377: 일정 AI 가 아직 이 이슈의 담당이어야 한다 — 이어 처리(IssueRecurrenceFollowUpService)와 같은 요구. 담당에서 빠진
    // AI 는 일정 행이 남아 있어도 멘션 없이 깨우지 않는다(정기 회차도 다음 회차에 거둔다).
    List<Long> assigneeIds = assigneeRepository.findUserIdsByIssue(issueId);
    if (!assigneeIds.contains(agentId)) return Optional.empty();
    // 담당자 전원을 한 번에 읽어 외부 AI 여부·일정 AI 판정·사람 담당자 판정에 함께 쓴다.
    List<AssigneeInfo> assignees =
        userRepository.findAssigneeInfos(assigneeIds, TenantContext.get());
    // WP-1377: 외부 실행 AI 가 담당이면(WP-373 — 스레드 응답 externalAgent 와 같은 기준) 멘션 없는 답은 그 AI 가 이어받는다. 화면도
    // 외부 AI 안내만 보이므로 일정 AI 를 함께 깨우지 않는다.
    if (assignees.stream().anyMatch(AssigneeInfo::isExternalAgent)) return Optional.empty();

    // 서버 실행 AI 판정은 ServerAgentResolver 의 기준(INTERNAL·이 워크스페이스에서 활성)을 그대로 쓴다 — 외부·정지 AI 는 멘션 없이도
    // 깨우지 않는다. 이미 읽은 담당자 정보로 판정해 같은 사용자를 다시 조회하지 않고, 이름·username(개인 비서 주인 판정)도 여기서 받는다.
    AssigneeInfo agent =
        assignees.stream()
            .filter(a -> a.id() == agentId)
            .filter(ServerAgentResolver::runsOnServer)
            .findFirst()
            .orElse(null);
    if (agent == null) return Optional.empty();
    // 남의 개인 비서는 주인의 글에만 답한다 — 주인의 AI 자격으로 도는 주인 전용 AI 다(WP-638 과 같은 규칙).
    if (AgentUsernames.isOthersPersonalAssistant(agent.username(), actorId)) {
      return Optional.empty();
    }

    // 글쓴이: 일정을 건 사람 또는 이슈의 사람 담당자(확정 규칙 2). 그 밖의 구성원 글은 사람끼리 대화로 둔다.
    boolean humanAssignee =
        assignees.stream().anyMatch(a -> a.id() == actorId && UserKind.HUMAN.equals(a.kind()));
    if (row.createdBy() != actorId && !humanAssignee) {
      return Optional.empty();
    }

    IssueRow issue = issueRepository.findById(issueId).orElse(null);
    if (issue == null) return Optional.empty();
    ProjectRow project = projectRepository.findById(issue.projectId()).orElse(null);
    if (project == null) return Optional.empty();
    // 개인 작업은 늘 답하고, 팀 이슈는 우선 「AI 답 다음에만」 — 스레드 멤버가 둘뿐이면 ALWAYS 로 올리는 건 chat 쪽이다.
    Mode mode = project.isPersonal() ? Mode.ALWAYS : Mode.AFTER_AI_REPLY;
    return Optional.of(new ImplicitChatAgent(agentId, agent.name(), mode));
  }
}
