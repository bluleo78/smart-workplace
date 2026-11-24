package com.workplace.issue.outbound;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowNodeWakeEvent;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.user.dto.AssigneeInfo;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import com.workplace.user.service.ServerAgentResolver;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 워크플로우 노드 깨우기({@link WorkflowNodeWakeEvent})의 ai-agent 발사 payload 재료를 읽는다(WP-1986). 깨우기 이벤트는 id 만
 * 실으므로 커밋 뒤 발사 스레드에서 이슈·프로젝트·담당·사용자 요약을 다시 읽는다.
 *
 * <p>왜 따로 두나: 발사 핸들러는 트랜잭션 밖(@Async)이라 RLS 표(이슈·프로젝트·담당)를 읽으려면 테넌트 GUC 를 심는 읽기 트랜잭션이 필요하다 — 핸들러 빈
 * 안에서 자기 호출로는 트랜잭션 프록시가 걸리지 않는다. 테넌트는 발사 실행기의 TenantContext 전파(WP-417)를 쓴다.
 *
 * <p>노드에서 깨울 내부 AI 를 고르는 규칙은 {@link #wokenInternalAgentId} 를 본다.
 */
@Component
@RequiredArgsConstructor
public class WorkflowWakeContextReader {

  private final IssueRepository issueRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final ProjectRepository projectRepository;
  private final UserRepository userRepository;

  /**
   * 발사 재료. 이슈·프로젝트가 이미 없으면(그사이 삭제) 비어 있다.
   *
   * @return agents 는 깨운 내부 AI 하나와 외부 AI 만 담는다(깨우지 않은 내부 AI 는 제외). wokenAgentId 는 깨울 내부 AI(없으면 null)
   */
  @Transactional(readOnly = true)
  public Optional<WakeContext> read(WorkflowNodeWakeEvent e) {
    var issue = issueRepository.findById(e.issueId()).orElse(null);
    if (issue == null) {
      return Optional.empty();
    }
    var project = projectRepository.findById(issue.projectId()).orElse(null);
    if (project == null) {
      return Optional.empty();
    }
    UserSummary actor =
        e.actorId() == null
            ? null
            : userRepository.findById(e.actorId()).map(UserResponse::toSummary).orElse(null);
    List<AssigneeInfo> infos = userRepository.findAssigneeInfos(e.agentIds(), TenantContext.get());
    List<AssigneeInfo> ordered =
        e.agentIds().stream()
            .flatMap(id -> infos.stream().filter(i -> id.equals(i.id())).limit(1))
            .toList();
    Long woken = wokenInternalAgentId(ordered).orElse(null);
    return Optional.of(
        new WakeContext(
            project.key(),
            project.key() + "-" + issue.number(),
            issue.title(),
            actor,
            assigneeRepository.findByIssue(issue.id()),
            ordered.stream()
                .filter(a -> !ServerAgentResolver.runsOnServer(a) || a.id().equals(woken))
                .map(AssigneeInfo::toSummary)
                .toList(),
            woken));
  }

  /**
   * 노드 깨우기가 깨울 내부 AI 하나 — 노드 담당 순서의 첫 서버 실행(내부·활성) AI. 노드에 내부 AI 가 여럿이어도 하나만 깨운다: 모두 깨우면 같은 노드 일을
   * 각자 해 이동을 겹쳐 시도하고 중복 작업·비용이 두 배가 된다. 발사(이벤트 디스패처)와 노드 진입 다리의 막힘 풀기가 같은 하나만 쓰도록 이 규칙을 한 곳에 둔다.
   *
   * @param ordered 노드 담당 순서를 지킨 AI 정보
   */
  public static Optional<Long> wokenInternalAgentId(List<AssigneeInfo> ordered) {
    return ordered.stream()
        .filter(ServerAgentResolver::runsOnServer)
        .map(AssigneeInfo::id)
        .findFirst();
  }

  /**
   * 발사 payload 재료.
   *
   * @param agents 깨운 내부 AI 하나와 외부 AI 의 요약(payload added) — 깨우지 않은 내부 AI 는 없다
   * @param wokenAgentId 깨울 내부 AI 하나(없으면 null) — 발사 대상. 규칙은 {@link #wokenInternalAgentId}
   */
  public record WakeContext(
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      List<UserSummary> agents,
      Long wokenAgentId) {}
}
