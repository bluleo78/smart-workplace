package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE_RECURRENCE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
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
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
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
 * 「몇 시간마다」 실행 일정(WP-1373) 통합 테스트 — FREQ=HOURLY;INTERVAL=n;BYDAY=..;UNTILTIME=HH:mm 의 검증(허용 간격·요일·끝
 * 시각·자정 넘는 시간대), 다음 회차 계산(KST 시간대 안·끝 시각 정각 포함·주말과 주 경계 건너뜀), 저장·조회 왕복, 회차를 보낸 뒤 다음 회차가 같은 날 간격 뒤로
 * 잡히는 것.
 *
 * <p>시드는 {@link IssueRecurrenceOnceTest} 와 같다 — 개인 프로젝트(owner 소유) + 이슈 1건, owner 의 개인 비서(agent)가
 * 멤버·담당자.
 */
@Transactional
@RecordApplicationEvents
class IssueRecurrenceHourlyTest extends IntegrationTestBase {

  /** 평일 09~17시 2시간마다 — 09·11·13·15·17시(하루 5회). */
  private static final String WEEKDAYS_EVERY_2H =
      "FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;UNTILTIME=17:00";

  private static final LocalTime NINE = LocalTime.of(9, 0);

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
            new CreateIssueRequest("새 메일 확인", "새 메일을 확인해 줘", null, null, null, null, null, null));
    issueId = issue.id();
    number = issue.number();
    assigneeRepository.add(issueId, agent, owner);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ───────────────────────────── 규칙 검증 ─────────────────────────────

  @Test
  void 몇시간마다_규칙은_항목_순서를_고정해_저장한다() {
    assertThat(rules.normalizeRrule("freq=hourly;untiltime=18:00;byday=MO, WE;interval=3"))
        .isEqualTo("FREQ=HOURLY;INTERVAL=3;BYDAY=MO,WE;UNTILTIME=18:00");
    // 요일은 고른 순서와 무관하게 월→일 순서로 저장한다(같은 일정 = 같은 문자열).
    assertThat(rules.normalizeRrule("FREQ=HOURLY;INTERVAL=2;BYDAY=SU,FR, MO,WE;UNTILTIME=18:00"))
        .isEqualTo("FREQ=HOURLY;INTERVAL=2;BYDAY=MO,WE,FR,SU;UNTILTIME=18:00");
    // 간격이 없으면 1시간마다로 채운다.
    assertThat(rules.normalizeRrule("FREQ=HOURLY;BYDAY=SA;UNTILTIME=12:00"))
        .isEqualTo("FREQ=HOURLY;INTERVAL=1;BYDAY=SA;UNTILTIME=12:00");
    for (int n : new int[] {1, 2, 3, 4, 6, 12}) {
      assertThat(rules.normalizeRrule("FREQ=HOURLY;INTERVAL=" + n + ";BYDAY=MO;UNTILTIME=23:00"))
          .contains("INTERVAL=" + n);
    }
    assertThat(IssueRecurrenceRules.isHourly(WEEKDAYS_EVERY_2H)).isTrue();
    assertThat(IssueRecurrenceRules.isHourly("FREQ=DAILY")).isFalse();
  }

  @Test
  void 몇시간마다_규칙이_틀리면_거절한다() {
    List<String> bad =
        List.of(
            "FREQ=HOURLY;INTERVAL=5;BYDAY=MO;UNTILTIME=18:00", // 고를 수 없는 간격
            "FREQ=HOURLY;INTERVAL=0;BYDAY=MO;UNTILTIME=18:00",
            "FREQ=HOURLY;INTERVAL=24;BYDAY=MO;UNTILTIME=18:00",
            "FREQ=HOURLY;INTERVAL=x;BYDAY=MO;UNTILTIME=18:00",
            "FREQ=HOURLY;INTERVAL=2;UNTILTIME=18:00", // 요일 없음
            "FREQ=HOURLY;INTERVAL=2;BYDAY=MO,MO;UNTILTIME=18:00",
            "FREQ=HOURLY;INTERVAL=2;BYDAY=XX;UNTILTIME=18:00",
            "FREQ=HOURLY;INTERVAL=2;BYDAY=MO", // 끝 시각 없음
            "FREQ=HOURLY;INTERVAL=2;BYDAY=MO;UNTILTIME=25:00",
            "FREQ=HOURLY;INTERVAL=2;BYDAY=MO;UNTILTIME=1800",
            "FREQ=HOURLY;INTERVAL=2;BYDAY=MO;UNTILTIME=18:00;BYMONTHDAY=1",
            "FREQ=HOURLY;INTERVAL=2;BYDAY=MO;UNTILTIME=18:00;DATE=2030-01-01",
            "FREQ=DAILY;UNTILTIME=18:00", // 끝 시각은 몇 시간마다에서만
            "FREQ=DAILY;INTERVAL=2"); // 다른 빈도의 간격은 그대로 1 만
    for (String rrule : bad) {
      assertThatThrownBy(() -> rules.normalizeRrule(rrule))
          .as(rrule)
          .isInstanceOf(InvalidIssueRecurrenceException.class);
    }
  }

  @Test
  void 끝_시각이_시작_시각_이하면_거절한다() {
    // 자정을 넘는 시간대(22:00 부터 02:00 까지)와 같은 시각은 받지 않는다.
    assertThatThrownBy(
            () ->
                rules.checkHourlyWindow(
                    "FREQ=HOURLY;INTERVAL=1;BYDAY=MO;UNTILTIME=02:00", LocalTime.of(22, 0)))
        .isInstanceOf(InvalidIssueRecurrenceException.class)
        .hasMessageContaining("자정");
    assertThatThrownBy(
            () ->
                rules.checkHourlyWindow(
                    "FREQ=HOURLY;INTERVAL=1;BYDAY=MO;UNTILTIME=09:00", LocalTime.of(9, 0)))
        .isInstanceOf(InvalidIssueRecurrenceException.class);
    rules.checkHourlyWindow(WEEKDAYS_EVERY_2H, NINE);
    // 몇 시간마다가 아니면 보지 않는다.
    rules.checkHourlyWindow("FREQ=DAILY", LocalTime.of(23, 0));
  }

  // ───────────────────────────── 다음 회차 ─────────────────────────────

  @Test
  void 다음_회차는_시간대_안에서_간격마다_돌고_끝_시각_정각도_포함한다() {
    // 2026-11-02 은 월요일.
    assertThat(next(WEEKDAYS_EVERY_2H, NINE, "2026-11-02T07:00"))
        .isEqualTo(kst("2026-11-02T09:00"));
    // 회차 시각 그 자체는 제외 — 다음 간격으로.
    assertThat(next(WEEKDAYS_EVERY_2H, NINE, "2026-11-02T09:00"))
        .isEqualTo(kst("2026-11-02T11:00"));
    assertThat(next(WEEKDAYS_EVERY_2H, NINE, "2026-11-02T10:30"))
        .isEqualTo(kst("2026-11-02T11:00"));
    // 끝 시각(17:00) 정각도 회차다.
    assertThat(next(WEEKDAYS_EVERY_2H, NINE, "2026-11-02T16:59"))
        .isEqualTo(kst("2026-11-02T17:00"));
    // 마지막 회차 뒤는 다음 실행 요일의 시작 시각.
    assertThat(next(WEEKDAYS_EVERY_2H, NINE, "2026-11-02T17:00"))
        .isEqualTo(kst("2026-11-03T09:00"));
    // 간격이 끝 시각에 딱 맞지 않으면 끝 시각 이하인 회차까지만 — 17:30 까지면 09·12·15시(18시는 넘는다).
    String every3 = "FREQ=HOURLY;INTERVAL=3;BYDAY=MO;UNTILTIME=17:30";
    assertThat(next(every3, NINE, "2026-11-02T15:00")).isEqualTo(kst("2026-11-09T09:00"));
    assertThat(next(every3, NINE, "2026-11-02T13:00")).isEqualTo(kst("2026-11-02T15:00"));
    // 분이 있는 시작 시각도 그 분을 지킨다.
    assertThat(next(WEEKDAYS_EVERY_2H, LocalTime.of(9, 30), "2026-11-02T09:31"))
        .isEqualTo(kst("2026-11-02T11:30"));
  }

  @Test
  void 다음_회차는_주말과_주_경계를_건너뛴다() {
    // 금요일 마지막 회차 뒤는 월요일 09:00.
    assertThat(next(WEEKDAYS_EVERY_2H, NINE, "2026-11-06T17:00"))
        .isEqualTo(kst("2026-11-09T09:00"));
    // 토요일·일요일 중에도 월요일 09:00.
    assertThat(next(WEEKDAYS_EVERY_2H, NINE, "2026-11-07T12:00"))
        .isEqualTo(kst("2026-11-09T09:00"));
    assertThat(next(WEEKDAYS_EVERY_2H, NINE, "2026-11-08T23:59"))
        .isEqualTo(kst("2026-11-09T09:00"));
    // 일요일만 — 일요일 마지막 회차 뒤는 다음 주 일요일(한 주를 넘어간다).
    String sunday = "FREQ=HOURLY;INTERVAL=6;BYDAY=SU;UNTILTIME=21:00";
    assertThat(next(sunday, NINE, "2026-11-08T15:00")).isEqualTo(kst("2026-11-08T21:00"));
    assertThat(next(sunday, NINE, "2026-11-08T21:00")).isEqualTo(kst("2026-11-15T09:00"));
    // KST 자정 직전(UTC 로는 같은 날 15시) — KST 날짜로 센다.
    assertThat(rules.nextRunAfter(sunday, NINE, Instant.parse("2026-11-07T14:59:00Z")))
        .isEqualTo(kst("2026-11-08T09:00"));
  }

  @Test
  void 다른_빈도의_다음_회차는_그대로다() {
    assertThat(next("FREQ=DAILY", NINE, "2026-11-02T10:00")).isEqualTo(kst("2026-11-03T09:00"));
    assertThat(next("FREQ=WEEKLY;BYDAY=FR", NINE, "2026-11-02T10:00"))
        .isEqualTo(kst("2026-11-06T09:00"));
  }

  // ───────────────────────────── 저장·조회·회차 ─────────────────────────────

  @Test
  void 몇시간마다를_저장하고_조회하면_같은_규칙이_온다() throws Exception {
    call(
            put(path()).content(req("FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU;UNTILTIME=18:00", "09:00")),
            owner)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.rrule").value("FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU;UNTILTIME=18:00"))
        .andExpect(jsonPath("$.time").value("09:00"))
        .andExpect(jsonPath("$.enabled").value(true));
    call(get(path()), owner)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.rrule").value("FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU;UNTILTIME=18:00"))
        .andExpect(jsonPath("$.time").value("09:00"));
    // 다음 회차는 지금 뒤의 첫 회차 — 저장 때 계산한 값이 규칙의 계산과 같다.
    Instant saved = row().get(ISSUE_RECURRENCE.NEXT_RUN_AT).toInstant();
    assertThat(saved).isAfter(Instant.now().minusSeconds(5));
    assertThat(saved)
        .isEqualTo(
            rules.nextRunAfter(
                "FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU;UNTILTIME=18:00", NINE, saved.minusSeconds(1)));
  }

  @Test
  void 몇시간마다_저장이_틀리면_400() throws Exception {
    List<String[]> bad =
        List.of(
            new String[] {"FREQ=HOURLY;INTERVAL=5;BYDAY=MO;UNTILTIME=18:00", "09:00"},
            new String[] {"FREQ=HOURLY;INTERVAL=2;UNTILTIME=18:00", "09:00"},
            new String[] {"FREQ=HOURLY;INTERVAL=2;BYDAY=MO", "09:00"},
            new String[] {"FREQ=HOURLY;INTERVAL=2;BYDAY=MO;UNTILTIME=09:00", "09:00"},
            new String[] {"FREQ=HOURLY;INTERVAL=2;BYDAY=MO;UNTILTIME=02:00", "22:00"});
    for (String[] b : bad) {
      call(put(path()).content(req(b[0], b[1])), owner).andExpect(status().isBadRequest());
    }
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
  }

  @Test
  void 회차를_보내면_다음_회차가_간격_뒤로_잡힌다() throws Exception {
    // 매일(모든 요일) 00:00~23:00 1시간마다 — 지금이 언제든 1시간 안에 다음 회차가 있다.
    String everyHour = "FREQ=HOURLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR,SA,SU;UNTILTIME=23:00";
    call(put(path()).content(req(everyHour, "00:00")), owner).andExpect(status().isOk());
    Instant now = Instant.now();
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.NEXT_RUN_AT, now.minusSeconds(30).atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();

    assertThat(recurrenceService.runDue(now)).isEqualTo(1);

    Instant next = row().get(ISSUE_RECURRENCE.NEXT_RUN_AT).toInstant();
    assertThat(next).isEqualTo(rules.nextRunAfter(everyHour, LocalTime.MIDNIGHT, now));
    assertThat(next).isAfter(now);
    // 1시간마다라 다음 회차는 1시간 안이다(23:00 다음은 다음 날 00:00).
    assertThat(next).isBeforeOrEqualTo(now.plusSeconds(3600));
    var run = events.stream(IssueRecurringRunEvent.class).toList();
    assertThat(run).hasSize(1);
    assertThat(run.get(0).rrule()).isEqualTo(everyHour);
  }

  // ───────────────────────────── 도우미 ─────────────────────────────

  /** KST 벽시계 "yyyy-MM-ddTHH:mm" 의 순간. */
  private static Instant kst(String local) {
    return LocalDateTime.parse(local).atZone(IssueRecurrenceRules.KST).toInstant();
  }

  /** KST 벽시계 after 뒤의 첫 회차. */
  private Instant next(String rrule, LocalTime runTime, String afterKst) {
    return rules.nextRunAfter(rrule, runTime, kst(afterKst));
  }

  private Record row() {
    return dsl.selectFrom(ISSUE_RECURRENCE).where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId)).fetchOne();
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
