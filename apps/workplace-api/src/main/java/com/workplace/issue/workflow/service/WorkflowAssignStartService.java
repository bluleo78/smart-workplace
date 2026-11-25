package com.workplace.issue.workflow.service;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueAssigneeService;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 「지정하고 바로 시작」(WP-1986 설계 §5-3·§9-7) — 담당 교체와 워크플로우 시작을 한 트랜잭션으로 묶는다. 시작이 실패하면(시작 역할 없음·이미 활성 등) 담당
 * 교체까지 롤백되고 그 오류가 그대로 나간다 — 사용자에게는 한 동작이다.
 *
 * <p>왜 따로 두나: 실행 서비스(→ 실행 기록기)가 담당 지정 서비스를 쓰므로, 담당 지정 서비스가 실행 서비스를 알면 생성자 순환이 된다. 이 작은 서비스가 둘을 위에서
 * 부른다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class WorkflowAssignStartService {

  private final IssueAssigneeService assigneeService;
  private final WorkflowRunService runService;
  private final ProjectAccessGuard accessGuard;
  private final IssueRepository issueRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final WorkflowRunRepository runRepository;

  /**
   * 담당을 통째로 바꾼 뒤 같은 트랜잭션에서 정의를 시작한다. 시작 조건은 바뀐 담당으로 판정하고, 시작이 머무는 노드까지 들어가 노드 진입으로 AI 를 깨운다(켠 프로젝트라
   * 담당 교체 자체는 깨우지 않는다).
   *
   * @return 시작까지 반영한 최종 담당 요약(시작이 노드 담당을 더할 수 있다) — 담당 교체 응답과 같은 모양
   */
  public List<UserSummary> replaceAndStart(
      long callerId, String projectKey, int number, List<Long> userIds, long workflowId) {
    // 교체 전 담당을 이슈 행을 잠근 채 읽는다 — 교체가 같은 순서(이슈 행 잠금 → 담당)로 다시 잠그므로(같은 트랜잭션이라 다시 들어간다) 그사이 다른 교체가
    // 끼어 「새로 넣은 사람」이 어긋나지 않는다.
    var project = accessGuard.assertMember(projectKey, callerId);
    long issueId =
        issueRepository
            .findByProjectAndNumberForUpdate(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number))
            .id();
    Set<Long> before = new HashSet<>(assigneeRepository.findUserIdsByIssue(issueId));
    // 교체 전부터 활성 실행이 있었는지 — 있었으면 옛 동작(명시 시작 → 409 alreadyActive)을 그대로 둔다.
    boolean activeBefore = runRepository.findActiveByIssue(issueId).isPresent();
    assigneeService.replace(callerId, projectKey, number, userIds);
    // 교체가 새로 넣은 사람은 담당 변경 이벤트로 ASSIGNED 를 이미 받는다 — 시작 노드가 그 사람을 맡아도 진입 깨우기가 ASSIGNED 를 다시 보내지
    // 않게 넘긴다(원장 R3 진입당 ASSIGNED 하나, 최종 리뷰 I3).
    Set<Long> notified = new HashSet<>(userIds == null ? List.of() : userIds);
    notified.removeAll(before);
    // WP-2120 이 교체 때문에 실행이 활성이 됐으면(자동 시작) 명시 시작을 건너뛴다 — 옛 웹(롤링 배포 중)이 startWorkflowId 를 같이 보내도 이중
    // 시작이 되지 않는다. 교체 전부터 활성이었거나 자동 시작이 없었으면 지금처럼 명시 시작(409 alreadyActive·조건 불일치 422)이다.
    boolean startedByReplace =
        !activeBefore && runRepository.findActiveByIssue(issueId).isPresent();
    if (!startedByReplace) {
      runService.start(issueId, workflowId, false, callerId, notified);
    }
    return assigneeRepository.findByIssue(issueId);
  }
}
