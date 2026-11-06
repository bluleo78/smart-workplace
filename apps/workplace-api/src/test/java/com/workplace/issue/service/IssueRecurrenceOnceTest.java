package com.workplace.issue.service;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.CHAT_THREAD;
import static com.workplace.jooq.Tables.ISSUE_RECURRENCE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.chat.repository.ChatThreadRepository;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.exception.InvalidIssueRecurrenceException;
import com.workplace.issue.outbound.IssueDomainEvents.IssueRecurringRunEvent;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
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
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 「한 번만」 실행 예약(WP-1315) 통합 테스트 — FREQ=ONCE 저장(날짜 채우기·다음 실행 계산), 검증(지난 시각·섞인 항목·형식), 한 번 실행한 뒤
 * 결과(성공·실패·결과 못 받음)로 일정이 꺼지는 것, 「지금 실행」(테스트 실행)이 예약을 쓰지 않는 것, 결과를 기다리는 사이 다시 저장한 예약이 살아남는 것, 만들기 창의
 * 프로젝트 단위 담당 AI 후보.
 *
 * <p>시드는 {@link IssueRecurrenceRunNowTest} 와 같다 — 개인 프로젝트(owner 소유) + 이슈 1건, owner 의 개인 비서(agent,
 * 토큰 보유)가 멤버·담당자. 일정은 테스트마다 저장한다.
 */
@Transactional
@RecordApplicationEvents
class IssueRecurrenceOnceTest extends IntegrationTestBase {

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
  @Autowired IssueRecurrenceRules rules;
  @Autowired ApplicationEvents events;
  @Autowired ChatThreadRepository chatThreadRepository;

  private long owner;
  private long agent;
  private String key;
  private long issueId;
  private int number;

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
    var issue =
        issueService.create(
            owner,
            key,
            new CreateIssueRequest("회의록 정리", "어제 회의록을 정리해 줘", null, null, null, null, null, null));
    issueId = issue.id();
    number = issue.number();
    assigneeRepository.add(issueId, agent, owner);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ───────────────────────────── 규칙 ─────────────────────────────

  @Test
  void 날짜_없는_한번만은_그_시각의_다음_때로_채운다() {
    // 2026-11-02 23:00Z = 11/3 08:00 KST. 08:30 은 아직 안 지나 오늘(11/3), 07:30 은 지나 내일(11/4).
    Instant now = Instant.parse("2026-11-02T23:00:00Z");
    assertThat(rules.resolveOnce("FREQ=ONCE", LocalTime.of(8, 30), now))
        .isEqualTo("FREQ=ONCE;DATE=2026-11-03");
    assertThat(rules.resolveOnce("FREQ=ONCE", LocalTime.of(7, 30), now))
        .isEqualTo("FREQ=ONCE;DATE=2026-11-04");
    // 같은 분(08:00)은 지난 것으로 본다 — 지금 바로 보내지 않고 내일.
    assertThat(rules.resolveOnce("FREQ=ONCE", LocalTime.of(8, 0), now))
        .isEqualTo("FREQ=ONCE;DATE=2026-11-04");
    // 날짜가 있으면 그대로, 지났으면 400, 1년 넘게 뒤면 400. 한 번만이 아니면 손대지 않는다.
    assertThat(rules.resolveOnce("FREQ=ONCE;DATE=2026-11-10", LocalTime.of(9, 0), now))
        .isEqualTo("FREQ=ONCE;DATE=2026-11-10");
    assertThatThrownBy(
            () -> rules.resolveOnce("FREQ=ONCE;DATE=2026-11-03", LocalTime.of(7, 0), now))
        .isInstanceOf(InvalidIssueRecurrenceException.class)
        .hasMessageContaining("이미 지난 시각");
    assertThatThrownBy(
            () -> rules.resolveOnce("FREQ=ONCE;DATE=2028-01-01", LocalTime.of(7, 0), now))
        .isInstanceOf(InvalidIssueRecurrenceException.class);
    assertThat(rules.resolveOnce("FREQ=DAILY", LocalTime.of(7, 0), now)).isEqualTo("FREQ=DAILY");
  }

  @Test
  void 한번만의_다음_실행은_정한_날짜_시각_하나뿐이다() {
    String rrule = "FREQ=ONCE;DATE=2026-11-03";
    Instant at = Instant.parse("2026-11-02T23:30:00Z"); // 11/3 08:30 KST
    assertThat(rules.nextRunAfter(rrule, LocalTime.of(8, 30), at.minusSeconds(3600))).isEqualTo(at);
    assertThat(rules.nextRunAfter(rrule, LocalTime.of(8, 30), at)).isNull();
    assertThat(rules.nextRunAfter(rrule, LocalTime.of(8, 30), at.plusSeconds(60))).isNull();
    assertThat(IssueRecurrenceRules.isOnce(rrule)).isTrue();
    assertThat(IssueRecurrenceRules.isOnce("FREQ=DAILY")).isFalse();
  }

  // ───────────────────────────── 저장·검증 ─────────────────────────────

  @Test
  void 한번만을_저장하면_날짜가_채워지고_다음_실행이_그_시각이다() throws Exception {
    LocalDate date = LocalDate.now(IssueRecurrenceRules.KST).plusDays(2);
    call(put(path()).content(req("FREQ=ONCE;DATE=" + date, "08:30")), owner)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.rrule").value("FREQ=ONCE;DATE=" + date))
        .andExpect(jsonPath("$.time").value("08:30"))
        .andExpect(jsonPath("$.enabled").value(true))
        .andExpect(
            jsonPath("$.nextRunAt")
                .value(date.atTime(8, 30).atZone(IssueRecurrenceRules.KST).toInstant().toString()));
    // 담당 AI 는 담당자로 남고, 작업 기록은 「다음 회차 대기」.
    assertThat(assigneeRepository.findUserIdsByIssue(issueId)).contains(agent);
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");

    // 날짜 없이 보내면 서버가 그 시각의 다음 때로 채운다(오늘 또는 내일).
    call(put(path()).content(req("FREQ=ONCE", "08:30")), owner).andExpect(status().isOk());
    String saved = row().get(ISSUE_RECURRENCE.RRULE);
    LocalDate today = LocalDate.now(IssueRecurrenceRules.KST);
    assertThat(saved).isIn("FREQ=ONCE;DATE=" + today, "FREQ=ONCE;DATE=" + today.plusDays(1));
    assertThat(row().get(ISSUE_RECURRENCE.NEXT_RUN_AT).toInstant()).isAfter(Instant.now());
  }

  @Test
  void 한번만_규칙이_틀리면_400() throws Exception {
    String past = LocalDate.now(IssueRecurrenceRules.KST).minusDays(1).toString();
    List<String> bad =
        List.of(
            "FREQ=ONCE;DATE=" + past,
            "FREQ=ONCE;DATE=2026-02-30",
            "FREQ=ONCE;DATE=20261103",
            "FREQ=ONCE;BYDAY=MO",
            "FREQ=ONCE;BYMONTHDAY=1",
            "FREQ=ONCE;INTERVAL=1",
            "FREQ=DAILY;DATE=2030-01-01");
    for (String rrule : bad) {
      call(put(path()).content(req(rrule, "08:00")), owner).andExpect(status().isBadRequest());
    }
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
  }

  // ───────────────────────────── 한 번 실행하고 꺼짐 ─────────────────────────────

  @Test
  void 한번만은_한_번_보내고_성공_결과가_오면_일정이_꺼진다() throws Exception {
    saveOnce();
    setNextRunAt(Instant.now().minusSeconds(30));

    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    Record sent = row();
    assertThat(sent.get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isNotNull();
    // 다음 회차가 없다 — 다시 보내지 않는다(결과를 기다리는 중에도, 끝난 뒤에도).
    assertThat(sent.get(ISSUE_RECURRENCE.NEXT_RUN_AT)).isNull();
    assertThat(sent.get(ISSUE_RECURRENCE.ENABLED)).isTrue();
    assertThat(recurrenceService.runDue(Instant.now().plusSeconds(60))).isZero();
    var run = events.stream(IssueRecurringRunEvent.class).toList();
    assertThat(run).hasSize(1);
    assertThat(run.get(0).test()).isFalse();
    assertThat(run.get(0).rrule()).startsWith("FREQ=ONCE;DATE=");

    report(sent.get(ISSUE_RECURRENCE.PENDING_RUN_ID), true, "회의록을 정리했습니다")
        .andExpect(status().isNoContent());

    Record done = row();
    assertThat(done.get(ISSUE_RECURRENCE.ENABLED)).isFalse();
    assertThat(done.get(ISSUE_RECURRENCE.NEXT_RUN_AT)).isNull();
    assertThat(done.get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isNull();
    assertThat(agentMessages()).containsExactly("회의록을 정리했습니다");
    // AI 작업 기록은 완료로 끝난다 — 「다음 회차 대기」로 남지 않는다.
    assertThat(latestWork().get(AGENT_WORK.STATE)).isEqualTo("COMPLETED");
    assertThat(latestWork().get(AGENT_WORK.ENDED_AT)).isNotNull();
    call(get(path()), owner)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.enabled").value(false))
        .andExpect(jsonPath("$.nextRunAt").isEmpty());
    // 꺼진 일정은 다시 돌지 않는다.
    assertThat(recurrenceService.runDue(Instant.now().plusSeconds(86_400 * 2))).isZero();
    assertThat(events.stream(IssueRecurringRunEvent.class)).hasSize(1);
  }

  @Test
  void 한번만이_실패해도_끝난_것으로_보고_일정을_끈다() throws Exception {
    saveOnce();
    String runId = dispatch();

    report(runId, false, "메일함에 접근하지 못했습니다").andExpect(status().isNoContent());

    Record done = row();
    assertThat(done.get(ISSUE_RECURRENCE.ENABLED)).isFalse();
    assertThat(done.get(ISSUE_RECURRENCE.NEXT_RUN_AT)).isNull();
    assertThat(done.get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isEqualTo(1);
    // 실패 사유만 남고 「3회 연속 실패로 멈춤」 안내는 남지 않는다.
    assertThat(agentMessages())
        .containsExactly(IssueRecurrenceService.FAILED_PREFIX + "메일함에 접근하지 못했습니다");
    assertThat(latestWork().get(AGENT_WORK.STATE)).isEqualTo("FAILED");
  }

  @Test
  void 한번만의_결과를_오래_못_받아도_일정을_끈다() throws Exception {
    saveOnce();
    dispatch();

    recurrenceService.runDue(
        Instant.now().plus(IssueRecurrenceProperties.DEFAULT_PENDING_TIMEOUT).plusSeconds(60));

    Record done = row();
    assertThat(done.get(ISSUE_RECURRENCE.ENABLED)).isFalse();
    assertThat(done.get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isNull();
    assertThat(done.get(ISSUE_RECURRENCE.NEXT_RUN_AT)).isNull();
    assertThat(agentMessages()).containsExactly(IssueRecurrenceService.LOST_RUN);
  }

  @Test
  void 지금_실행은_한번만_예약을_쓰지_않는다() throws Exception {
    saveOnce();
    Record before = row();

    call(post(path() + "/test-runs"), owner).andExpect(status().isAccepted());
    String testRun = row().get(ISSUE_RECURRENCE.TEST_RUN_ID);
    assertThat(testRun).isNotNull();
    report(testRun, true, "시험 삼아 정리했습니다").andExpect(status().isNoContent());

    Record after = row();
    assertThat(after.get(ISSUE_RECURRENCE.ENABLED)).isTrue();
    assertThat(after.get(ISSUE_RECURRENCE.NEXT_RUN_AT))
        .isEqualTo(before.get(ISSUE_RECURRENCE.NEXT_RUN_AT));
    assertThat(after.get(ISSUE_RECURRENCE.RUN_COUNT))
        .isEqualTo(before.get(ISSUE_RECURRENCE.RUN_COUNT));
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");

    // 예약 시각이 되면 그대로 한 번 돈다.
    setNextRunAt(Instant.now().minusSeconds(30));
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
  }

  @Test
  void 결과를_기다리는_사이_다시_저장한_한번만_예약은_결과가_와도_남는다() throws Exception {
    saveOnce();
    String runId = dispatch();

    // 결과를 기다리는 사이 다른 날로 다시 예약한다.
    LocalDate later = LocalDate.now(IssueRecurrenceRules.KST).plusDays(3);
    call(put(path()).content(req("FREQ=ONCE;DATE=" + later, "09:00")), owner)
        .andExpect(status().isOk());
    report(runId, true, "정리했습니다").andExpect(status().isNoContent());

    Record r = row();
    assertThat(r.get(ISSUE_RECURRENCE.ENABLED)).isTrue();
    assertThat(r.get(ISSUE_RECURRENCE.NEXT_RUN_AT).toInstant())
        .isEqualTo(later.atTime(9, 0).atZone(IssueRecurrenceRules.KST).toInstant());
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
  }

  @Test
  void 꺼진_한번만을_다시_저장하면_새_시각으로_켜진다() throws Exception {
    saveOnce();
    report(dispatch(), true, "정리했습니다").andExpect(status().isNoContent());
    assertThat(row().get(ISSUE_RECURRENCE.ENABLED)).isFalse();

    call(put(path()).content(req("FREQ=ONCE", "23:59")), owner)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.enabled").value(true));
    assertThat(row().get(ISSUE_RECURRENCE.NEXT_RUN_AT).toInstant()).isAfter(Instant.now());
  }

  // ───────────────────────────── 질문으로 끝난 한 번만 ─────────────────────────────

  @Test
  void 한번만이_질문으로_끝나면_작업은_답을_기다리고_이어_처리_결과가_끝낸다() throws Exception {
    saveOnce();
    report(dispatch(), true, "메일을 보낼까요?", true).andExpect(status().isNoContent());

    // 일정은 꺼지고 다음 실행이 없지만, 작업 기록은 정기 회차 질문처럼 「대기」로 남아 답을 기다린다 — 완료로 끝나지 않는다.
    Record asked = row();
    assertThat(asked.get(ISSUE_RECURRENCE.ENABLED)).isFalse();
    assertThat(asked.get(ISSUE_RECURRENCE.NEXT_RUN_AT)).isNull();
    assertThat(asked.get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNotNull();
    Record waiting = activeWork();
    assertThat(waiting.get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
    assertThat(waiting.get(AGENT_WORK.NOTE)).isEqualTo(IssueRecurrenceService.NOTE_ONCE_QUESTION);
    assertThat(waiting.get(AGENT_WORK.NEXT_RUN_AT)).isNull();

    // 소유자가 답하면 같은 AI 가 이어 처리하고, 그동안 작업은 「작업 중」.
    chat(owner, "보내 줘");
    String followUp = row().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID);
    assertThat(followUp).isNotNull();
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("WORKING");

    // 이어 처리 결과가 오면 작업을 완료로 끝낸다 — 일정은 꺼진 채, 다음 실행도 비어 있다.
    report(followUp, true, "메일을 보냈습니다").andExpect(status().isNoContent());
    assertThat(agentMessages()).containsExactly("메일을 보낼까요?", "메일을 보냈습니다");
    assertThat(latestWork().get(AGENT_WORK.STATE)).isEqualTo("COMPLETED");
    assertThat(latestWork().get(AGENT_WORK.NOTE)).isEqualTo(IssueRecurrenceService.NOTE_ONCE_DONE);
    Record done = row();
    assertThat(done.get(ISSUE_RECURRENCE.ENABLED)).isFalse();
    assertThat(done.get(ISSUE_RECURRENCE.NEXT_RUN_AT)).isNull();
    assertThat(done.get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID)).isNull();
    assertThat(recurrenceService.runDue(Instant.now().plusSeconds(86_400 * 2))).isZero();
  }

  @Test
  void 한번만_질문의_이어_처리가_실패하면_작업을_실패로_끝낸다() throws Exception {
    saveOnce();
    report(dispatch(), true, "메일을 보낼까요?", true).andExpect(status().isNoContent());
    chat(owner, "보내 줘");

    report(row().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID), false, "메일함에 접근하지 못했습니다")
        .andExpect(status().isNoContent());

    assertThat(latestWork().get(AGENT_WORK.STATE)).isEqualTo("FAILED");
    assertThat(row().get(ISSUE_RECURRENCE.ENABLED)).isFalse();
    assertThat(row().get(ISSUE_RECURRENCE.NEXT_RUN_AT)).isNull();
  }

  @Test
  void 한번만_질문의_이어_처리가_또_물으면_계속_답을_기다린다() throws Exception {
    saveOnce();
    report(dispatch(), true, "메일을 보낼까요?", true).andExpect(status().isNoContent());
    chat(owner, "보내 줘");

    report(row().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID), true, "받는 사람은 누구인가요?", true)
        .andExpect(status().isNoContent());
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
    assertThat(activeWork().get(AGENT_WORK.NOTE))
        .isEqualTo(IssueRecurrenceService.NOTE_ONCE_QUESTION);

    chat(owner, "팀장님께");
    report(row().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID), true, "팀장님께 보냈습니다")
        .andExpect(status().isNoContent());
    assertThat(latestWork().get(AGENT_WORK.STATE)).isEqualTo("COMPLETED");
  }

  @Test
  void 한번만_질문의_이어_처리_결과를_못_받으면_작업을_실패로_끝낸다() throws Exception {
    saveOnce();
    report(dispatch(), true, "메일을 보낼까요?", true).andExpect(status().isNoContent());
    chat(owner, "보내 줘");

    recurrenceService.runDue(
        Instant.now().plus(IssueRecurrenceProperties.DEFAULT_PENDING_TIMEOUT).plusSeconds(60));

    assertThat(row().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID)).isNull();
    assertThat(latestWork().get(AGENT_WORK.STATE)).isEqualTo("FAILED");
    assertThat(row().get(ISSUE_RECURRENCE.ENABLED)).isFalse();
  }

  @Test
  void 한번만_질문의_답_기한이_지나면_스케줄러가_작업을_끝낸다() throws Exception {
    saveOnce();
    report(dispatch(), true, "메일을 보낼까요?", true).andExpect(status().isNoContent());
    // 기한 안이면 건드리지 않는다.
    recurrenceService.runDue(Instant.now());
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");

    recurrenceService.runDue(
        Instant.now().plus(IssueRecurrenceFollowUpService.QUESTION_TTL).plusSeconds(60));

    assertThat(row().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNull();
    assertThat(latestWork().get(AGENT_WORK.STATE)).isEqualTo("COMPLETED");
    assertThat(latestWork().get(AGENT_WORK.NOTE))
        .isEqualTo(IssueRecurrenceService.NOTE_ONCE_UNANSWERED);
    assertThat(row().get(ISSUE_RECURRENCE.ENABLED)).isFalse();
    assertThat(row().get(ISSUE_RECURRENCE.NEXT_RUN_AT)).isNull();
  }

  @Test
  void 한번만_질문에_기한이_지나_답하면_이어_처리하지_않고_작업을_끝낸다() throws Exception {
    saveOnce();
    report(dispatch(), true, "메일을 보낼까요?", true).andExpect(status().isNoContent());
    dsl.update(ISSUE_RECURRENCE)
        .set(
            ISSUE_RECURRENCE.PENDING_QUESTION_ASKED_AT,
            Instant.now()
                .minus(IssueRecurrenceFollowUpService.QUESTION_TTL)
                .minusSeconds(60)
                .atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();

    chat(owner, "보내 줘");

    assertThat(row().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID)).isNull();
    assertThat(row().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNull();
    assertThat(latestWork().get(AGENT_WORK.STATE)).isEqualTo("COMPLETED");
    assertThat(latestWork().get(AGENT_WORK.NOTE))
        .isEqualTo(IssueRecurrenceService.NOTE_ONCE_UNANSWERED);
  }

  // ───────────────────────────── 만들기 창의 담당 AI 후보 ─────────────────────────────

  @Test
  void 프로젝트_단위_담당_AI_후보는_이슈_단위와_같다() throws Exception {
    var project =
        om.readTree(
            call(get("/api/v1/projects/" + key + "/recurrence-agents"), owner)
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    var issue =
        om.readTree(
            call(get(path() + "/agents"), owner)
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    assertThat(project).isEqualTo(issue);
    assertThat(project.get(0).get("id").asLong()).isEqualTo(agent);
    assertThat(project.get(0).get("personalAssistant").asBoolean()).isTrue();
  }

  @Test
  void 프로젝트를_볼_수_없으면_후보도_볼_수_없다() throws Exception {
    long stranger = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, stranger, "USER");
    int code =
        call(get("/api/v1/projects/" + key + "/recurrence-agents"), stranger)
            .andReturn()
            .getResponse()
            .getStatus();
    assertThat(code).isIn(403, 404);
  }

  // ───────────────────────────── 도우미 ─────────────────────────────

  /** 내일 08:00 KST 한 번만 예약을 저장한다. */
  private void saveOnce() throws Exception {
    LocalDate tomorrow = LocalDate.now(IssueRecurrenceRules.KST).plusDays(1);
    call(put(path()).content(req("FREQ=ONCE;DATE=" + tomorrow, "08:00")), owner)
        .andExpect(status().isOk());
  }

  /** 예약 시각을 지금 앞으로 당겨 한 번 보내고 그 회차 id 를 돌려준다. */
  private String dispatch() {
    setNextRunAt(Instant.now().minusSeconds(30));
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    return row().get(ISSUE_RECURRENCE.PENDING_RUN_ID);
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

  /** 이 이슈에서 agent 의 가장 최근 작업 기록(끝난 것 포함). */
  private Record latestWork() {
    return dsl.selectFrom(AGENT_WORK)
        .where(AGENT_WORK.ISSUE_ID.eq(issueId))
        .and(AGENT_WORK.WORKER_ID.eq(agent))
        .orderBy(AGENT_WORK.ID.desc())
        .limit(1)
        .fetchOne();
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

  /** ai-agent 의 내부 결과 보고(실행 AI 대행). */
  private ResultActions report(String runId, boolean ok, String message) throws Exception {
    return report(runId, ok, message, false);
  }

  /** ai-agent 의 내부 결과 보고 — question 이면 결과 글이 답을 기다리는 질문이 된다(WP-1311). */
  private ResultActions report(String runId, boolean ok, String message, boolean question)
      throws Exception {
    var body = new HashMap<String, Object>();
    body.put("runId", runId);
    body.put("ok", ok);
    body.put("message", message);
    body.put("question", question);
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

  /** 사람이 이 이슈 챗에 글을 남긴다(화면과 같은 API) — 남은 질문의 답이면 이어 처리가 나간다. */
  private void chat(long as, String body) throws Exception {
    long threadId = chatThreadRepository.insertIfAbsent(issueId);
    call(
            post("/api/v1/chat/threads/" + threadId + "/messages")
                .content(om.writeValueAsString(Map.of("body", body))),
            as)
        .andExpect(status().isCreated());
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

  private ResultActions call(MockHttpServletRequestBuilder req, long caller) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L))
        .contentType(MediaType.APPLICATION_JSON);
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}
