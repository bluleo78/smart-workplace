package com.workplace.issue.workflow.service;

import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueAssigneesReplacedEvent;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.workflow.domain.ActiveMember;
import com.workplace.issue.workflow.domain.AssigneeResolution;
import com.workplace.issue.workflow.domain.AssigneeResolution.Resolution;
import com.workplace.issue.workflow.domain.RunRoleMembers;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModel.Condition;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.domain.WorkflowRouting;
import com.workplace.issue.workflow.domain.WorkflowRouting.Route;
import com.workplace.issue.workflow.domain.WorkflowRouting.StartMatch;
import com.workplace.issue.workflow.dto.AssignPreviewView;
import com.workplace.issue.workflow.exception.WorkflowException;
import com.workplace.issue.workflow.repository.WorkflowRepository;
import com.workplace.issue.workflow.repository.WorkflowRepository.EnabledPublishedDef;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import com.workplace.project.dto.ProjectRow;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 담당 지정 = 워크플로우 시작(WP-2120). 사람은 담당만 지정하고 시작은 규칙이 한다 — 담당 교체·이슈 생성이 내는 {@link
 * IssueAssigneesReplacedEvent} 를 같은 트랜잭션의 동기 리스너로 받아, 켜져 있고 게시된 정의 중 시작 조건이 맞는 첫 정의를 시작한다.
 *
 * <p>왜 이 서비스가 따로 있나: 실행 서비스(→ 실행 기록기)가 담당 지정 서비스를 쓰므로 담당 지정 서비스가 실행 서비스를 직접 부르면 생성자 순환이다. 그래서 담당 지정
 * 서비스는 이벤트만 내고 이 서비스가 받는다. 시작이 실패하면(배정 규칙 위반 등) 예외를 삼키지 않아 담당 교체·이슈 생성까지 되돌아간다 — 사용자에게는 한 동작이다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class WorkflowAutoStartService {

  private final WorkflowRepository workflowRepository;
  private final WorkflowRunRepository runRepository;
  private final IssueRepository issueRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final WorkflowMemberLookup memberLookup;
  private final WorkflowModelLoader modelLoader;
  private final WorkflowRunService runService;

  /**
   * 자동 시작이 고른 정의.
   *
   * @param workflowId 시작할 정의
   * @param workflowName 정의 이름
   * @param stopNode 시작이 머무는 노드 키
   * @param stopNodeName 그 노드의 이름(없으면 키)
   * @param blockedMessage 이 담당으로는 시작이 배정 규칙 위반으로 실패한다면 그 한국어 문장(시작 API 의 오류와 같은 문장), 아니면 null
   */
  public record AutoStart(
      long workflowId,
      String workflowName,
      String stopNode,
      String stopNodeName,
      String blockedMessage) {}

  /** 새로 담당이 된 사람이 있고 시작 조건이 맞는 정의가 있으면 시작한다. 동기 — 같은 트랜잭션이라 시작 실패가 담당 교체까지 되돌린다(예외를 삼키지 않는다). */
  @EventListener
  public void on(IssueAssigneesReplacedEvent e) {
    List<Long> assigneesAfter = assigneeRepository.findUserIdsByIssue(e.issueId());
    Optional<AutoStart> pick = pick(e.projectId(), e.issueId(), assigneesAfter, e.added());
    if (pick.isPresent()) {
      runService.start(e.issueId(), pick.get().workflowId(), false, e.actorId(), e.added());
    }
  }

  /**
   * 이 담당 지정으로 시작될 정의 — 정의를 id 순으로 보고, 실제 시작과 같은 함수·같은 구성원 표로 매치한 사람 중 새로 더한 사람({@code added})이 있는 첫
   * 정의. 이슈가 닫혔거나 활성 실행이 있거나 added 가 비면 없다. 시작 조건과 무관한 사람만 더한 지정(이미 맞는 담당이 따로 있어도)은 시작하지 않는다.
   *
   * @param assigneesAfter 지정 뒤의 이슈 담당
   * @param added 이번에 새로 더한 사람
   */
  @Transactional(readOnly = true)
  public Optional<AutoStart> pick(
      long projectId, long issueId, Collection<Long> assigneesAfter, Set<Long> added) {
    if (added == null || added.isEmpty() || assigneesAfter == null || assigneesAfter.isEmpty()) {
      return Optional.empty();
    }
    // 워크플로우를 켜지 않은 프로젝트가 대부분이라 정의부터 본다 — 없으면 이슈·실행 조회 없이 끝낸다(모든 담당 지정이 지나는 길).
    List<EnabledPublishedDef> defs = workflowRepository.findEnabledPublishedDefs(projectId);
    if (defs.isEmpty()) {
      return Optional.empty();
    }
    IssueRow issue = issueRepository.findById(issueId).orElse(null);
    if (issue == null || IssueStatuses.isClosed(issue.status())) {
      return Optional.empty();
    }
    if (runRepository.findActiveByIssue(issueId).isPresent()) {
      return Optional.empty();
    }
    List<ActiveMember> active = memberLookup.activeMembersOf(projectId);
    for (EnabledPublishedDef def : defs) {
      WorkflowModel model = modelLoader.get(def.activeVersionId());
      RunRoleMembers members = RunRoleMembers.of(model, active);
      Optional<StartMatch> match = WorkflowRouting.start(model, assigneesAfter, members);
      if (match.isEmpty() || match.get().matched().stream().noneMatch(added::contains)) {
        continue;
      }
      Route route =
          WorkflowRouting.route(model, match.get().to(), match.get().matched(), Map.of(), members);
      String stop = route.stopNode();
      Node node = stop == null ? null : model.nodes().get(stop);
      String stopName =
          node == null || node.name() == null || node.name().isBlank() ? stop : node.name();
      // 실제 시작(WorkflowRunService.start)과 같은 입력으로 시작 노드 담당 배정을 미리 판정한다 — 위반이면 시작이 422 로 실패해 담당 교체까지
      // 되돌아간다.
      Resolution resolution =
          AssigneeResolution.forStart(
              model, match.get(), route, new ArrayList<>(assigneesAfter), members);
      String blocked =
          resolution.violation() == null
              ? null
              : WorkflowException.fromViolation(resolution.violation()).getMessage();
      return Optional.of(new AutoStart(def.id(), def.name(), stop, stopName, blocked));
    }
    return Optional.empty();
  }

  /**
   * 담당 지정 미리보기(WP-2120) — 저장 전에 이 담당 목록이 시작시킬 워크플로우와 시작 조건 역할을 돌려준다. 읽기 권한은 이슈 실행 view 와 같은 가드(못 보면
   * 404)이고, 읽기 전용 트랜잭션이라 잠금·쓰기가 없다.
   *
   * @param userIds 지정하려는 담당 전체 목록
   * @param current 참이면 userIds 를 지금 담당으로 보고 모두를 「새로 더한 사람」으로 판정한다 — 카드가 「지금 담당으로 시작될 수 있는가」를 물을 때.
   *     거짓이면 지금 담당을 뺀 나머지만 새로 더한 사람이다(팝오버 — 실제 자동 시작과 같은 판정)
   */
  @Transactional(readOnly = true)
  public AssignPreviewView preview(
      long issueId, List<Long> userIds, boolean current, long actorId) {
    IssueRow issue = issueRepository.findById(issueId).orElseThrow(IssueNotFoundException::new);
    ProjectRow project = runService.readableProject(issue, actorId);
    Set<Long> after = new LinkedHashSet<>(userIds);
    Set<Long> added = new LinkedHashSet<>(after);
    if (!current) {
      added.removeAll(assigneeRepository.findUserIdsByIssue(issueId));
    }
    Optional<AutoStart> pick = pick(project.id(), issueId, after, added);
    AssignPreviewView.Start start =
        pick.map(
                a ->
                    new AssignPreviewView.Start(a.workflowId(), a.workflowName(), a.stopNodeName()))
            .orElse(null);
    AssignPreviewView.Blocked blocked =
        pick.map(AutoStart::blockedMessage).map(AssignPreviewView.Blocked::new).orElse(null);
    // 활성 실행이 이미 있으면 새로 더한 AI 가 일하지 않는 이유가 시작 조건이 아니라 「이미 실행 중」이다 — 웹이 경고를 내지 않게 알린다.
    boolean active = runRepository.findActiveByIssue(issueId).isPresent();
    return new AssignPreviewView(start, blocked, active, startRoles(project.id()));
  }

  /** 켜져 있고 게시된 정의들의 start 조건 assigneeRole(중복 제거, 순서 유지) — 「이 담당으로는 시작하지 않아요」 안내용. */
  @Transactional(readOnly = true)
  public List<String> startRoles(long projectId) {
    Set<String> roles = new LinkedHashSet<>();
    for (EnabledPublishedDef def : workflowRepository.findEnabledPublishedDefs(projectId)) {
      WorkflowModel model = modelLoader.get(def.activeVersionId());
      for (Condition c : model.start()) {
        if (c.assigneeRole() != null) {
          roles.add(c.assigneeRole());
        }
      }
    }
    return new ArrayList<>(roles);
  }
}
