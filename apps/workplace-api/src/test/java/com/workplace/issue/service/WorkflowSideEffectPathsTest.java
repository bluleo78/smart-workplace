package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.security.AgentToolContext;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.exception.InactiveAssigneeException;
import com.workplace.issue.exception.InvalidAssigneeForProjectException;
import com.workplace.issue.outbound.AgentToolWriteEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueHumanReplyPosted;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.watcher.repository.IssueWatcherRepository;
import jakarta.validation.ConstraintViolationException;
import java.util.Set;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * 워크플로우 이동이 쓰는 담당·댓글 좁은 경로(WP-1985) 통합 테스트 — {@code applyWorkflowChange}·{@code createForWorkflow}
 * 가 이력·워처·알림 이벤트는 기존 경로와 같게 내고, 내부 AI 실행(wakeAgent=false)과 agent_work 변화는 내지 않는지 본다.
 *
 * <p>@Transactional 이라 AFTER_COMMIT 리스너(ai-agent 발사·알림)는 돌지 않는다. agent_work 를 바꾸는 리스너는 동기
 * {@code @EventListener}(AgentWorkService)라 같은 트랜잭션에서 돌므로, agent_work 행 단언이 실제 누수를 잡는다.
 */
@RecordApplicationEvents
@Transactional
class WorkflowSideEffectPathsTest extends IntegrationTestBase {

  @Autowired IssueAssigneeService assigneeService;
  @Autowired IssueCommentService commentService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueAssigneeRepository assigneeRepository;
  @Autowired IssueHistoryRepository historyRepository;
  @Autowired IssueWatcherRepository watcherRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired ProjectMemberRepository projectMemberRepository;
  @Autowired DSLContext dsl;
  @Autowired ApplicationEvents events;

  private OpenScenario.Result s;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    s = OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
    // 소유자·멤버를 실제 사용자처럼 — 워크스페이스 활성 구성원 + 기본 권한(issue:write 등).
    withMembership(s.ownerId());
    grantUserRole(s.ownerId());
    withMembership(s.memberId());
    grantUserRole(s.memberId());
  }

  /** 호출자(이동 서비스)가 하는 것처럼 이슈 행을 잠가 읽는다. */
  private IssueRow lockIssue() {
    return issueRepository
        .findByProjectAndNumberForUpdate(s.project().id(), s.issueNumber())
        .orElseThrow();
  }

  /** 프로젝트 멤버 AI — runtime 은 INTERNAL|EXTERNAL. */
  private long projectAgent(String prefix, String runtime) {
    long agent = createAgentUserWithMembership(prefix);
    dsl.update(USER).set(USER.AGENT_RUNTIME, runtime).where(USER.ID.eq(agent)).execute();
    projectMemberRepository.insert(s.project().id(), agent, "MEMBER");
    return agent;
  }

  /** 이슈·작업자 하나의 agent_work 상태(없으면 null). */
  private String workState(long workerId) {
    return dsl.select(AGENT_WORK.STATE)
        .from(AGENT_WORK)
        .where(AGENT_WORK.ISSUE_ID.eq(s.issueId()))
        .and(AGENT_WORK.WORKER_ID.eq(workerId))
        .fetchOne(AGENT_WORK.STATE);
  }

  private void seedWork(long workerId, String state) {
    dsl.insertInto(AGENT_WORK)
        .set(AGENT_WORK.ISSUE_ID, s.issueId())
        .set(AGENT_WORK.WORKER_ID, workerId)
        .set(AGENT_WORK.TOOL, "claude-code")
        .set(AGENT_WORK.STATE, state)
        .execute();
  }

  /** 넣고 빼면 담당·이력·워처가 바뀌고, 담당 변경 이벤트는 깨우지 않는 표시(wakeAgent=false)로 나간다. diff 0 이면 이벤트가 없다. */
  @Test
  void applyWorkflowChange_changesAssignees_history_watcher_event() {
    assigneeService.applyWorkflowChange(
        s.ownerId(), s.project(), lockIssue(), Set.of(s.memberId()), Set.of());

    assertThat(assigneeRepository.findUserIdsByIssue(s.issueId())).containsExactly(s.memberId());
    assertThat(historyRepository.findByIssue(s.issueId()))
        .filteredOn(h -> "ASSIGNEES_CHANGED".equals(h.eventType()))
        .hasSize(1);
    assertThat(watcherRepository.findUserIdsByIssue(s.issueId())).contains(s.memberId());
    var added = events.stream(IssueAssignedEvent.class).toList();
    assertThat(added).hasSize(1);
    assertThat(added.getFirst().wakeAgent()).isFalse();
    assertThat(added.getFirst().added()).extracting(UserSummary::id).containsExactly(s.memberId());

    // 이미 담당인 사람을 다시 넣고, 담당이 아닌 사람을 빼면 아무 일도 없다(이력·이벤트 없음).
    assigneeService.applyWorkflowChange(
        s.ownerId(), s.project(), lockIssue(), Set.of(s.memberId()), Set.of(s.ownerId()));
    assertThat(events.stream(IssueAssignedEvent.class)).hasSize(1);

    assigneeService.applyWorkflowChange(
        s.ownerId(), s.project(), lockIssue(), Set.of(), Set.of(s.memberId()));

    assertThat(assigneeRepository.findUserIdsByIssue(s.issueId())).isEmpty();
    var all = events.stream(IssueAssignedEvent.class).toList();
    assertThat(all).hasSize(2);
    assertThat(all.get(1).wakeAgent()).isFalse();
    assertThat(all.get(1).removed()).extracting(UserSummary::id).containsExactly(s.memberId());
    assertThat(historyRepository.findByIssue(s.issueId()))
        .filteredOn(h -> "ASSIGNEES_CHANGED".equals(h.eventType()))
        .hasSize(2);
  }

  /** 외부 AI 를 넣어도 시작 전 작업이 생기지 않고, 일하던 AI 를 빼도 그 작업은 WORKING 그대로다. */
  @Test
  void applyWorkflowChange_noAgentWorkChange() {
    long external = projectAgent("wf-ext", "EXTERNAL");
    long working = projectAgent("wf-work", "EXTERNAL");
    assigneeRepository.add(s.issueId(), working, s.ownerId());
    seedWork(working, "WORKING");

    assigneeService.applyWorkflowChange(
        s.ownerId(), s.project(), lockIssue(), Set.of(external), Set.of(working));

    assertThat(assigneeRepository.findUserIdsByIssue(s.issueId())).containsExactly(external);
    assertThat(
            dsl.fetchCount(
                AGENT_WORK,
                AGENT_WORK.ISSUE_ID.eq(s.issueId()).and(AGENT_WORK.WORKER_ID.eq(external))))
        .isZero();
    assertThat(workState(working)).isEqualTo("WORKING");
  }

  /** 새로 넣는 사람이 프로젝트 구성원이 아니거나 비활성이면 거절하고 담당은 그대로다. */
  @Test
  void applyWorkflowChange_nonMemberOrInactive_rejected() {
    withMembership(s.strangerId());
    assertThatThrownBy(
            () ->
                assigneeService.applyWorkflowChange(
                    s.ownerId(), s.project(), lockIssue(), Set.of(s.strangerId()), Set.of()))
        .isInstanceOf(InvalidAssigneeForProjectException.class);

    dsl.update(USER).set(USER.IS_ACTIVE, false).where(USER.ID.eq(s.memberId())).execute();
    assertThatThrownBy(
            () ->
                assigneeService.applyWorkflowChange(
                    s.ownerId(), s.project(), lockIssue(), Set.of(s.memberId()), Set.of()))
        .isInstanceOf(InactiveAssigneeException.class);

    assertThat(assigneeRepository.findUserIdsByIssue(s.issueId())).isEmpty();
    assertThat(events.stream(IssueAssignedEvent.class)).isEmpty();
  }

  /**
   * 의견 댓글은 저장·워처와 댓글 이벤트(wakeAgent=false)만 낸다 — 사람이 MCP 헤더로 써도
   * IssueHumanReplyPosted·AgentToolWriteEvent 가 없다.
   */
  @Test
  void createForWorkflow_publishesCommentEventOnly() {
    AgentToolContext.set("claude-code");
    try {
      var resp =
          commentService.createForWorkflow(
              s.ownerId(), s.issueId(), new CreateCommentRequest("검토 의견입니다"));
      assertThat(resp.body()).isEqualTo("검토 의견입니다");
    } finally {
      AgentToolContext.clear();
    }

    var commented = events.stream(IssueCommentedEvent.class).toList();
    assertThat(commented).hasSize(1);
    assertThat(commented.getFirst().wakeAgent()).isFalse();
    assertThat(commented.getFirst().actorCanWriteContent()).isTrue();
    assertThat(commented.getFirst().commentBody()).isEqualTo("검토 의견입니다");
    assertThat(events.stream(IssueHumanReplyPosted.class)).isEmpty();
    assertThat(events.stream(AgentToolWriteEvent.class)).isEmpty();
    assertThat(watcherRepository.findUserIdsByIssue(s.issueId())).contains(s.ownerId());
  }

  /** 답변 필요로 멈춘 AI 작업은 사람의 의견 댓글로도, MCP 헤더를 단 그 AI 의 의견 댓글로도 되돌아가지 않는다. */
  @Test
  void createForWorkflow_keepsInterruptedWork() {
    long agent = projectAgent("wf-ask", "EXTERNAL");
    assigneeRepository.add(s.issueId(), agent, s.ownerId());
    seedWork(agent, "INPUT_REQUIRED");

    // 사람(쓰기 권한자)의 의견 — 일반 댓글이면 IssueHumanReplyPosted 로 WORKING 이 된다.
    commentService.createForWorkflow(s.ownerId(), s.issueId(), new CreateCommentRequest("사람 의견"));
    assertThat(workState(agent)).isEqualTo("INPUT_REQUIRED");

    // 담당 AI 가 MCP 헤더로 쓴 의견 — 일반 댓글이면 AgentToolWriteEvent 로 WORKING 이 된다.
    AgentToolContext.set("claude-code");
    try {
      commentService.createForWorkflow(agent, s.issueId(), new CreateCommentRequest("AI 의견"));
    } finally {
      AgentToolContext.clear();
    }
    assertThat(workState(agent)).isEqualTo("INPUT_REQUIRED");
    assertThat(events.stream(IssueHumanReplyPosted.class)).isEmpty();
    assertThat(events.stream(AgentToolWriteEvent.class)).isEmpty();
  }

  /** 컨트롤러 밖 경로라도 댓글 API 와 같은 본문 검증 — 보이는 글자 없는(제로폭만) 의견은 400 필드 오류로 거절, 댓글이 남지 않는다. */
  @Test
  void createForWorkflow_invisibleOnlyBody_rejectedLikeCommentApi() {
    assertThatThrownBy(
            () ->
                commentService.createForWorkflow(
                    s.ownerId(), s.issueId(), new CreateCommentRequest(TestFixtures.ZWSP)))
        .isInstanceOf(ConstraintViolationException.class);
    assertThatThrownBy(
            () ->
                commentService.createForWorkflow(
                    s.ownerId(), s.issueId(), new CreateCommentRequest("   ")))
        .isInstanceOf(ConstraintViolationException.class);

    assertThat(dsl.fetchCount(ISSUE_COMMENT, ISSUE_COMMENT.ISSUE_ID.eq(s.issueId()))).isZero();
    assertThat(events.stream(IssueCommentedEvent.class)).isEmpty();
  }
}
