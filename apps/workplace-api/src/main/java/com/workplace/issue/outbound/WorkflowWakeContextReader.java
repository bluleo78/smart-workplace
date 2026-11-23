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
   * @return internalAgentIds 는 깨울 AI 중 서버가 실행할(내부·이 워크스페이스에서 활성) AI — 이벤트 순서를 지킨다
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
    return Optional.of(
        new WakeContext(
            project.key(),
            project.key() + "-" + issue.number(),
            issue.title(),
            actor,
            assigneeRepository.findByIssue(issue.id()),
            ordered.stream().map(AssigneeInfo::toSummary).toList(),
            ordered.stream()
                .filter(ServerAgentResolver::runsOnServer)
                .map(AssigneeInfo::id)
                .toList()));
  }

  /**
   * 발사 payload 재료.
   *
   * @param agents 깨울 노드 AI 의 요약(payload added)
   * @param internalAgentIds 그중 서버가 실행할 AI — 하나마다 발사한다
   */
  public record WakeContext(
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      List<UserSummary> agents,
      List<Long> internalAgentIds) {}
}
