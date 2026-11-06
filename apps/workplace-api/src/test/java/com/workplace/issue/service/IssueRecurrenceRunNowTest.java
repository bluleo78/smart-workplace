package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.CHAT_THREAD;
import static com.workplace.jooq.Tables.ISSUE_RECURRENCE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.datasource.ConnectionHolder;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 「지금 실행」(테스트 실행, WP-1313) 통합 테스트 — 일정과 관계없이 한 번 실행하고 다음 회차·연속 실패 수·회차 수·AI 작업 기록은 그대로, 결과 글의 테스트
 * 표시, 실행 중 중복·정기 회차와 겹침(409·미루기), 권한(남의 개인 비서·구성원 아님), 되돌릴 수 없는 쓰기를 멈춘 질문에 답하면 그 쓰기만 허락한 테스트 이어 처리,
 * 결과 대기 시간 초과·실행 중 삭제.
 *
 * <p>시드는 {@link IssueRecurrenceTest} 와 같다 — 개인 프로젝트(owner 소유) + 이슈 1건, owner 의 개인 비서(agent, 토큰 보유)가
 * 멤버·담당자. 테스트마다 매일 08:00 일정을 저장해 둔다.
 */
@Transactional
@RecordApplicationEvents
class IssueRecurrenceRunNowTest extends IntegrationTestBase {

  private static final String INTERNAL_TOKEN = "test-token";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMemberRepository;
  @Autowired IssueService issueService;
  @Autowired IssueAssigneeRepository assigneeRepository;
  @Autowired PersonalAssistantRepository personalAssistantRepository;
  @Autowired AiAgentCredentialService credentialService;
  @Autowired IssueRecurrenceService recurrenceService;
  @Autowired com.workplace.issue.repository.IssueRecurrenceRepository recurrenceRepository;
  @Autowired com.workplace.chat.repository.ChatThreadRepository chatThreadRepository;
  @Autowired ApplicationEvents events;

  private long owner;
  private long agent;
  private String key;
  private long issueId;
  private int number;
  private long projectId;

  @BeforeEach
  void seed() throws Exception {
    TenantContext.set(1L);
    owner = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, owner, "USER");
    agent = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, owner));
    personalAssistantRepository.setAgentId(owner, agent);
    var project =
        projectService.create(owner, new CreateProjectRequest(null, "개인", null, "PERSONAL"));
    key = project.key();
    projectId = project.id();
    projectMemberRepository.insert(project.id(), agent, "MEMBER");
    var issue =
        issueService.create(
            owner,
            key,
            new CreateIssueRequest(
                "주간 보고 메일", "매주 보고 메일을 팀장님께 바로 보내 줘", null, null, null, null, null, null));
    issueId = issue.id();
    number = issue.number();
    assigneeRepository.add(issueId, agent, owner);
    call(put(path()).content(req("FREQ=DAILY", "08:00")), owner).andExpect(status().isOk());
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  void 지금_실행은_테스트_이벤트를_보내고_다음회차_실패수_회차수_작업기록은_그대로다() throws Exception {
    // 꺼지기 직전(연속 실패 2회)인 일정 — 테스트 실행이 실패 수를 바꾸지 않는지 본다.
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES, 2)
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
    Record before = row();

    runNow(owner).andExpect(status().isAccepted());

    var sent = events.stream(IssueRecurringRunEvent.class).toList();
    assertThat(sent).hasSize(1);
    var e = sent.get(0);
    assertThat(e.test()).isTrue();
    assertThat(e.runId()).startsWith(issueId + "-t");
    assertThat(e.round()).isNull();
    assertThat(e.followUp()).isNull();
    assertThat(e.actingAgentId()).isEqualTo(agent);
    // 개인 비서라 정기 회차와 같이 주인 대행, 누른 사람이 actor.
    assertThat(e.ownerUserId()).isEqualTo(owner);
    assertThat(e.actor().id()).isEqualTo(owner);

    Record after = row();
    assertThat(after.get(ISSUE_RECURRENCE.TEST_RUN_ID)).isEqualTo(e.runId());
    assertThat(after.get(ISSUE_RECURRENCE.TEST_RUN_REQUESTED_BY)).isEqualTo(owner);
    assertSameSchedule(before, after);
    assertThat(after.get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isNull();
    // AI 작업 기록은 「다음 회차 대기」 그대로(작업 중으로 바뀌지 않는다).
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
    // 조회는 테스트 실행 중을 알린다.
    call(get(path()), owner)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.testRunning").value(true));

    // 실패 보고 — 테스트 표시와 사유를 남기고, 연속 실패로 세지 않는다(2회 → 3회로 멈추지 않는다).
    report(e.runId(), false, "메일 계정 연결이 끊겼습니다", false, null).andExpect(status().isNoContent());
    assertThat(agentMessages())
        .containsExactly(
            IssueRecurrenceService.TEST_LABEL
                + IssueRecurrenceService.TEST_FAILED_PREFIX
                + "메일 계정 연결이 끊겼습니다");
    Record done = row();
    assertSameSchedule(before, done);
    assertThat(done.get(ISSUE_RECURRENCE.ENABLED)).isTrue();
    assertThat(done.get(ISSUE_RECURRENCE.TEST_RUN_ID)).isNull();
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
    call(get(path()), owner).andExpect(jsonPath("$.testRunning").value(false));

    // 다시 누르면 다시 실행되고, 성공 결과도 테스트 표시로 남는다. 같은 결과를 또 보내도 한 번만 반영한다.
    runNow(owner).andExpect(status().isAccepted());
    String second = row().get(ISSUE_RECURRENCE.TEST_RUN_ID);
    report(second, true, "보고 메일 초안을 만들었습니다", false, null).andExpect(status().isNoContent());
    report(second, true, "보고 메일 초안을 만들었습니다", false, null).andExpect(status().isNoContent());
    assertThat(agentMessages()).hasSize(2);
    assertThat(agentMessages().get(1))
        .isEqualTo(IssueRecurrenceService.TEST_LABEL + "보고 메일 초안을 만들었습니다");
    assertSameSchedule(before, row());
  }

  @Test
  void 실행_중이면_다시_누를_수_없다() throws Exception {
    runNow(owner).andExpect(status().isAccepted());
    runNow(owner)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(IssueRecurrenceService.RUN_IN_FLIGHT));
    assertThat(events.stream(IssueRecurringRunEvent.class)).hasSize(1);
  }

  @Test
  void 정기_회차_결과를_기다리는_중에도_누를_수_없다() throws Exception {
    setNextRunAt(Instant.now().minusSeconds(60));
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    runNow(owner)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(IssueRecurrenceService.RUN_IN_FLIGHT));
    assertThat(row().get(ISSUE_RECURRENCE.TEST_RUN_ID)).isNull();
  }

  @Test
  void 테스트_실행_중에_회차_시각이_되면_정기_회차를_미루고_결과가_오면_보낸다() throws Exception {
    runNow(owner).andExpect(status().isAccepted());
    String testRun = row().get(ISSUE_RECURRENCE.TEST_RUN_ID);
    Instant due = Instant.now().minusSeconds(60).truncatedTo(ChronoUnit.SECONDS);
    setNextRunAt(due);

    assertThat(recurrenceService.runDue(Instant.now())).isZero();
    // 회차 시각·회차 수는 그대로 — 미뤘을 뿐이다.
    assertThat(row().get(ISSUE_RECURRENCE.NEXT_RUN_AT).toInstant()).isEqualTo(due);
    assertThat(row().get(ISSUE_RECURRENCE.RUN_COUNT)).isZero();

    report(testRun, true, "확인했습니다", false, null).andExpect(status().isNoContent());
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    assertThat(row().get(ISSUE_RECURRENCE.RUN_COUNT)).isEqualTo(1);
  }

  @Test
  void 남의_개인비서_일정이나_구성원이_아니면_누를_수_없다() throws Exception {
    // 개인 작업에 들어온 다른 사람 — 이 일정의 AI 는 owner 의 개인 비서라 주인만 누른다.
    long other = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, other, "USER");
    // 구성원이 아니면 개인 작업이 보이지 않는다(404 — 있는지조차 알리지 않는다).
    runNow(other).andExpect(status().isNotFound());
    projectMemberRepository.insert(projectId, other, "MEMBER");
    runNow(other)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value(IssueRecurrenceService.OTHERS_ASSISTANT));
    assertThat(row().get(ISSUE_RECURRENCE.TEST_RUN_ID)).isNull();
    assertThat(events.stream(IssueRecurringRunEvent.class)).isEmpty();
  }

  @Test
  void 일정이_없거나_작업이_끝났으면_409() throws Exception {
    call(delete(path()), owner).andExpect(status().isNoContent());
    runNow(owner)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(IssueRecurrenceService.NO_RECURRENCE));

    call(put(path()).content(req("FREQ=DAILY", "08:00")), owner).andExpect(status().isOk());
    issueService.updateStatus(owner, key, number, "DONE");
    // 작업을 끝내면 그 자리에서 일정이 거둬진다(WP-1114) — 지금 실행도 없다.
    runNow(owner).andExpect(status().isConflict());
    assertThat(events.stream(IssueRecurringRunEvent.class)).isEmpty();
  }

  @Test
  void 꺼진_일정도_지금_실행해_볼_수_있다() throws Exception {
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.ENABLED, false)
        .set(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES, 3)
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
    runNow(owner).andExpect(status().isAccepted());
    report(row().get(ISSUE_RECURRENCE.TEST_RUN_ID), true, "이제 됩니다", false, null)
        .andExpect(status().isNoContent());
    // 여전히 꺼져 있고 실패 수도 그대로 — 다시 켜는 것은 사람이 저장으로 한다.
    assertThat(row().get(ISSUE_RECURRENCE.ENABLED)).isFalse();
    assertThat(row().get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isEqualTo(3);
  }

  // ───────────────────────────── 되돌릴 수 없는 쓰기 확인 ─────────────────────────────

  @Test
  void 메일을_멈춘_질문에_답하면_그_쓰기만_허락한_테스트_이어_처리를_보낸다() throws Exception {
    Record before = row();
    runNow(owner).andExpect(status().isAccepted());
    String testRun = row().get(ISSUE_RECURRENCE.TEST_RUN_ID);

    // ai-agent: 메일 보내기를 멈추고 질문으로 보고한다(멈춘 쓰기 목록과 함께).
    var paused =
        List.of(Map.of("tool", "send_mail", "args", Map.of("subject", "주간 보고", "to", "boss")));
    report(testRun, true, "주간 보고 메일을 팀장님께 보낼까요?", true, paused).andExpect(status().isNoContent());

    assertThat(agentQuestionFlags()).containsExactly(true);
    Record asked = row();
    assertThat(asked.get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNotNull();
    assertThat(asked.get(ISSUE_RECURRENCE.PENDING_QUESTION_ANSWERER)).isEqualTo(owner);
    assertThat(asked.get(ISSUE_RECURRENCE.PENDING_QUESTION_ACTIONS)).contains("send_mail");
    assertThat(asked.get(ISSUE_RECURRENCE.TEST_RUN_ID)).isNull();

    long answerId = chat(owner, "보내 줘");

    var followUps =
        events.stream(IssueRecurringRunEvent.class).filter(e -> e.followUp() != null).toList();
    assertThat(followUps).hasSize(1);
    var f = followUps.get(0);
    assertThat(f.test()).isTrue();
    assertThat(f.runId()).isEqualTo(issueId + "-f" + answerId);
    assertThat(f.actor().id()).isEqualTo(owner);
    assertThat(f.followUp().answer()).isEqualTo("보내 줘");
    assertThat(f.followUp().question())
        .isEqualTo(IssueRecurrenceService.TEST_LABEL + "주간 보고 메일을 팀장님께 보낼까요?");
    assertThat(f.followUp().permittedActions()).hasSize(1);
    assertThat(f.followUp().permittedActions().get(0).tool()).isEqualTo("send_mail");
    assertThat(f.followUp().permittedActions().get(0).args()).containsEntry("subject", "주간 보고");
    Record following = row();
    assertThat(following.get(ISSUE_RECURRENCE.FOLLOW_UP_TEST_BY)).isEqualTo(owner);
    assertThat(following.get(ISSUE_RECURRENCE.PENDING_QUESTION_ACTIONS)).isNull();
    // 테스트 이어 처리는 AI 작업 기록을 바꾸지 않는다.
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");

    report(f.runId(), true, "보냈습니다", false, null).andExpect(status().isNoContent());
    assertThat(agentMessages().get(1)).isEqualTo(IssueRecurrenceService.TEST_LABEL + "보냈습니다");
    Record done = row();
    assertThat(done.get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID)).isNull();
    assertThat(done.get(ISSUE_RECURRENCE.FOLLOW_UP_TEST_BY)).isNull();
    assertSameSchedule(before, done);
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
  }

  @Test
  void 테스트_이어_처리가_또_멈추면_같은_사람이_답하는_테스트_질문으로_남는다() throws Exception {
    runNow(owner).andExpect(status().isAccepted());
    report(row().get(ISSUE_RECURRENCE.TEST_RUN_ID), true, "메일을 보낼까요?", true, null)
        .andExpect(status().isNoContent());
    chat(owner, "보내 줘");
    String follow = row().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID);

    var paused = List.of(Map.of("tool", "create_event", "args", Map.of("title", "보고 회의")));
    report(follow, true, "회의도 잡을까요?", true, paused).andExpect(status().isNoContent());

    Record asked = row();
    assertThat(asked.get(ISSUE_RECURRENCE.PENDING_QUESTION_ANSWERER)).isEqualTo(owner);
    assertThat(asked.get(ISSUE_RECURRENCE.PENDING_QUESTION_ACTIONS)).contains("create_event");
    assertThat(asked.get(ISSUE_RECURRENCE.PENDING_QUESTION_TEXT))
        .isEqualTo(IssueRecurrenceService.TEST_LABEL + "회의도 잡을까요?");
  }

  @Test
  void 테스트_질문은_다음_정기_회차가_묻지_않고_끝나도_남는다() throws Exception {
    runNow(owner).andExpect(status().isAccepted());
    report(row().get(ISSUE_RECURRENCE.TEST_RUN_ID), true, "메일을 보낼까요?", true, null)
        .andExpect(status().isNoContent());

    setNextRunAt(Instant.now().minusSeconds(60));
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    report(row().get(ISSUE_RECURRENCE.PENDING_RUN_ID), true, "오늘 정리", false, null)
        .andExpect(status().isNoContent());

    assertThat(row().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNotNull();
    chat(owner, "보내 줘");
    assertThat(events.stream(IssueRecurringRunEvent.class).filter(e -> e.followUp() != null))
        .hasSize(1);
  }

  @Test
  void 정기_회차가_새로_물으면_테스트_질문의_허락은_사라진다() throws Exception {
    runNow(owner).andExpect(status().isAccepted());
    report(
            row().get(ISSUE_RECURRENCE.TEST_RUN_ID),
            true,
            "메일을 보낼까요?",
            true,
            List.of(Map.of("tool", "send_mail")))
        .andExpect(status().isNoContent());

    setNextRunAt(Instant.now().minusSeconds(60));
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    report(row().get(ISSUE_RECURRENCE.PENDING_RUN_ID), true, "초안을 올릴까요?", true, null)
        .andExpect(status().isNoContent());

    Record asked = row();
    assertThat(asked.get(ISSUE_RECURRENCE.PENDING_QUESTION_ANSWERER)).isNull();
    assertThat(asked.get(ISSUE_RECURRENCE.PENDING_QUESTION_ACTIONS)).isNull();
    chat(owner, "올려 줘");
    var f = events.stream(IssueRecurringRunEvent.class).filter(e -> e.followUp() != null).toList();
    assertThat(f).hasSize(1);
    assertThat(f.get(0).test()).isFalse();
    assertThat(f.get(0).followUp().permittedActions()).isNull();
  }

  // ───────────────────────────── 질문·실행 겹침(WP-1313 리뷰) ─────────────────────────────

  @Test
  void 정기_회차_질문이_답을_기다리면_지금_실행을_거절해_그_질문을_덮지_않는다() throws Exception {
    setNextRunAt(Instant.now().minusSeconds(60));
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    report(row().get(ISSUE_RECURRENCE.PENDING_RUN_ID), true, "초안을 올릴까요?", true, null)
        .andExpect(status().isNoContent());
    Long question = row().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID);

    runNow(owner)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(IssueRecurrenceService.QUESTION_PENDING));
    assertThat(row().get(ISSUE_RECURRENCE.TEST_RUN_ID)).isNull();
    assertThat(row().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isEqualTo(question);

    // 답하면(이어 처리가 끝나면) 다시 누를 수 있다.
    afterRejectedRequest();
    chat(owner, "올려 줘");
    report(row().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID), true, "올렸습니다", false, null)
        .andExpect(status().isNoContent());
    runNow(owner).andExpect(status().isAccepted());
  }

  @Test
  void 기한이_지난_정기_회차_질문은_지금_실행을_막지_않는다() throws Exception {
    setNextRunAt(Instant.now().minusSeconds(60));
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    report(row().get(ISSUE_RECURRENCE.PENDING_RUN_ID), true, "초안을 올릴까요?", true, null)
        .andExpect(status().isNoContent());
    dsl.update(ISSUE_RECURRENCE)
        .set(
            ISSUE_RECURRENCE.PENDING_QUESTION_ASKED_AT,
            Instant.now().minus(8, ChronoUnit.DAYS).atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();

    runNow(owner).andExpect(status().isAccepted());
  }

  @Test
  void 이어_처리가_도는_중에는_지금_실행을_거절한다() throws Exception {
    runNow(owner).andExpect(status().isAccepted());
    report(row().get(ISSUE_RECURRENCE.TEST_RUN_ID), true, "메일을 보낼까요?", true, null)
        .andExpect(status().isNoContent());
    chat(owner, "보내 줘");
    assertThat(row().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID)).isNotNull();

    runNow(owner)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(IssueRecurrenceService.RUN_IN_FLIGHT));
    assertThat(row().get(ISSUE_RECURRENCE.TEST_RUN_ID)).isNull();
  }

  @Test
  void 정기_회차가_도는_중에_답하면_409로_거절하고_질문은_남아_끝난_뒤_다시_답할_수_있다() throws Exception {
    runNow(owner).andExpect(status().isAccepted());
    report(row().get(ISSUE_RECURRENCE.TEST_RUN_ID), true, "메일을 보낼까요?", true, null)
        .andExpect(status().isNoContent());
    Long question = row().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID);
    setNextRunAt(Instant.now().minusSeconds(60));
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);

    chatExpect(owner, "보내 줘")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(IssueRecurrenceFollowUpService.RUN_IN_FLIGHT));
    assertThat(followUpEvents()).isEmpty();
    assertThat(row().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isEqualTo(question);
    assertThat(row().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID)).isNull();

    afterRejectedRequest();
    report(row().get(ISSUE_RECURRENCE.PENDING_RUN_ID), true, "오늘 정리", false, null)
        .andExpect(status().isNoContent());
    chat(owner, "보내 줘");
    assertThat(followUpEvents()).hasSize(1);
    assertThat(followUpEvents().get(0).test()).isTrue();
  }

  @Test
  void 테스트_실행이_도는_중에_앞선_테스트_질문에_답하면_409() throws Exception {
    runNow(owner).andExpect(status().isAccepted());
    report(row().get(ISSUE_RECURRENCE.TEST_RUN_ID), true, "메일을 보낼까요?", true, null)
        .andExpect(status().isNoContent());
    // 앞선 테스트 질문은 새 테스트 실행을 막지 않는다.
    runNow(owner).andExpect(status().isAccepted());

    chatExpect(owner, "보내 줘")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(IssueRecurrenceFollowUpService.RUN_IN_FLIGHT));
    assertThat(followUpEvents()).isEmpty();
    assertThat(row().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNotNull();
  }

  @Test
  void 이어_처리가_도는_중에_새_질문에_답해도_앞선_이어_처리를_덮어쓰지_않는다() throws Exception {
    // 테스트 질문 → 답(이어 처리 도는 중) → 그 사이 새 질문이 생겼다.
    runNow(owner).andExpect(status().isAccepted());
    report(row().get(ISSUE_RECURRENCE.TEST_RUN_ID), true, "메일을 보낼까요?", true, null)
        .andExpect(status().isNoContent());
    long testQuestionId = row().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID);
    chat(owner, "보내 줘");
    String follow = row().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID);
    // WP-1407: 이어 처리가 도는 동안은 그 AI 가 바빠 정기 회차가 나가지 않는다.
    setNextRunAt(Instant.now().minusSeconds(60));
    assertThat(recurrenceService.runDue(Instant.now())).isZero();
    // 사람이 바로 원한 실행끼리의 드문 겹침(설계 WP-1407 §2.1)으로 정기 회차 질문이 남은 경우를 흉내 낸다 — 덮어쓰기 방지는 그대로 지켜야 한다.
    recurrenceRepository.setPendingQuestion(
        issueId, testQuestionId, "초안을 올릴까요?", Instant.now(), null, null);
    assertThat(row().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNotNull();

    chatExpect(owner, "올려 줘").andExpect(status().isConflict());
    assertThat(row().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID)).isEqualTo(follow);
    assertThat(followUpEvents()).hasSize(1);
    assertThat(row().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNotNull();

    // 앞선 이어 처리 결과가 남은 뒤에는 새 질문에 답할 수 있다.
    afterRejectedRequest();
    report(follow, true, "보냈습니다", false, null).andExpect(status().isNoContent());
    chat(owner, "올려 줘");
    assertThat(followUpEvents()).hasSize(2);
    assertThat(followUpEvents().get(1).test()).isFalse();
  }

  // ───────────────────────────── 대기 시간 초과·삭제 ─────────────────────────────

  @Test
  void 결과를_40분_넘게_못_받으면_비우고_알린다() throws Exception {
    Record before = row();
    runNow(owner).andExpect(status().isAccepted());
    String testRun = row().get(ISSUE_RECURRENCE.TEST_RUN_ID);
    dsl.update(ISSUE_RECURRENCE)
        .set(
            ISSUE_RECURRENCE.TEST_RUN_DISPATCHED_AT,
            Instant.now().minus(41, ChronoUnit.MINUTES).atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();

    assertThat(recurrenceService.runDue(Instant.now())).isZero();

    assertThat(row().get(ISSUE_RECURRENCE.TEST_RUN_ID)).isNull();
    assertThat(agentMessages())
        .containsExactly(IssueRecurrenceService.TEST_LABEL + IssueRecurrenceService.TEST_LOST);
    assertSameSchedule(before, row());
    // 늦게 온 결과는 무시한다.
    report(testRun, true, "늦은 결과", false, null).andExpect(status().isNoContent());
    assertThat(agentMessages()).hasSize(1);
  }

  @Test
  void 테스트_실행_중에_지우면_묘비로_남기고_그_결과는_받는다() throws Exception {
    runNow(owner).andExpect(status().isAccepted());
    String testRun = row().get(ISSUE_RECURRENCE.TEST_RUN_ID);
    call(delete(path()), owner).andExpect(status().isNoContent());
    assertThat(row().get(ISSUE_RECURRENCE.DELETED)).isTrue();

    report(testRun, true, "확인했습니다", false, null).andExpect(status().isNoContent());
    assertThat(agentMessages()).containsExactly(IssueRecurrenceService.TEST_LABEL + "확인했습니다");
    assertThat(row()).isNull();
  }

  // ───────────────────────────── 도우미 ─────────────────────────────

  /** 정기 회차 상태(다음 회차·연속 실패 수·회차 수·마지막 실행·켜짐)가 같은지 — 테스트 실행이 건드리지 않아야 하는 값. */
  private static void assertSameSchedule(Record before, Record after) {
    assertThat(after.get(ISSUE_RECURRENCE.NEXT_RUN_AT))
        .isEqualTo(before.get(ISSUE_RECURRENCE.NEXT_RUN_AT));
    assertThat(after.get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES))
        .isEqualTo(before.get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES));
    assertThat(after.get(ISSUE_RECURRENCE.RUN_COUNT))
        .isEqualTo(before.get(ISSUE_RECURRENCE.RUN_COUNT));
    assertThat(after.get(ISSUE_RECURRENCE.LAST_RUN_AT))
        .isEqualTo(before.get(ISSUE_RECURRENCE.LAST_RUN_AT));
    assertThat(after.get(ISSUE_RECURRENCE.ENABLED)).isEqualTo(before.get(ISSUE_RECURRENCE.ENABLED));
  }

  private ResultActions runNow(long as) throws Exception {
    return call(post(path() + "/test-runs"), as);
  }

  /** 사람이 이 이슈 챗에 글을 남기고 그 글 id 를 돌려준다(화면과 같은 API). */
  private long chat(long as, String body) throws Exception {
    JsonNode r = json(chatExpect(as, body).andExpect(status().isCreated()));
    return r.get("id").asLong();
  }

  /** 사람이 이 이슈 챗에 글을 남긴다 — 응답을 그대로 돌려줘 거절(409)도 확인할 수 있게. */
  private ResultActions chatExpect(long as, String body) throws Exception {
    long threadId = chatThreadRepository.insertIfAbsent(issueId);
    return call(
        post("/api/v1/chat/threads/" + threadId + "/messages")
            .content(om.writeValueAsString(Map.of("body", body))),
        as);
  }

  /**
   * 거절(409)된 요청 뒤 테스트 트랜잭션의 「롤백만」 표시를 지운다. 운영에서는 요청마다 트랜잭션이 따로라 거절된 요청이 다음 요청에 영향을 주지 않지만, 이 테스트는
   * 요청들이 테스트 트랜잭션 하나를 함께 쓴다 — 표시가 남으면 다음 답의 이어 처리 세이브포인트(NESTED)가 커밋 대신 조용히 되돌려진다.
   */
  private static void afterRejectedRequest() {
    TransactionSynchronizationManager.getResourceMap().values().stream()
        .filter(ConnectionHolder.class::isInstance)
        .forEach(h -> ((ConnectionHolder) h).resetRollbackOnly());
  }

  /** 지금까지 보낸 이어 처리 이벤트(보낸 순). */
  private List<IssueRecurringRunEvent> followUpEvents() {
    return events.stream(IssueRecurringRunEvent.class).filter(e -> e.followUp() != null).toList();
  }

  private void setNextRunAt(Instant t) {
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.NEXT_RUN_AT, t.atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  private Record row() {
    return dsl.selectFrom(ISSUE_RECURRENCE).where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId)).fetchOne();
  }

  private Record activeWork() {
    Record r =
        dsl.selectFrom(AGENT_WORK)
            .where(AGENT_WORK.ISSUE_ID.eq(issueId))
            .and(AGENT_WORK.WORKER_ID.eq(agent))
            .and(AGENT_WORK.ENDED_AT.isNull())
            .fetchOne();
    assertThat(r).as("진행 중 AI 작업").isNotNull();
    return r;
  }

  /** 이 이슈 챗에 AI 가 남긴 글(작성 순). */
  private List<String> agentMessages() {
    return dsl.select(CHAT_MESSAGE.BODY)
        .from(CHAT_MESSAGE)
        .join(CHAT_THREAD)
        .on(CHAT_THREAD.ID.eq(CHAT_MESSAGE.THREAD_ID))
        .where(CHAT_THREAD.ISSUE_ID.eq(issueId))
        .and(CHAT_MESSAGE.AUTHOR_ID.eq(agent))
        .orderBy(CHAT_MESSAGE.ID)
        .fetch(CHAT_MESSAGE.BODY);
  }

  private List<Boolean> agentQuestionFlags() {
    return dsl.select(CHAT_MESSAGE.IS_QUESTION)
        .from(CHAT_MESSAGE)
        .join(CHAT_THREAD)
        .on(CHAT_THREAD.ID.eq(CHAT_MESSAGE.THREAD_ID))
        .where(CHAT_THREAD.ISSUE_ID.eq(issueId))
        .and(CHAT_MESSAGE.AUTHOR_ID.eq(agent))
        .orderBy(CHAT_MESSAGE.ID)
        .fetch(CHAT_MESSAGE.IS_QUESTION);
  }

  /** ai-agent 의 내부 결과 보고(실행 AI 대행). pausedActions 는 테스트 실행이 멈춘 쓰기 목록이다. */
  private ResultActions report(
      String runId, boolean ok, String message, boolean question, List<?> pausedActions)
      throws Exception {
    var body = new HashMap<String, Object>();
    body.put("runId", runId);
    body.put("ok", ok);
    body.put("message", message);
    body.put("question", question);
    if (pausedActions != null) body.put("pausedActions", pausedActions);
    var r =
        mvc.perform(
            post("/api/v1/internal/issue-recurrence/" + issueId + "/runs")
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .header("X-On-Behalf-Of", String.valueOf(agent))
                .header("X-On-Behalf-Of-Tenant", "1")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body)));
    TenantContext.set(1L);
    return r;
  }

  private String path() {
    return "/api/v1/projects/" + key + "/issues/" + number + "/recurrence";
  }

  private String req(String rrule, String time) throws Exception {
    var m = new HashMap<String, Object>();
    m.put("rrule", rrule);
    m.put("time", time);
    return om.writeValueAsString(m);
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long caller) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L))
        .contentType(MediaType.APPLICATION_JSON);
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}
