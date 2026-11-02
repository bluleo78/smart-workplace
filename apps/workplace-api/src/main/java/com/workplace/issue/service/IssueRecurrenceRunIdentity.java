package com.workplace.issue.service;

import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.Optional;
import java.util.OptionalLong;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 반복 회차의 도구를 돌릴 신원(WP-1314)을 정한다 — 정기 회차({@link IssueRecurrenceService})와 질문의 답을 받은 이어 처리({@link
 * IssueRecurrenceFollowUpService}, WP-1312)가 같은 규칙을 쓰도록 한 곳에 둔다. 이어 처리 서비스는 빈 순환 때문에 반복 서비스에 의존할 수
 * 없어(그 서비스 → 챗 포스터 → ChatMessageService → 답 포트) 두 서비스가 함께 쓰는 별도 빈으로 뺐다. 이 빈은 chat 쪽 빈에 의존하지 않는다.
 */
@Component
@RequiredArgsConstructor
public class IssueRecurrenceRunIdentity {

  private final PersonalAssistantRepository personalAssistantRepository;
  private final WorkspaceAssistantRepository workspaceAssistantRepository;
  private final ProjectAccessGuard accessGuard;

  /**
   * 회차의 도구를 돌릴 신원 — 개인 비서는 그 주인 대행, 개인 작업의 공용 비서는 프로젝트 소유자 대행(WP-989 그대로), 그 밖의 AI 는 자기 신원이다(이벤트의
   * ownerUserId — ai-agent 가 이 id 로 X-On-Behalf-Of 를 싣는다). 저장한 사람이 아니라 AI 로 정해, 누가 저장해도 대행 주인이 바뀌지
   * 않는다.
   */
  public long runAsOf(long agentId, ProjectRow project) {
    Optional<Long> owner = personalAssistantRepository.findOwnerId(agentId);
    if (owner.isPresent()) return owner.get();
    boolean workspaceAssistant =
        workspaceAssistantRepository.findAgentId().filter(id -> id == agentId).isPresent();
    if (workspaceAssistant && "PERSONAL".equals(project.type())) return project.ownerId();
    return agentId;
  }

  /**
   * 회차·이어 처리를 돌려도 되는 신원 — {@link #runAsOf} 이되, 대행할 주인이 이 프로젝트를 더는 볼 수 없으면(프로젝트에서 빠짐) 빈 값이다. 그 사람
   * 권한으로 결과를 남기지 않도록 호출자는 빈 값이면 실행하지 않는다(정기 회차는 일정을 거둔다).
   */
  public OptionalLong resolve(long agentId, ProjectRow project) {
    long runAs = runAsOf(agentId, project);
    if (runAs != agentId && !accessGuard.canRead(project, runAs)) return OptionalLong.empty();
    return OptionalLong.of(runAs);
  }
}
