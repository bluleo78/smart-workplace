package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.AGENT_WORK_EVENT;
import static com.workplace.jooq.Tables.ISSUE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doReturn;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.dto.AgentWorkView;
import com.workplace.issue.exception.AgentWorkIssueClosedException;
import com.workplace.issue.outbound.AgentToolWriteEvent;
import com.workplace.issue.outbound.IssueHumanReplyPosted;
import com.workplace.issue.repository.AgentWorkRepository;
import com.workplace.issue.repository.AgentWorkRepository.AgentWorkRow;
import com.workplace.issue.repository.AgentWorkRepository.InsertOutcome;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.dto.AgentRuntime;
import com.workplace.user.outbound.AgentRuntimeChanged;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/** AgentWorkService 통합 테스트(WP-377) — 보고 생성/갱신·급한 순 정렬과 무소식·사람 응답 복귀·일괄 종료. */
@Transactional
@RecordApplicationEvents
class AgentWorkServiceTest extends IntegrationTestBase {

  @Autowired AgentWorkService service;
  // 스파이 — 평소엔 실제 저장소로 위임하고, 충돌 직후 종료 경합 테스트에서만 insertOutcome 결과를 바꾼다.
  @MockitoSpyBean AgentWorkRepository repo;
  @Autowired DSLContext dsl;
  @Autowired ApplicationEvents events;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;
  @Autowired IssueAssigneeRepository assigneeRepository;

  long humanId;
  long agentId;
  long issueId;

  /** 사람·AI 구성원과 프로젝트의 이슈 1건을 만든다. */
  @BeforeEach
  void setUp() {
    humanId = TestFixtures.createHuman(dsl);
    agentId = TestFixtures.createAgentNoToken(dsl);
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6);
    var project =
        projectService.create(humanId, new CreateProjectRequest("W" + suffix, "PW-" + suffix, "x"));
    issueId =
        IssueSeeds.insert(
                issueRepository, baseDsl, project.id(), 1, "i1", null, "MID", null, humanId)
            .id();
  }

  /** 진행 중 작업을 만들고 행만 돌려준다(충돌이면 기존 행). */
  private Optional<AgentWorkRow> insert(long issue, long worker, String tool, String state) {
    return repo.insertOutcome(issue, worker, tool, state).map(InsertOutcome::row);
  }

  @Test
  void startOrUpdate_없으면_WORKING_생성_있으면_보낸필드만() {
    var v = service.startOrUpdate(issueId, humanId, "claude-code", AgentWorkPatch.empty());
    assertThat(v.state()).isEqualTo("WORKING");
    var v2 =
        service.startOrUpdate(
            issueId,
            humanId,
            "cursor",
            new AgentWorkPatch(null, "REVIEW", "PR 올림", false, 100, null, null));
    assertThat(v2.state()).isEqualTo("REVIEW");
    assertThat(v2.tool()).isEqualTo("cursor");
    assertThat(v2.note()).isEqualTo("PR 올림");
  }

  /** NEXT_RUN_AT 을 작업자 행에 직접 심는다(DB 시계 기준 과거 시각 재현용). */
  private void setNextRunAt(long workerId, OffsetDateTime at) {
    dsl.update(AGENT_WORK)
        .set(AGENT_WORK.NEXT_RUN_AT, at)
        .where(AGENT_WORK.WORKER_ID.eq(workerId))
        .execute();
  }

  /**
   * WP-450: 다음 회차 대기(SCHEDULED)는 예정 시각이 2시간 넘게 지났을 때만 overdue — 미래·최근·시각 없음은 아니고 stale 은 항상 아니다.
   */
  @Test
  void viewsByIssueIds_SCHEDULED_예정시각이_2시간_넘게_지나면_overdue() {
    service.startOrUpdate(
        issueId,
        humanId,
        "claude-code",
        AgentWorkPatch.empty()
            .withState("SCHEDULED")
            .withNextRunAt(Instant.now().plusSeconds(3600)));
    service.startOrUpdate(
        issueId, agentId, "claude-code", AgentWorkPatch.empty().withState("SCHEDULED"));

    // 미래 예정 + 시각 없음 — 둘 다 overdue 아님(시각 없음은 updated_at 이 오래돼도 아니다).
    dsl.update(AGENT_WORK)
        .set(AGENT_WORK.UPDATED_AT, OffsetDateTime.now().minusHours(5))
        .where(AGENT_WORK.WORKER_ID.eq(agentId))
        .execute();
    assertThat(service.viewsByIssueIds(List.of(issueId)).get(issueId))
        .extracting(AgentWorkView::overdue)
        .containsOnly(false);

    // 예정 시각이 1시간 전 — 아직 아님, 3시간 전 — overdue.
    setNextRunAt(humanId, OffsetDateTime.now().minusHours(1));
    assertThat(service.viewsByIssueIds(List.of(issueId)).get(issueId))
        .extracting(AgentWorkView::overdue)
        .containsOnly(false);
    setNextRunAt(humanId, OffsetDateTime.now().minusHours(3));
    var list = service.viewsByIssueIds(List.of(issueId)).get(issueId);
    assertThat(list)
        .filteredOn(AgentWorkView::overdue)
        .extracting(v -> v.worker().id())
        .containsExactly(humanId);
    assertThat(list).extracting(AgentWorkView::stale).containsOnly(false);
  }

  @Test
  void viewsByIssueIds_급한순_정렬과_무소식() {
    service.startOrUpdate(issueId, humanId, "claude-code", AgentWorkPatch.empty());
    service.startOrUpdate(
        issueId,
        agentId,
        "claude-code",
        new AgentWorkPatch(null, "INPUT_REQUIRED", "질문", false, null, null, null));
    // 사람 작업을 3시간 전으로 — 무소식
    dsl.update(AGENT_WORK)
        .set(AGENT_WORK.UPDATED_AT, OffsetDateTime.now().minusHours(3))
        .where(AGENT_WORK.WORKER_ID.eq(humanId))
        .execute();
    var list = service.viewsByIssueIds(List.of(issueId)).get(issueId);
    assertThat(list).extracting(AgentWorkView::state).containsExactly("INPUT_REQUIRED", "WORKING");
    assertThat(list.get(1).stale()).isTrue();
    assertThat(list.get(0).stale()).isFalse(); // INPUT_REQUIRED 은 무소식 경고 없음
  }

  @Test
  void onHumanReply_는_AI구성원_답변필요를_작업중으로() {
    service.startOrUpdate(
        issueId,
        agentId,
        "claude-code",
        new AgentWorkPatch(null, "INPUT_REQUIRED", null, false, null, null, null));
    service.onHumanReply(new IssueHumanReplyPosted(issueId));
    assertThat(repo.findActive(issueId, agentId).orElseThrow().state()).isEqualTo("WORKING");
  }

  /** INPUT_REQUIRED 에서 새 note 없이 다른 상태로 보고하면 질문 note 를 지운다. */
  @Test
  void 보고_INPUT_REQUIRED에서_note없이_WORKING이면_note_지움() {
    service.startOrUpdate(
        issueId,
        agentId,
        "claude-code",
        new AgentWorkPatch(null, "INPUT_REQUIRED", "A안/B안 중 무엇으로 할까요?", false, null, null, null));
    var v =
        service.startOrUpdate(
            issueId,
            agentId,
            "claude-code",
            new AgentWorkPatch(null, "WORKING", null, false, null, null, null));
    assertThat(v.state()).isEqualTo("WORKING");
    assertThat(v.note()).isNull();
  }

  /** INPUT_REQUIRED 에서 새 note 와 함께 보고하면 새 note 를 쓴다. */
  @Test
  void 보고_INPUT_REQUIRED에서_새_note면_새_note() {
    service.startOrUpdate(
        issueId,
        agentId,
        "claude-code",
        new AgentWorkPatch(null, "INPUT_REQUIRED", "질문", false, null, null, null));
    var v =
        service.startOrUpdate(
            issueId,
            agentId,
            "claude-code",
            new AgentWorkPatch(null, "WORKING", "A안으로 진행", false, null, null, null));
    assertThat(v.note()).isEqualTo("A안으로 진행");
  }

  @Test
  void onHumanReply_는_질문_note_를_지움() {
    service.startOrUpdate(
        issueId,
        agentId,
        "claude-code",
        new AgentWorkPatch(null, "INPUT_REQUIRED", "질문", false, null, null, null));
    service.onHumanReply(new IssueHumanReplyPosted(issueId));
    var row = repo.findActive(issueId, agentId).orElseThrow();
    assertThat(row.state()).isEqualTo("WORKING");
    assertThat(row.note()).isNull();
  }

  /** MCP 쓰기 터치로 INPUT_REQUIRED → WORKING 복귀 시 note 를 지운다. */
  @Test
  void 터치_INPUT_REQUIRED_복귀시_note_지움() {
    assigneeRepository.add(issueId, humanId, humanId);
    service.startOrUpdate(
        issueId,
        humanId,
        "claude-code",
        new AgentWorkPatch(null, "INPUT_REQUIRED", "질문", false, null, null, null));
    service.onAgentToolWrite(
        new AgentToolWriteEvent(issueId, humanId, "claude-code", true, false, false));
    var row = repo.findActive(issueId, humanId).orElseThrow();
    assertThat(row.state()).isEqualTo("WORKING");
    assertThat(row.note()).isNull();
  }

  /** BLOCKED 는 복귀해도 사유 note 를 유지한다. */
  @Test
  void 터치_BLOCKED_복귀시_note_유지() {
    assigneeRepository.add(issueId, humanId, humanId);
    service.startOrUpdate(
        issueId,
        humanId,
        "claude-code",
        new AgentWorkPatch(null, "BLOCKED", "권한 없음", false, null, null, null));
    service.onAgentToolWrite(
        new AgentToolWriteEvent(issueId, humanId, "claude-code", true, false, false));
    var row = repo.findActive(issueId, humanId).orElseThrow();
    assertThat(row.state()).isEqualTo("WORKING");
    assertThat(row.note()).isEqualTo("권한 없음");
  }

  @Test
  void startOrUpdate_종료된_이슈면_NPE_대신_AgentWorkIssueClosedException() {
    // 보고 검증을 우회해 서비스를 직접 호출 — 동시 종료로 조회에서 이슈가 빠지는 경합과 같은 상황.
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, "DONE")
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, "DONE"))
        .where(ISSUE.ID.eq(issueId))
        .execute();
    assertThatThrownBy(
            () -> service.startOrUpdate(issueId, humanId, "claude-code", AgentWorkPatch.empty()))
        .isInstanceOf(AgentWorkIssueClosedException.class);
  }

  /**
   * insert 가 진행 중 행과 충돌했는데 돌려받기 전에 그 행이 종료돼 조회가 비는 경합 — 500(IllegalStateException)이 아니라 409 로 답한다.
   * 경합은 저장소의 insertOutcome 이 빈 결과를 돌려주는 것으로 재현한다.
   */
  @Test
  void startOrUpdate_충돌한_행이_그사이_종료되면_409_AgentWorkIssueClosedException() {
    doReturn(Optional.empty())
        .when(repo)
        .insertOutcome(anyLong(), anyLong(), any(), any(), any(), any(), any(), any(), any());
    assertThatThrownBy(
            () -> service.startOrUpdate(issueId, humanId, "claude-code", AgentWorkPatch.empty()))
        .isInstanceOf(AgentWorkIssueClosedException.class);
  }

  @Test
  void end_는_진행중이면_true_없으면_false() {
    service.startOrUpdate(issueId, humanId, "claude-code", AgentWorkPatch.empty());
    assertThat(service.end(issueId, humanId, "FAILED", null)).isTrue();
    assertThat(service.end(issueId, humanId, "FAILED", null)).isFalse();
    assertThat(
            dsl.select(AGENT_WORK.STATE)
                .from(AGENT_WORK)
                .where(AGENT_WORK.ISSUE_ID.eq(issueId))
                .fetchOne(AGENT_WORK.STATE))
        .isEqualTo("FAILED");
  }

  @Test
  void cancelAllForIssues_진행중_전부_CANCELED_종료() {
    service.startOrUpdate(issueId, humanId, "claude-code", AgentWorkPatch.empty());
    service.startOrUpdate(issueId, agentId, "claude-code", AgentWorkPatch.empty());
    service.cancelAllForIssues(List.of(issueId));
    assertThat(service.viewsByIssueIds(List.of(issueId))).doesNotContainKey(issueId);
  }

  /** AUTH_REQUIRED 도 터치로 WORKING 에 복귀하며 요청 note 를 지운다. */
  @Test
  void 터치_AUTH_REQUIRED_복귀시_note_지움() {
    assigneeRepository.add(issueId, humanId, humanId);
    service.startOrUpdate(
        issueId,
        humanId,
        "claude-code",
        new AgentWorkPatch(null, "AUTH_REQUIRED", "토큰 필요", false, null, null, null));
    service.onAgentToolWrite(
        new AgentToolWriteEvent(issueId, humanId, "claude-code", true, false, false));
    var row = repo.findActive(issueId, humanId).orElseThrow();
    assertThat(row.state()).isEqualTo("WORKING");
    assertThat(row.note()).isNull();
  }

  /** 시작 전(SUBMITTED) 작업은 MCP 쓰기 터치로 같은 행이 WORKING 으로 착수된다(새 행 아님). */
  @Test
  void 터치_SUBMITTED_는_같은_행을_WORKING_으로() {
    assigneeRepository.add(issueId, agentId, humanId);
    var submitted = insert(issueId, agentId, null, "SUBMITTED").orElseThrow();
    service.onAgentToolWrite(
        new AgentToolWriteEvent(issueId, agentId, "claude-code", true, false, false));
    var row = repo.findActive(issueId, agentId).orElseThrow();
    assertThat(row.id()).isEqualTo(submitted.id());
    assertThat(row.state()).isEqualTo("WORKING");
  }

  /** 인증 필요 → 답변 필요처럼 중단 상태끼리 바뀔 때도 앞 상태의 note 는 낡으므로 새 note 가 없으면 지운다. */
  @Test
  void 보고_AUTH_REQUIRED에서_INPUT_REQUIRED_로_note없이_바뀌면_note_지움() {
    service.startOrUpdate(
        issueId,
        agentId,
        "claude-code",
        new AgentWorkPatch(null, "AUTH_REQUIRED", "토큰 필요", false, null, null, null));
    var v =
        service.startOrUpdate(
            issueId,
            agentId,
            "claude-code",
            new AgentWorkPatch(null, "INPUT_REQUIRED", null, false, null, null, null));
    assertThat(v.state()).isEqualTo("INPUT_REQUIRED");
    assertThat(v.note()).isNull();
  }

  /** 사람이 응답해도 AUTH_REQUIRED 는 건드리지 않는다. */
  @Test
  void onHumanReply_는_AUTH_REQUIRED_를_건드리지_않음() {
    service.startOrUpdate(
        issueId,
        agentId,
        "claude-code",
        new AgentWorkPatch(null, "AUTH_REQUIRED", "토큰 필요", false, null, null, null));
    service.onHumanReply(new IssueHumanReplyPosted(issueId));
    var row = repo.findActive(issueId, agentId).orElseThrow();
    assertThat(row.state()).isEqualTo("AUTH_REQUIRED");
    assertThat(row.note()).isEqualTo("토큰 필요");
  }

  /** tool 이 null 인 SUBMITTED 작업도 이슈 응답용 뷰로 문제없이 만들어진다(tool 은 null). */
  @Test
  void viewsByIssueIds_tool_이_null_이어도_뷰를_만듦() {
    insert(issueId, agentId, null, "SUBMITTED");
    var list = service.viewsByIssueIds(List.of(issueId)).get(issueId);
    assertThat(list)
        .singleElement()
        .satisfies(
            v -> {
              assertThat(v.state()).isEqualTo("SUBMITTED");
              assertThat(v.tool()).isNull();
              assertThat(v.stale()).isFalse();
            });
  }

  /** 이슈 완료 처리 — 일하던 작업은 COMPLETED, 착수 전 SUBMITTED 는 CANCELED. */
  @Test
  void endAllOnIssueDone_은_SUBMITTED_만_CANCELED() {
    insert(issueId, agentId, null, "SUBMITTED");
    insert(issueId, humanId, "claude-code", "REVIEW");
    service.endAllOnIssueDone(List.of(issueId));
    var states =
        dsl.select(AGENT_WORK.WORKER_ID, AGENT_WORK.STATE)
            .from(AGENT_WORK)
            .where(AGENT_WORK.ISSUE_ID.eq(issueId))
            .fetchMap(AGENT_WORK.WORKER_ID, AGENT_WORK.STATE);
    assertThat(states.get(agentId)).isEqualTo("CANCELED");
    assertThat(states.get(humanId)).isEqualTo("COMPLETED");
  }

  /**
   * 터치가 SUBMITTED 생성과의 삽입 경합에서 졌을 때(처음 조회는 비었는데 그 사이 다른 트랜잭션이 행을 만든 상황 — 첫 findActive 만 비게 스텁해 재현)
   * 충돌로 돌려받은 행에 같은 터치 규칙을 적용한다: 같은 행이 WORKING 으로 착수되고 tool 이 채워지며 새 행은 없다.
   */
  @Test
  void 터치가_삽입_경합에서_져도_기존_행을_착수시키고_tool을_채움() {
    assigneeRepository.add(issueId, agentId, humanId);
    var submitted = insert(issueId, agentId, null, "SUBMITTED").orElseThrow();
    doReturn(Optional.empty()).doCallRealMethod().when(repo).findActive(issueId, agentId);
    service.onAgentToolWrite(
        new AgentToolWriteEvent(issueId, agentId, "claude-code", true, false, false));
    var row = repo.findActive(issueId, agentId).orElseThrow();
    assertThat(row.id()).isEqualTo(submitted.id());
    assertThat(row.state()).isEqualTo("WORKING");
    assertThat(row.tool()).isEqualTo("claude-code");
    assertThat(dsl.fetchCount(AGENT_WORK, AGENT_WORK.ISSUE_ID.eq(issueId))).isEqualTo(1);
    assertThat(
            dsl.select(AGENT_WORK_EVENT.STATE)
                .from(AGENT_WORK_EVENT)
                .where(AGENT_WORK_EVENT.WORK_ID.eq(row.id()))
                .orderBy(AGENT_WORK_EVENT.ID.asc())
                .fetch(AGENT_WORK_EVENT.STATE))
        .containsExactly("SUBMITTED", "WORKING");
  }

  /** 외부→내부 전환 신호는 그 구성원의 SUBMITTED 만 CANCELED 로 닫고(이벤트 포함), 일하던 작업·다른 구성원 작업은 건드리지 않는다. */
  @Test
  void 내부로_전환되면_SUBMITTED_만_CANCELED() {
    long otherAgent = TestFixtures.createAgentNoToken(dsl);
    long submittedId = insert(issueId, agentId, null, "SUBMITTED").orElseThrow().id();
    insert(issueId, otherAgent, null, "SUBMITTED");
    service.onAgentRuntimeChanged(new AgentRuntimeChanged(agentId, AgentRuntime.INTERNAL));
    // 취소된 작업의 이슈마다 화면 갱신 알림이 한 번 나간다(열린 레일·AI 작업 목록이 "시작 전" 을 계속 보이지 않게).
    assertThat(issueChangeCount()).isEqualTo(1);
    assertThat(
            dsl.select(AGENT_WORK.STATE)
                .from(AGENT_WORK)
                .where(AGENT_WORK.ID.eq(submittedId))
                .fetchOne(AGENT_WORK.STATE))
        .isEqualTo("CANCELED");
    assertThat(repo.findActive(issueId, otherAgent).orElseThrow().state()).isEqualTo("SUBMITTED");
    assertThat(eventCount(submittedId)).isEqualTo(2);

    // 일하던 작업은 그대로 — 외부로의 전환 신호도 아무것도 하지 않는다.
    insert(issueId, agentId, "claude-code", "WORKING");
    service.onAgentRuntimeChanged(new AgentRuntimeChanged(agentId, AgentRuntime.INTERNAL));
    service.onAgentRuntimeChanged(new AgentRuntimeChanged(otherAgent, AgentRuntime.EXTERNAL));
    assertThat(repo.findActive(issueId, agentId).orElseThrow().state()).isEqualTo("WORKING");
    assertThat(repo.findActive(issueId, otherAgent).orElseThrow().state()).isEqualTo("SUBMITTED");
    // 취소할 작업이 없던 전환 신호는 알림도 내지 않는다.
    assertThat(issueChangeCount()).isEqualTo(1);
  }

  /** 이 테스트 이슈에 대해 발행된 이슈 변경 알림 수. */
  private long issueChangeCount() {
    return events.stream(ResourceChangedEvent.class)
        .filter(e -> "issue".equals(e.resource()) && e.ids().contains(issueId))
        .count();
  }

  /** 이벤트의 tenant_id 는 GUC 기본값이 아니라 작업 행의 tenant_id 를 그대로 옮긴 값이다. */
  @Test
  void 이벤트는_작업_행의_tenant_id_를_가진다() {
    service.startOrUpdate(issueId, agentId, "claude-code", AgentWorkPatch.empty());
    var work = repo.findActive(issueId, agentId).orElseThrow();
    long workTenant =
        dsl.select(AGENT_WORK.TENANT_ID)
            .from(AGENT_WORK)
            .where(AGENT_WORK.ID.eq(work.id()))
            .fetchOne(AGENT_WORK.TENANT_ID);
    assertThat(
            dsl.select(AGENT_WORK_EVENT.TENANT_ID)
                .from(AGENT_WORK_EVENT)
                .where(AGENT_WORK_EVENT.WORK_ID.eq(work.id()))
                .fetch(AGENT_WORK_EVENT.TENANT_ID))
        .containsOnly(workTenant);
  }

  /** 보고 한 번 = 이벤트 한 번: 첫 보고 1건, 같은 보고 반복 0건, note 변경 1건. */
  @Test
  void startOrUpdate_보고당_이벤트는_한번() {
    var first =
        service.startOrUpdate(
            issueId,
            agentId,
            "claude-code",
            new AgentWorkPatch(null, "REVIEW", "PR 올림", false, 100, null, null));
    long workId = repo.findActive(issueId, agentId).orElseThrow().id();
    assertThat(first.state()).isEqualTo("REVIEW");
    assertThat(eventCount(workId)).isEqualTo(1);

    // 같은 내용 재보고 — 이력 변화 없음.
    service.startOrUpdate(
        issueId,
        agentId,
        "claude-code",
        new AgentWorkPatch(null, "REVIEW", "PR 올림", false, 100, null, null));
    assertThat(eventCount(workId)).isEqualTo(1);

    // 상태만 같은 값으로 재보고해도 변화 없음.
    service.startOrUpdate(
        issueId,
        agentId,
        "claude-code",
        new AgentWorkPatch(null, "REVIEW", null, false, null, null, null));
    assertThat(eventCount(workId)).isEqualTo(1);

    // note 변경 — 1건 추가.
    service.startOrUpdate(
        issueId,
        agentId,
        "claude-code",
        new AgentWorkPatch(null, null, "리뷰 반영", false, null, null, null));
    assertThat(eventCount(workId)).isEqualTo(2);
  }

  private int eventCount(long workId) {
    return dsl.fetchCount(AGENT_WORK_EVENT, AGENT_WORK_EVENT.WORK_ID.eq(workId));
  }
}
