package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.AGENT_WORK_EVENT;
import static com.workplace.jooq.Tables.ISSUE_RECURRENCE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueRecurrenceRequest;
import com.workplace.issue.dto.IssueRecurrenceRunReport;
import com.workplace.issue.outbound.IssueDomainEvents.IssueRecurringRunEvent;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * 같은 AI 의 반복 회차 줄 세우기(WP-1407) 통합 테스트 — 같은 AI 의 회차 여럿이 같은 시각이 되면 하나씩 보내고 나머지는 「대기 중」으로 두는지, 결과가 오면
 * 다음 회차가 나가는지, 다른 AI 는 병렬로 나가는지, 이어 처리·테스트 실행도 그 AI 를 바쁘게 하는지, 줄에 선 반복을 지우기·다시 저장·담당 해제하면 줄에서 빠지는지,
 * 결과 대기 시간이 40분인지.
 *
 * <p>시드: 개인 프로젝트(owner 소유) + 이슈 4건, owner 의 개인 비서(agent)를 담당으로 둔 매일 08:00 반복 4개. @Transactional 이라
 * 끝나면 롤백된다.
 */
@Transactional
@RecordApplicationEvents
class IssueRecurrenceQueueTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMemberRepository;
  @Autowired IssueService issueService;
  @Autowired IssueAssigneeRepository assigneeRepository;
  @Autowired IssueAssigneeService assigneeService;
  @Autowired PersonalAssistantRepository personalAssistantRepository;
  @Autowired AiAgentCredentialService credentialService;
  @Autowired IssueRecurrenceService recurrenceService;
  @Autowired ApplicationEvents events;
  @Autowired com.workplace.issue.repository.IssueRecurrenceRepository recurrenceRepository;
  // 기반 클래스가 spy 로 둔 빈 — 한 행만 실패하게 만든다.
  @Autowired com.workplace.issue.repository.IssueRepository issueRepository;

  private long owner;
  private long agent;
  private String key;
  private final List<Long> issueIds = new ArrayList<>();
  private final List<Integer> numbers = new ArrayList<>();

  /** 줄 세우기를 볼 회차 시각 — 지금보다 조금 앞. */
  private Instant dueAt;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, owner, "USER");
    agent = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, owner));
    personalAssistantRepository.setAgentId(owner, agent);
    var project =
        projectService.create(owner, new CreateProjectRequest(null, "개인", null, "PERSONAL"));
    key = project.key();
    projectMemberRepository.insert(project.id(), agent, "MEMBER");
    for (int i = 0; i < 4; i++) {
      var issue =
          issueService.create(
              owner,
              key,
              new CreateIssueRequest("정리 " + i, "정리해 줘", null, null, null, null, null, null));
      issueIds.add(issue.id());
      numbers.add(issue.number());
      assigneeRepository.add(issue.id(), agent, owner);
      recurrenceService.save(
          owner, key, issue.number(), new IssueRecurrenceRequest("FREQ=DAILY", "08:00"));
    }
    dueAt = Instant.now().minusSeconds(120).truncatedTo(ChronoUnit.SECONDS);
    for (long id : issueIds) setNextRunAt(id, dueAt);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  void 같은_AI의_회차_넷이_같은_시각이면_하나만_보내고_나머지는_대기중() {
    Instant now = Instant.now();
    assertThat(recurrenceService.runDue(now)).isEqualTo(1);

    var sent = sentEvents();
    assertThat(sent).hasSize(1);
    // 같은 시각이면 이슈 id 가 작은 것이 먼저다.
    assertThat(sent.get(0).issueId()).isEqualTo(issueIds.get(0));
    assertThat(work(issueIds.get(0)).get(AGENT_WORK.STATE)).isEqualTo("WORKING");

    for (long id : issueIds.subList(1, 4)) {
      Record w = work(id);
      assertThat(w.get(AGENT_WORK.STATE)).isEqualTo("WAITING");
      assertThat(w.get(AGENT_WORK.NOTE)).isEqualTo(IssueRecurrenceService.NOTE_QUEUED);
      Record r = row(id);
      assertThat(r.get(ISSUE_RECURRENCE.QUEUED_AT)).isNotNull();
      // 줄 대기 동안 회차 시각은 그대로다 — 보낼 때 옮긴다.
      assertThat(r.get(ISSUE_RECURRENCE.NEXT_RUN_AT).toInstant()).isEqualTo(dueAt);
      assertThat(r.get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isNull();
    }
    assertThat(row(issueIds.get(0)).get(ISSUE_RECURRENCE.QUEUED_AT)).isNull();
  }

  @Test
  void 앞_회차_결과_전의_다음_폴은_보내지_않고_작업_이력도_더_남기지_않는다() {
    recurrenceService.runDue(Instant.now());
    int history = historyCount(issueIds.get(1));
    Instant queuedAt = row(issueIds.get(1)).get(ISSUE_RECURRENCE.QUEUED_AT).toInstant();

    assertThat(recurrenceService.runDue(Instant.now().plusSeconds(60))).isZero();
    assertThat(sentEvents()).hasSize(1);
    // 줄에 처음 선 순간에만 상태를 바꾼다 — 매분 이력·알림이 쌓이지 않게.
    assertThat(historyCount(issueIds.get(1))).isEqualTo(history);
    assertThat(row(issueIds.get(1)).get(ISSUE_RECURRENCE.QUEUED_AT).toInstant())
        .isEqualTo(queuedAt);
  }

  @Test
  void 결과가_오면_다음_폴에서_먼저_된_회차부터_하나씩_보낸다() {
    // 셋째 이슈의 회차가 더 이르다 — 그것이 먼저, 나머지는 이슈 id 순.
    setNextRunAt(issueIds.get(2), dueAt.minusSeconds(60));
    List<Long> order = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      Instant now = Instant.now();
      assertThat(recurrenceService.runDue(now)).isEqualTo(1);
      var last = sentEvents().get(sentEvents().size() - 1);
      order.add(last.issueId());
      assertThat(work(last.issueId()).get(AGENT_WORK.STATE)).isEqualTo("WORKING");
      // 보낸 회차의 다음 회차는 지금 이후의 첫 회차다 — 밀린 시각은 합쳐진다.
      assertThat(row(last.issueId()).get(ISSUE_RECURRENCE.NEXT_RUN_AT).toInstant()).isAfter(now);
      // 결과 전에는 다음 회차가 나가지 않는다.
      assertThat(recurrenceService.runDue(now)).isZero();
      reportOk(last.issueId());
      assertThat(work(last.issueId()).get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
    }
    assertThat(order)
        .containsExactly(issueIds.get(2), issueIds.get(0), issueIds.get(1), issueIds.get(3));
    assertThat(sentEvents()).hasSize(4);
    assertThat(recurrenceService.runDue(Instant.now())).isZero();
  }

  @Test
  void 다른_AI의_회차는_같은_폴에서_함께_나간다() {
    long agent2 = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, owner));
    // 둘째 이슈는 다른 AI 가 돌린다.
    recurrenceService.save(
        owner, key, numbers.get(1), new IssueRecurrenceRequest("FREQ=DAILY", "08:00", agent2));
    setNextRunAt(issueIds.get(1), dueAt);

    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(2);
    assertThat(sentEvents())
        .extracting(IssueRecurringRunEvent::actingAgentId)
        .containsExactlyInAnyOrder(agent, agent2);
  }

  @Test
  void 테스트_실행이_결과를_기다리면_같은_AI의_다른_정기_회차가_기다린다() {
    // 첫째 이슈는 회차 시각이 아직이다 — 「지금 실행」만 돈다.
    setNextRunAt(issueIds.get(0), Instant.now().plus(1, ChronoUnit.DAYS));
    recurrenceService.runNow(owner, key, numbers.get(0));
    events.clear();

    assertThat(recurrenceService.runDue(Instant.now())).isZero();
    assertThat(sentEvents()).isEmpty();
    for (long id : issueIds.subList(1, 4)) {
      assertThat(work(id).get(AGENT_WORK.STATE)).isEqualTo("WAITING");
    }
  }

  @Test
  void 이어_처리가_결과를_기다리면_같은_AI의_다른_정기_회차가_기다리고_그_행은_대기중이_되지_않는다() {
    // 첫째 이슈에 이어 처리가 도는 중 — 그 행 자신은 회차 시각이 됐어도 「대기 중」으로 덮지 않는다(자기 실행 중).
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID, issueIds.get(0) + "-f1")
        .set(ISSUE_RECURRENCE.FOLLOW_UP_DISPATCHED_AT, Instant.now().atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueIds.get(0)))
        .execute();

    assertThat(recurrenceService.runDue(Instant.now())).isZero();
    assertThat(row(issueIds.get(0)).get(ISSUE_RECURRENCE.QUEUED_AT)).isNull();
    assertThat(work(issueIds.get(0)).get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
    for (long id : issueIds.subList(1, 4)) {
      assertThat(work(id).get(AGENT_WORK.STATE)).isEqualTo("WAITING");
    }
  }

  @Test
  void 줄에_선_반복을_지우거나_다시_저장하거나_담당에서_빼면_보내지_않고_대기중이_남지_않는다() {
    recurrenceService.runDue(Instant.now());
    // 둘째: 지움 → 작업 취소. 셋째: 다시 저장 → 다음 회차가 미래, 「다음 회차 대기」. 넷째: 담당 해제 → 반복을 거둔다.
    recurrenceService.delete(owner, key, numbers.get(1));
    recurrenceService.save(
        owner, key, numbers.get(2), new IssueRecurrenceRequest("FREQ=DAILY", "09:00"));
    assigneeService.replace(owner, key, numbers.get(3), List.of(owner));

    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueIds.get(1))))
        .isZero();
    Record resaved = row(issueIds.get(2));
    assertThat(resaved.get(ISSUE_RECURRENCE.QUEUED_AT)).isNull();
    assertThat(work(issueIds.get(2)).get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueIds.get(3))))
        .isZero();
    assertThat(activeWorkOrNull(issueIds.get(1))).isNull();
    assertThat(activeWorkOrNull(issueIds.get(3))).isNull();

    // 앞 회차가 끝나도 지운·거둔·미래로 옮긴 회차는 나가지 않는다.
    reportOk(issueIds.get(0));
    assertThat(recurrenceService.runDue(Instant.now())).isZero();
    assertThat(sentEvents()).hasSize(1);
  }

  @Test
  void 결과_대기는_40분이라_35분은_실패로_세지_않고_41분이면_세고_같은_폴에서_다음_회차가_나간다() {
    recurrenceService.runDue(Instant.now());
    long first = issueIds.get(0);

    setLastRunAt(first, Instant.now().minus(35, ChronoUnit.MINUTES));
    assertThat(recurrenceService.runDue(Instant.now())).isZero();
    assertThat(row(first).get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isZero();
    assertThat(row(first).get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isNotNull();

    setLastRunAt(first, Instant.now().minus(41, ChronoUnit.MINUTES));
    // 정리가 앞 회차를 결과를 못 받은 실패로 세고, 정리 뒤에 읽으므로 같은 폴에서 다음 회차(둘째)가 나간다.
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    assertThat(row(first).get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isEqualTo(1);
    assertThat(row(first).get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isNull();
    assertThat(sentEvents().get(sentEvents().size() - 1).issueId()).isEqualTo(issueIds.get(1));
  }

  @Test
  void 사람의_답을_기다리는_질문이_있는_회차는_대기중으로_덮지_않고_차례가_오면_나간다() {
    // 둘째 이슈의 반복이 사람의 답을 기다리는 질문을 남겼다 — 작업 메모는 그 질문 상태다.
    long asked = issueIds.get(1);
    recurrenceRepository.setPendingQuestion(asked, 1L, "메일을 보낼까요?", Instant.now(), null, null);
    String noteBefore = work(asked).get(AGENT_WORK.NOTE);
    String stateBefore = work(asked).get(AGENT_WORK.STATE);

    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    assertThat(row(asked).get(ISSUE_RECURRENCE.QUEUED_AT)).isNull();
    assertThat(work(asked).get(AGENT_WORK.STATE)).isEqualTo(stateBefore);
    assertThat(work(asked).get(AGENT_WORK.NOTE)).isEqualTo(noteBefore);
    // 질문이 없는 나머지는 「대기 중」.
    assertThat(work(issueIds.get(2)).get(AGENT_WORK.STATE)).isEqualTo("WAITING");

    // 앞 회차가 끝나면 차례대로(이슈 id 순 — 둘째) 나간다.
    reportOk(issueIds.get(0));
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    assertThat(sentEvents().get(sentEvents().size() - 1).issueId()).isEqualTo(asked);
  }

  @Test
  void 대기중_표시가_실패한_회차는_줄_표시를_남기지_않고_다음_폴에서_다시_시도한다() {
    long failing = issueIds.get(1);
    // 줄 표시 중 그 이슈를 읽다가 실패한다(세이브포인트로 그 행만 되돌린다).
    Mockito.doThrow(new IllegalStateException("boom")).when(issueRepository).findById(failing);
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    assertThat(row(failing).get(ISSUE_RECURRENCE.QUEUED_AT)).isNull();
    assertThat(work(failing).get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
    // 다른 행은 표시됐다.
    assertThat(row(issueIds.get(2)).get(ISSUE_RECURRENCE.QUEUED_AT)).isNotNull();

    Mockito.doCallRealMethod().when(issueRepository).findById(failing);
    assertThat(recurrenceService.runDue(Instant.now())).isZero();
    assertThat(row(failing).get(ISSUE_RECURRENCE.QUEUED_AT)).isNotNull();
    assertThat(work(failing).get(AGENT_WORK.STATE)).isEqualTo("WAITING");
  }

  @Test
  void 한_AI의_대기_회차가_묶음_한도를_넘어도_다른_AI의_회차는_같은_폴에서_나간다() {
    // 첫 AI 의 회차를 묶음 한도(100)보다 많이 둔다 — 모두 다른 AI 의 회차보다 이르다.
    int many = 100 + 5;
    for (int i = 0; i < many; i++) {
      var issue =
          issueService.create(
              owner,
              key,
              new CreateIssueRequest("추가 " + i, "정리해 줘", null, null, null, null, null, null));
      assigneeRepository.add(issue.id(), agent, owner);
      recurrenceService.save(
          owner, key, issue.number(), new IssueRecurrenceRequest("FREQ=DAILY", "08:00"));
      setNextRunAt(issue.id(), dueAt.minusSeconds(600));
    }
    long agent2 = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, owner));
    recurrenceService.save(
        owner, key, numbers.get(3), new IssueRecurrenceRequest("FREQ=DAILY", "08:00", agent2));
    setNextRunAt(issueIds.get(3), dueAt);

    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(2);
    assertThat(sentEvents())
        .extracting(IssueRecurringRunEvent::actingAgentId)
        .containsExactlyInAnyOrder(agent, agent2);
  }

  // ───────────────────────────── 도우미 ─────────────────────────────

  private List<IssueRecurringRunEvent> sentEvents() {
    return events.stream(IssueRecurringRunEvent.class).toList();
  }

  /** 그 이슈 회차의 결과를 성공으로 보고한다(실행 AI 로). */
  private void reportOk(long issueId) {
    String runId = row(issueId).get(ISSUE_RECURRENCE.PENDING_RUN_ID);
    recurrenceService.reportRun(
        agent, issueId, new IssueRecurrenceRunReport(runId, true, "결과", false));
  }

  private void setNextRunAt(long issueId, Instant t) {
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.NEXT_RUN_AT, t.atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  private void setLastRunAt(long issueId, Instant t) {
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.LAST_RUN_AT, t.atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  private Record row(long issueId) {
    return dsl.selectFrom(ISSUE_RECURRENCE).where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId)).fetchOne();
  }

  private Record work(long issueId) {
    Record r = activeWorkOrNull(issueId);
    assertThat(r).as("진행 중 AI 작업 issueId=" + issueId).isNotNull();
    return r;
  }

  private Record activeWorkOrNull(long issueId) {
    return dsl.selectFrom(AGENT_WORK)
        .where(AGENT_WORK.ISSUE_ID.eq(issueId))
        .and(AGENT_WORK.WORKER_ID.eq(agent))
        .and(AGENT_WORK.ENDED_AT.isNull())
        .fetchOne();
  }

  /** 그 이슈에서 AI 작업 기록이 남긴 이력 수. */
  private int historyCount(long issueId) {
    return dsl.fetchCount(
        dsl.select(AGENT_WORK_EVENT.ID)
            .from(AGENT_WORK_EVENT)
            .join(AGENT_WORK)
            .on(AGENT_WORK.ID.eq(AGENT_WORK_EVENT.WORK_ID))
            .where(AGENT_WORK.ISSUE_ID.eq(issueId)));
  }
}
