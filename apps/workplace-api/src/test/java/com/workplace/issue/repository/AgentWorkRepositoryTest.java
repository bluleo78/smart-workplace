package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.AGENT_WORK_EVENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.repository.AgentWorkRepository.AgentWorkRow;
import com.workplace.issue.repository.AgentWorkRepository.InsertOutcome;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * AgentWorkRepository 통합 테스트(WP-377) — 진행 중 1건 유니크·부분 갱신·일괄 조회·답변 필요 복귀·DB 제약, 그리고 쓰기 경로마다 남는 상태 변경
 * 이력(agent_work_event).
 */
@Transactional
class AgentWorkRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AgentWorkRepository repo;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectService projectService;

  long humanId;
  long agentId;
  long projectId;
  long issueId;
  long otherIssueId;

  /** 사람·AI 사용자와 같은 프로젝트의 이슈 2건을 만든다. */
  @BeforeEach
  void setUp() {
    humanId = TestFixtures.createHuman(dsl);
    agentId = TestFixtures.createAgentNoToken(dsl);
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6);
    var project =
        projectService.create(humanId, new CreateProjectRequest("W" + suffix, "PW-" + suffix, "x"));
    projectId = project.id();
    issueId = issueRepository.insert(project.id(), 1, "i1", null, "MID", null, humanId).id();
    otherIssueId = issueRepository.insert(project.id(), 2, "i2", null, "MID", null, humanId).id();
  }

  /** 진행 중 작업을 만들고 행만 돌려준다(충돌이면 기존 행). 대부분의 테스트는 삽입 여부를 보지 않는다. */
  private Optional<AgentWorkRow> insert(long issue, long worker, String tool, String state) {
    return repo.insertOutcome(issue, worker, tool, state).map(InsertOutcome::row);
  }

  private Optional<AgentWorkRow> insert(
      long issue,
      long worker,
      String tool,
      String state,
      String note,
      Integer progress,
      Integer stepsDone,
      Integer stepsTotal) {
    return repo.insertOutcome(
            issue, worker, tool, state, note, progress, stepsDone, stepsTotal, null)
        .map(InsertOutcome::row);
  }

  @Test
  void insertOutcome_같은_이슈_작업자는_진행중_한건만() {
    var a = insert(issueId, humanId, "claude-code", AgentWorkState.WORKING).orElseThrow();
    var b = insert(issueId, humanId, "cursor", AgentWorkState.INPUT_REQUIRED).orElseThrow();
    assertThat(b.id()).isEqualTo(a.id());
    assertThat(b.tool()).isEqualTo("claude-code"); // 경합 시 기존 행 그대로
  }

  @Test
  void endActive_후_다시_만들면_새_행() {
    var a = insert(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    assertThat(repo.endActive(List.of(issueId), AgentWorkState.CANCELED)).isEqualTo(1);
    assertThat(repo.findActive(issueId, humanId)).isEmpty();
    var b = insert(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    assertThat(b.id()).isNotEqualTo(a.id());
  }

  @Test
  void update_null_은_유지_clearNote_는_지움() {
    var a = insert(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    repo.update(a.id(), new AgentWorkPatch(null, null, "헤더 처리 중", false, 40, null, null));
    repo.update(a.id(), new AgentWorkPatch(null, "REVIEW", null, false, null, 3, 5));
    var r = repo.findActive(issueId, humanId).orElseThrow();
    assertThat(r.note()).isEqualTo("헤더 처리 중");
    assertThat(r.progress()).isEqualTo(40);
    assertThat(r.stepsDone()).isEqualTo(3);
    assertThat(r.state()).isEqualTo("REVIEW");
    repo.update(a.id(), new AgentWorkPatch(null, null, null, true, null, null, null));
    assertThat(repo.findActive(issueId, humanId).orElseThrow().note()).isNull();
  }

  @Test
  void findActiveByIssueIds_한번에_작업자_포함() {
    insert(issueId, humanId, "claude-code", "WORKING");
    insert(issueId, agentId, "claude-code", "INPUT_REQUIRED");
    insert(otherIssueId, humanId, "cursor", "PAUSED");
    var m = repo.findActiveByIssueIds(List.of(issueId, otherIssueId));
    assertThat(m.get(issueId)).hasSize(2);
    assertThat(m.get(issueId))
        .extracting(w -> w.worker().kind())
        .containsExactlyInAnyOrder("HUMAN", "AGENT");
    assertThat(m.get(otherIssueId))
        .singleElement()
        .extracting(w -> w.work().tool())
        .isEqualTo("cursor");
  }

  @Test
  void resumeInputRequiredAgents_는_AI_구성원의_답변필요만_되돌림() {
    insert(issueId, humanId, "claude-code", "INPUT_REQUIRED");
    insert(issueId, agentId, "claude-code", "INPUT_REQUIRED");
    assertThat(repo.resumeInputRequiredAgents(issueId)).isEqualTo(1);
    assertThat(repo.findActive(issueId, agentId).orElseThrow().state()).isEqualTo("WORKING");
    assertThat(repo.findActive(issueId, humanId).orElseThrow().state()).isEqualTo("INPUT_REQUIRED");
  }

  @Test
  void 단계_제약_위반은_DB_가_거절() {
    var a = insert(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    assertThatThrownBy(
            () -> repo.update(a.id(), new AgentWorkPatch(null, null, null, false, null, 6, 5)))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
  }

  // ---------------------------------------------------------------- A2A 상태·DB 제약

  /** SUBMITTED 는 도구를 모른 채(tool NULL) 만들 수 있고, 진행 상태라 ended_at 이 없다. */
  @Test
  void SUBMITTED_는_tool_없이_생성() {
    var r = insert(issueId, agentId, null, AgentWorkState.SUBMITTED).orElseThrow();
    assertThat(r.tool()).isNull();
    assertThat(r.state()).isEqualTo("SUBMITTED");
  }

  /** 정합 CHECK — 진행 상태에 ended_at 이 있거나 종료 상태에 ended_at 이 없는 행은 DB 가 거절한다. */
  @Test
  void 상태와_ended_at_불일치는_DB_가_거절() {
    var a = insert(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    assertThatThrownBy(
            () ->
                dsl.update(AGENT_WORK)
                    .set(AGENT_WORK.ENDED_AT, java.time.OffsetDateTime.now())
                    .where(AGENT_WORK.ID.eq(a.id()))
                    .execute())
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
  }

  @Test
  void 알_수_없는_상태는_DB_가_거절() {
    assertThatThrownBy(() -> insert(issueId, humanId, "claude-code", "WAITING"))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
  }

  @Test
  void 종료_상태가_아니면_종료_메서드가_거절() {
    insert(issueId, humanId, "claude-code", "WORKING");
    assertThatThrownBy(() -> repo.endActive(List.of(issueId), "WORKING"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  // ---------------------------------------------------------------- 상태 변경 이력(agent_work_event)

  /** 작업 행의 이벤트 상태를 시간순으로. */
  private List<String> eventStates(long workId) {
    return dsl.select(AGENT_WORK_EVENT.STATE)
        .from(AGENT_WORK_EVENT)
        .where(AGENT_WORK_EVENT.WORK_ID.eq(workId))
        .orderBy(AGENT_WORK_EVENT.ID.asc())
        .fetch(AGENT_WORK_EVENT.STATE);
  }

  @Test
  void 이벤트_insertOutcome_는_생성_이벤트_충돌이면_없음() {
    var a = insert(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    assertThat(eventStates(a.id())).containsExactly("WORKING");
    // 충돌로 아무것도 안 들어가면(기존 진행 중 행 반환) 이벤트도 추가되지 않는다.
    var b = insert(issueId, humanId, "cursor", "INPUT_REQUIRED").orElseThrow();
    assertThat(b.id()).isEqualTo(a.id());
    assertThat(eventStates(a.id())).containsExactly("WORKING");
  }

  @Test
  void 이벤트_update_는_변경_후_스냅샷을_남김() {
    var a = insert(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    repo.update(a.id(), new AgentWorkPatch(null, "REVIEW", "PR 올림", false, 80, 3, 5));
    var e =
        dsl.selectFrom(AGENT_WORK_EVENT)
            .where(AGENT_WORK_EVENT.WORK_ID.eq(a.id()))
            .orderBy(AGENT_WORK_EVENT.ID.desc())
            .limit(1)
            .fetchOne();
    assertThat(e.getState()).isEqualTo("REVIEW");
    assertThat(e.getNote()).isEqualTo("PR 올림");
    assertThat(e.getProgress()).isEqualTo((short) 80);
    assertThat(e.getStepsDone()).isEqualTo((short) 3);
    assertThat(e.getStepsTotal()).isEqualTo((short) 5);
    // note 지우기도 변경이라 스냅샷(note NULL)이 남는다.
    repo.update(a.id(), new AgentWorkPatch(null, null, null, true, null, null, null));
    assertThat(eventStates(a.id())).containsExactly("WORKING", "REVIEW", "REVIEW");
  }

  /** 도구 값 갱신·터치만 하는 update 는 이력을 부풀리지 않는다. */
  @Test
  void 이벤트_터치만_하는_update_는_이벤트_없음() {
    var a = insert(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    repo.update(a.id(), AgentWorkPatch.empty());
    repo.update(a.id(), AgentWorkPatch.empty().withTool("cursor"));
    assertThat(eventStates(a.id())).containsExactly("WORKING");
  }

  @Test
  void 이벤트_endActive_는_종료_상태로_남김() {
    var a = insert(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    var b = insert(issueId, agentId, "claude-code", "INPUT_REQUIRED").orElseThrow();
    assertThat(repo.endActive(List.of(issueId), AgentWorkState.COMPLETED)).isEqualTo(2);
    assertThat(eventStates(a.id())).containsExactly("WORKING", "COMPLETED");
    assertThat(eventStates(b.id())).containsExactly("INPUT_REQUIRED", "COMPLETED");
    // 이미 끝난 행은 다시 닫지 않으므로 이벤트도 늘지 않는다.
    assertThat(repo.endActive(List.of(issueId), AgentWorkState.CANCELED)).isZero();
    assertThat(eventStates(a.id())).containsExactly("WORKING", "COMPLETED");
  }

  @Test
  void 이벤트_endActiveOnIssueDone_은_한_문장으로_SUBMITTED_는_CANCELED_나머지는_COMPLETED() {
    var submitted = insert(issueId, agentId, null, "SUBMITTED").orElseThrow();
    var working = insert(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    assertThat(repo.endActiveOnIssueDone(List.of(issueId))).isEqualTo(2);
    // 행마다 실제로 들어간 종료 상태가 이벤트에 남는다.
    assertThat(eventStates(submitted.id())).containsExactly("SUBMITTED", "CANCELED");
    assertThat(eventStates(working.id())).containsExactly("WORKING", "COMPLETED");
    assertThat(repo.findActive(issueId, humanId)).isEmpty();
    assertThat(repo.findActive(issueId, agentId)).isEmpty();
  }

  @Test
  void insertOutcome_은_실제로_넣었는지_알려줌() {
    var first = repo.insertOutcome(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    var second = repo.insertOutcome(issueId, humanId, "cursor", "REVIEW").orElseThrow();
    assertThat(first.inserted()).isTrue();
    assertThat(second.inserted()).isFalse();
    assertThat(second.row().id()).isEqualTo(first.row().id());
    // 삽입 결과 행은 재조회 없이 INSERT 의 RETURNING 스냅샷으로 만든다 — 저장된 행과 같아야 한다.
    assertThat(first.row()).isEqualTo(repo.findActive(issueId, humanId).orElseThrow());
  }

  /** 여러 작업자의 시작 전 작업을 한 문장으로 만들고 되풀이해도 행·이벤트가 늘지 않는다. */
  @Test
  void insertSubmitted_는_한_문장으로_여럿을_만들고_멱등() {
    repo.insertSubmitted(issueId, List.of(humanId, agentId));
    repo.insertSubmitted(issueId, List.of(humanId, agentId));
    var rows = repo.findActiveByIssueIds(List.of(issueId)).get(issueId);
    assertThat(rows).hasSize(2);
    assertThat(rows).allSatisfy(r -> assertThat(r.work().state()).isEqualTo("SUBMITTED"));
    assertThat(eventStates(rows.get(0).work().id())).containsExactly("SUBMITTED");
    assertThat(eventStates(rows.get(1).work().id())).containsExactly("SUBMITTED");
  }

  @Test
  void 이벤트_endActiveForWorkers_는_지정_작업자만() {
    var a = insert(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    var b = insert(issueId, agentId, "claude-code", "WORKING").orElseThrow();
    assertThat(repo.endActiveForWorkers(issueId, List.of(humanId), "REJECTED")).isEqualTo(1);
    assertThat(eventStates(a.id())).containsExactly("WORKING", "REJECTED");
    assertThat(eventStates(b.id())).containsExactly("WORKING");
  }

  @Test
  void 이벤트_endActiveForWorkerInProject_는_프로젝트_이슈의_작업() {
    var a = insert(issueId, agentId, "claude-code", "WORKING").orElseThrow();
    var b = insert(otherIssueId, agentId, "claude-code", "REVIEW").orElseThrow();
    var keep = insert(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    assertThat(repo.endActiveForWorkerInProject(projectId, agentId, "CANCELED")).isEqualTo(2);
    assertThat(eventStates(a.id())).containsExactly("WORKING", "CANCELED");
    assertThat(eventStates(b.id())).containsExactly("REVIEW", "CANCELED");
    assertThat(eventStates(keep.id())).containsExactly("WORKING");
  }

  @Test
  void 이벤트_resumeInputRequiredAgents_는_WORKING_이벤트를_남김() {
    var a = insert(issueId, agentId, "claude-code", "INPUT_REQUIRED").orElseThrow();
    var auth = insert(otherIssueId, agentId, "claude-code", "AUTH_REQUIRED");
    assertThat(repo.resumeInputRequiredAgents(issueId)).isEqualTo(1);
    assertThat(eventStates(a.id())).containsExactly("INPUT_REQUIRED", "WORKING");
    // AUTH_REQUIRED 는 사람 답으로 재개하지 않는다.
    assertThat(repo.resumeInputRequiredAgents(otherIssueId)).isZero();
    assertThat(eventStates(auth.orElseThrow().id())).containsExactly("AUTH_REQUIRED");
  }

  /** 종료된 행에는 update 가 아무것도 쓰지 않는다(0행) — 진행 상태 값이 종료 행에 써져 정합 CHECK 가 깨지거나 이력이 늘지 않는다. */
  @Test
  void update_는_종료된_행에_0행_이벤트_없음() {
    var a = insert(issueId, humanId, "claude-code", "WORKING").orElseThrow();
    repo.endActive(List.of(issueId), AgentWorkState.COMPLETED);
    assertThat(eventStates(a.id())).containsExactly("WORKING", "COMPLETED");

    int changed =
        repo.update(a.id(), new AgentWorkPatch(null, "WORKING", "되살림", false, 10, null, null));

    assertThat(changed).isZero();
    var row = dsl.selectFrom(AGENT_WORK).where(AGENT_WORK.ID.eq(a.id())).fetchOne();
    assertThat(row.getState()).isEqualTo("COMPLETED");
    assertThat(row.getNote()).isNull();
    assertThat(eventStates(a.id())).containsExactly("WORKING", "COMPLETED");
  }

  /** 첫 보고 값을 insert 에 함께 담으면 이벤트는 그 값 하나다. */
  @Test
  void insertOutcome_보고_값을_담아_이벤트_하나() {
    var a = insert(issueId, humanId, "claude-code", "REVIEW", "PR 올림", 90, 4, 5).orElseThrow();
    var events =
        dsl.selectFrom(AGENT_WORK_EVENT).where(AGENT_WORK_EVENT.WORK_ID.eq(a.id())).fetch();
    assertThat(events)
        .singleElement()
        .satisfies(
            e -> {
              assertThat(e.getState()).isEqualTo("REVIEW");
              assertThat(e.getNote()).isEqualTo("PR 올림");
              assertThat(e.getProgress()).isEqualTo((short) 90);
              assertThat(e.getStepsDone()).isEqualTo((short) 4);
              assertThat(e.getStepsTotal()).isEqualTo((short) 5);
            });
  }

  /** 갱신 전과 값이 같은 update 는 행은 갱신해도(1행) 이벤트를 남기지 않고, 값이 달라지면 하나만 남긴다. */
  @Test
  void update_는_값이_달라졌을_때만_이벤트() {
    var a = insert(issueId, humanId, "claude-code", "WORKING", "시작", 10, null, null).orElseThrow();
    assertThat(eventStates(a.id())).hasSize(1);

    // 같은 상태·note·진행률 재보고 — 행은 갱신(1)되지만 이벤트는 그대로.
    assertThat(
            repo.update(a.id(), new AgentWorkPatch(null, "WORKING", "시작", false, 10, null, null)))
        .isEqualTo(1);
    assertThat(eventStates(a.id())).hasSize(1);

    // note 만 바뀜 — 이벤트 1건 추가.
    repo.update(a.id(), new AgentWorkPatch(null, null, "진행 중", false, null, null, null));
    assertThat(eventStates(a.id())).hasSize(2);
  }
}
