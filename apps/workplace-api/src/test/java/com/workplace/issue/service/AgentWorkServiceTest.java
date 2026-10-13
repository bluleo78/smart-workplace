package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.dto.AgentWorkView;
import com.workplace.issue.exception.AgentWorkIssueClosedException;
import com.workplace.issue.outbound.AgentToolWriteEvent;
import com.workplace.issue.outbound.IssueHumanReplyPosted;
import com.workplace.issue.repository.AgentWorkRepository;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** AgentWorkService 통합 테스트(WP-377) — 보고 생성/갱신·급한 순 정렬과 무소식·사람 응답 복귀·일괄 종료. */
@Transactional
class AgentWorkServiceTest extends IntegrationTestBase {

  @Autowired AgentWorkService service;
  @Autowired AgentWorkRepository repo;
  @Autowired DSLContext dsl;
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
    issueId = issueRepository.insert(project.id(), 1, "i1", null, "MID", null, humanId).id();
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
    service.onAgentToolWrite(new AgentToolWriteEvent(issueId, humanId, "claude-code", true));
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
    service.onAgentToolWrite(new AgentToolWriteEvent(issueId, humanId, "claude-code", true));
    var row = repo.findActive(issueId, humanId).orElseThrow();
    assertThat(row.state()).isEqualTo("WORKING");
    assertThat(row.note()).isEqualTo("권한 없음");
  }

  @Test
  void startOrUpdate_종료된_이슈면_NPE_대신_AgentWorkIssueClosedException() {
    // 보고 검증을 우회해 서비스를 직접 호출 — 동시 종료로 조회에서 이슈가 빠지는 경합과 같은 상황.
    dsl.update(ISSUE).set(ISSUE.STATUS, "DONE").where(ISSUE.ID.eq(issueId)).execute();
    assertThatThrownBy(
            () -> service.startOrUpdate(issueId, humanId, "claude-code", AgentWorkPatch.empty()))
        .isInstanceOf(AgentWorkIssueClosedException.class);
  }

  @Test
  void end_는_진행중이면_true_없으면_false() {
    service.startOrUpdate(issueId, humanId, "claude-code", AgentWorkPatch.empty());
    assertThat(service.end(issueId, humanId, "FAILED")).isTrue();
    assertThat(service.end(issueId, humanId, "FAILED")).isFalse();
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
    service.onAgentToolWrite(new AgentToolWriteEvent(issueId, humanId, "claude-code", true));
    var row = repo.findActive(issueId, humanId).orElseThrow();
    assertThat(row.state()).isEqualTo("WORKING");
    assertThat(row.note()).isNull();
  }

  /** 시작 전(SUBMITTED) 작업은 MCP 쓰기 터치로 같은 행이 WORKING 으로 착수된다(새 행 아님). */
  @Test
  void 터치_SUBMITTED_는_같은_행을_WORKING_으로() {
    assigneeRepository.add(issueId, agentId, humanId);
    var submitted = repo.insertIfAbsent(issueId, agentId, null, "SUBMITTED").orElseThrow();
    service.onAgentToolWrite(new AgentToolWriteEvent(issueId, agentId, "claude-code", true));
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
    repo.insertIfAbsent(issueId, agentId, null, "SUBMITTED");
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
    repo.insertIfAbsent(issueId, agentId, null, "SUBMITTED");
    repo.insertIfAbsent(issueId, humanId, "claude-code", "REVIEW");
    service.endAllOnIssueDone(List.of(issueId));
    var states =
        dsl.select(AGENT_WORK.WORKER_ID, AGENT_WORK.STATE)
            .from(AGENT_WORK)
            .where(AGENT_WORK.ISSUE_ID.eq(issueId))
            .fetchMap(AGENT_WORK.WORKER_ID, AGENT_WORK.STATE);
    assertThat(states.get(agentId)).isEqualTo("CANCELED");
    assertThat(states.get(humanId)).isEqualTo("COMPLETED");
  }
}
