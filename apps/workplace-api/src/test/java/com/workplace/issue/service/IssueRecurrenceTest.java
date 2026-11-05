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
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.outbound.AgentWorkNoticeEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueRecurringRunEvent;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 반복 AI 작업(WP-989) 통합 테스트 — REST(PUT/GET/DELETE 검증·409), 저장 시 AI 작업 「다음 회차 대기」, 스케줄러 회차 실행(이벤트·다음
 * 회차·건너뛰고 지우기·결과 못 받은 회차 실패 처리·대기 시간 초과 정리·다음 회차 없음), 내부 결과 보고(성공·실패·3회 연속 실패로 멈춤·지난 runId 무시·다른
 * AI/사람 거부·실행 중 삭제 묘비), AI 위임 작업 목록의 반복 요약.
 *
 * <p>시드: 개인 프로젝트(owner 소유) + 이슈 1건, owner 의 개인 비서(agent, 토큰 보유)를 프로젝트 멤버·담당자로 둔다. @Transactional 이라
 * MockMvc 요청이 테스트 트랜잭션에 합류하고 끝나면 롤백된다.
 */
@Transactional
@RecordApplicationEvents
class IssueRecurrenceTest extends IntegrationTestBase {

  private static final String INTERNAL_TOKEN = "test-token";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMemberRepository;
  @Autowired IssueService issueService;
  @Autowired IssueAssigneeRepository assigneeRepository;
  @Autowired IssueAssigneeService assigneeService;
  @Autowired PersonalAssistantRepository personalAssistantRepository;
  @Autowired AiAgentCredentialService credentialService;

  @Autowired
  com.workplace.auth.repository.WorkspaceAssistantRepository workspaceAssistantRepository;

  @Autowired IssueRecurrenceService recurrenceService;
  @Autowired com.workplace.chat.repository.ChatThreadRepository chatThreadRepository;
  @Autowired com.workplace.chat.repository.ChatThreadMemberRepository chatThreadMemberRepository;
  @Autowired ApplicationEvents events;
  // 기반 클래스가 spy 로 둔 빈 — 한 행만 실패하게 만든다.
  @Autowired IssueRepository issueRepository;

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
            new CreateIssueRequest("매일 정리", "오늘 할 일을 정리해 줘", null, null, null, null, null, null));
    issueId = issue.id();
    number = issue.number();
    assigneeRepository.add(issueId, agent, owner);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ───────────────────────────── REST ─────────────────────────────

  @Test
  void 저장하면_반복과_AI작업_다음회차대기가_생긴다() throws Exception {
    JsonNode body =
        json(
            call(put(path()).content(req("FREQ=WEEKLY;BYDAY=MO,WE", "08:30")), owner)
                .andExpect(status().isOk()));
    assertThat(body.get("rrule").asText()).isEqualTo("FREQ=WEEKLY;BYDAY=MO,WE");
    assertThat(body.get("time").asText()).isEqualTo("08:30");
    assertThat(body.get("enabled").asBoolean()).isTrue();
    assertThat(body.get("consecutiveFailures").asInt()).isZero();
    assertThat(body.get("agentUserId").asLong()).isEqualTo(agent);
    assertThat(body.get("agentName").asText()).isNotBlank();
    // 다음 회차는 KST 월·수 08:30 이고 지금 이후다.
    Instant next = Instant.parse(body.get("nextRunAt").asText());
    var kst = next.atZone(IssueRecurrenceRules.KST);
    assertThat(next).isAfter(Instant.now());
    assertThat(kst.getDayOfWeek()).isIn(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY);
    assertThat(kst.getHour()).isEqualTo(8);
    assertThat(kst.getMinute()).isEqualTo(30);

    Record work = activeWork();
    assertThat(work.get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
    assertThat(work.get(AGENT_WORK.NOTE)).isEqualTo(IssueRecurrenceService.NOTE_SCHEDULED);
    assertThat(work.get(AGENT_WORK.TOOL)).isEqualTo("workplace");
    assertThat(work.get(AGENT_WORK.NEXT_RUN_AT).toInstant()).isEqualTo(next);

    JsonNode got = json(call(get(path()), owner).andExpect(status().isOk()));
    assertThat(got.get("rrule").asText()).isEqualTo("FREQ=WEEKLY;BYDAY=MO,WE");
  }

  @Test
  void 반복이_없으면_GET_204() throws Exception {
    call(get(path()), owner).andExpect(status().isNoContent());
  }

  @Test
  void 규칙과_시각_형식이_틀리면_400() throws Exception {
    List<String[]> bad =
        List.of(
            new String[] {"FREQ=HOURLY", "08:00"},
            new String[] {"FREQ=YEARLY", "08:00"},
            new String[] {"FREQ=DAILY;INTERVAL=2", "08:00"},
            new String[] {"FREQ=WEEKLY", "08:00"},
            new String[] {"FREQ=WEEKLY;BYDAY=XX", "08:00"},
            new String[] {"FREQ=MONTHLY", "08:00"},
            new String[] {"FREQ=MONTHLY;BYMONTHDAY=32", "08:00"},
            new String[] {"FREQ=DAILY;COUNT=3", "08:00"},
            new String[] {"FREQ=DAILY;BYDAY=MO", "08:00"},
            new String[] {"", "08:00"},
            new String[] {"FREQ=DAILY", "8:30"},
            new String[] {"FREQ=DAILY", "24:00"},
            new String[] {"FREQ=DAILY", null});
    for (String[] b : bad) {
      call(put(path()).content(req(b[0], b[1])), owner).andExpect(status().isBadRequest());
    }
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
  }

  @Test
  void 매일_매월_규칙은_받는다() throws Exception {
    call(put(path()).content(req("FREQ=DAILY", "07:00")), owner).andExpect(status().isOk());
    JsonNode monthly =
        json(
            call(put(path()).content(req("freq=monthly;bymonthday=15", "23:59")), owner)
                .andExpect(status().isOk()));
    assertThat(monthly.get("rrule").asText()).isEqualTo("FREQ=MONTHLY;BYMONTHDAY=15");
    var kst = Instant.parse(monthly.get("nextRunAt").asText()).atZone(IssueRecurrenceRules.KST);
    assertThat(kst.getDayOfMonth()).isEqualTo(15);
    assertThat(kst.getHour()).isEqualTo(23);
  }

  @Test
  void 비서가_멤버도_담당도_아니면_저장이_넣어준다() throws Exception {
    // 개인 작업 화면에는 AI 를 멤버로 넣는 길이 없다 — 비서가 멤버도 담당도 아닌 이슈.
    assigneeRepository.remove(issueId, agent);
    long projectId = projectId();
    projectMemberRepository.delete(projectId, agent);
    assertThat(projectMemberRepository.isDirectMember(projectId, agent)).isFalse();

    call(put(path()).content(req("FREQ=DAILY", "08:00")), owner).andExpect(status().isOk());

    assertThat(projectMemberRepository.isDirectMember(projectId, agent)).isTrue();
    assertThat(assigneeRepository.findUserIdsByIssue(issueId)).contains(agent);
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.AGENT_USER_ID)).isEqualTo(agent);
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
    // 담당 변경 이벤트는 내되(챗 멤버·배정 알림) AI 를 깨우지 않게 표시한다 — 반복 회차로만 일한다.
    var assigned =
        events.stream(com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent.class)
            .toList();
    assertThat(assigned).hasSize(1);
    assertThat(assigned.get(0).wakeAgent()).isFalse();
    assertThat(assigned.get(0).added()).extracting(u -> u.id()).containsExactly(agent);
  }

  @Test
  void 챗_스레드가_있는_작업에_반복을_저장하면_비서가_스레드_멤버가_된다() throws Exception {
    // 리뷰(PR #971): 깨우지 않는 담당 지정도 기존 이슈 챗 스레드에 비서를 넣는다(담당 변경 이벤트·워처 자동 등록 경로). 이벤트를 내는지는
    // 위 「비서가_멤버도_담당도_아니면」 테스트가 wakeAgent=false 로 고정한다 — 작성창 안내 갱신(membersChanged)·배정 알림이 그 이벤트를
    // 받는다.
    assigneeRepository.remove(issueId, agent);
    long threadId = chatThreadRepository.insertIfAbsent(issueId);
    chatThreadMemberRepository.insertIgnoreConflict(threadId, List.of(owner));
    assertThat(chatThreadMemberRepository.isMember(threadId, agent)).isFalse();

    call(put(path()).content(req("FREQ=DAILY", "08:00")), owner).andExpect(status().isOk());

    assertThat(chatThreadMemberRepository.isMember(threadId, agent)).isTrue();
  }

  @Test
  void 비서가_없으면_409() throws Exception {
    personalAssistantRepository.setAgentId(owner, null);
    workspaceAssistantRepository.deleteAssistant();
    call(put(path()).content(req("FREQ=DAILY", "08:00")), owner)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value(IssueRecurrenceService.NO_ASSISTANT));
  }

  @Test
  void 꺼진_반복도_다시_저장하면_켜지고_실패수가_0() throws Exception {
    call(put(path()).content(req("FREQ=DAILY", "08:00")), owner).andExpect(status().isOk());
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.ENABLED, false)
        .set(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES, 3)
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
    JsonNode body =
        json(
            call(put(path()).content(req("FREQ=DAILY", "09:00")), owner)
                .andExpect(status().isOk()));
    assertThat(body.get("enabled").asBoolean()).isTrue();
    assertThat(body.get("consecutiveFailures").asInt()).isZero();
    assertThat(body.get("time").asText()).isEqualTo("09:00");
  }

  @Test
  void 삭제하면_반복이_없어지고_AI작업은_취소() throws Exception {
    call(put(path()).content(req("FREQ=DAILY", "08:00")), owner).andExpect(status().isOk());
    call(delete(path()), owner).andExpect(status().isNoContent());
    call(get(path()), owner).andExpect(status().isNoContent());
    assertThat(activeWorkOrNull()).isNull();
    assertThat(lastWorkState()).isEqualTo("CANCELED");
    // 없는 반복을 지워도 204(멱등).
    call(delete(path()), owner).andExpect(status().isNoContent());
  }

  @Test
  void 다른_사람은_저장할_수_없다() throws Exception {
    long stranger = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, stranger, "USER");
    int s =
        call(put(path()).content(req("FREQ=DAILY", "08:00")), stranger)
            .andReturn()
            .getResponse()
            .getStatus();
    assertThat(s).isIn(403, 404);
  }

  // ───────────────────────────── 스케줄러 ─────────────────────────────

  @Test
  void 회차_시각이_되면_이벤트를_보내고_다음회차로_넘긴다() throws Exception {
    saveAndMakeDue();
    assertThat(recurrenceService.runDue(Instant.now().minusSeconds(3600))).isZero();

    Instant now = Instant.now();
    assertThat(recurrenceService.runDue(now)).isEqualTo(1);

    var sent = events.stream(IssueRecurringRunEvent.class).toList();
    assertThat(sent).hasSize(1);
    var e = sent.get(0);
    assertThat(e.actingAgentId()).isEqualTo(agent);
    // 도구는 등록한 사람(소유자) 권한으로 돈다.
    assertThat(e.ownerUserId()).isEqualTo(owner);
    assertThat(e.issueId()).isEqualTo(issueId);
    assertThat(e.issueKey()).isEqualTo(key + "-" + number);
    assertThat(e.round()).isEqualTo(1);
    assertThat(e.rrule()).isEqualTo("FREQ=DAILY");
    assertThat(e.time()).isEqualTo("08:00");
    assertThat(e.issueBody()).isEqualTo("오늘 할 일을 정리해 줘");
    assertThat(e.actor().id()).isEqualTo(owner);
    assertThat(e.runId()).isEqualTo(issueId + "-" + e.runAt().getEpochSecond());

    var row = recurrenceRow();
    assertThat(row.get(ISSUE_RECURRENCE.NEXT_RUN_AT).toInstant()).isAfter(now);
    assertThat(row.get(ISSUE_RECURRENCE.LAST_RUN_AT).toInstant())
        .isCloseTo(now, org.assertj.core.api.Assertions.within(1, ChronoUnit.SECONDS));
    assertThat(row.get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isEqualTo(e.runId());
    assertThat(row.get(ISSUE_RECURRENCE.RUN_COUNT)).isEqualTo(1);
    Record work = activeWork();
    assertThat(work.get(AGENT_WORK.STATE)).isEqualTo("WORKING");
    assertThat(work.get(AGENT_WORK.NOTE)).isEqualTo(IssueRecurrenceService.NOTE_RUNNING);

    // 같은 시각에 다시 돌려도 다음 회차가 미래라 보내지 않는다.
    assertThat(recurrenceService.runDue(now)).isZero();
  }

  @Test
  void 밀린_회차는_몰아서_돌리지_않는다() throws Exception {
    call(put(path()).content(req("FREQ=DAILY", "08:00")), owner).andExpect(status().isOk());
    setNextRunAt(Instant.now().minus(10, ChronoUnit.DAYS));
    Instant now = Instant.now();
    assertThat(recurrenceService.runDue(now)).isEqualTo(1);
    // 다음 회차는 지금 이후 하루 안 — 밀린 날짜들을 하나씩 밟지 않는다.
    Instant next = recurrenceRow().get(ISSUE_RECURRENCE.NEXT_RUN_AT).toInstant();
    assertThat(next).isAfter(now).isBefore(now.plus(1, ChronoUnit.DAYS).plusSeconds(1));
    assertThat(recurrenceService.runDue(now)).isZero();
  }

  @Test
  void 한_행이_실패해도_다른_행은_돈다() throws Exception {
    // 두 번째 반복 이슈 — 같은 소유자·비서.
    long other =
        issueService
            .create(
                owner,
                key,
                new CreateIssueRequest("주간 정리", "이번 주 정리", null, null, null, null, null, null))
            .id();
    assigneeRepository.add(other, agent, owner);
    int otherNumber =
        dsl.select(com.workplace.jooq.Tables.ISSUE.NUMBER)
            .from(com.workplace.jooq.Tables.ISSUE)
            .where(com.workplace.jooq.Tables.ISSUE.ID.eq(other))
            .fetchOne(com.workplace.jooq.Tables.ISSUE.NUMBER);
    call(
            put("/api/v1/projects/" + key + "/issues/" + otherNumber + "/recurrence")
                .content(req("FREQ=DAILY", "08:00")),
            owner)
        .andExpect(status().isOk());
    saveAndMakeDue();
    Instant past = Instant.now().minusSeconds(60);
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.NEXT_RUN_AT, past.atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(other))
        .execute();
    // 첫 이슈의 회차 처리 중 예외 — 그 행만 되돌리고 다른 행은 보낸다.
    org.mockito.Mockito.doThrow(new IllegalStateException("boom"))
        .when(issueRepository)
        .findById(issueId);

    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    var sent = events.stream(IssueRecurringRunEvent.class).toList();
    assertThat(sent).extracting(IssueRecurringRunEvent::issueId).containsExactly(other);
    // 실패한 행은 그대로(다음 폴링에 다시 시도), 성공한 행은 다음 회차로 넘어갔다.
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.RUN_COUNT)).isZero();
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.NEXT_RUN_AT).toInstant())
        .isBefore(Instant.now());
    assertThat(
            dsl.select(ISSUE_RECURRENCE.RUN_COUNT)
                .from(ISSUE_RECURRENCE)
                .where(ISSUE_RECURRENCE.ISSUE_ID.eq(other))
                .fetchOne(ISSUE_RECURRENCE.RUN_COUNT))
        .isEqualTo(1);
  }

  @Test
  void 이슈가_끝났으면_회차를_건너뛰고_반복을_지운다() throws Exception {
    saveAndMakeDue();
    issueService.updateStatus(owner, key, number, "DONE");
    assertThat(recurrenceService.runDue(Instant.now())).isZero();
    assertThat(events.stream(IssueRecurringRunEvent.class)).isEmpty();
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
    assertThat(activeWorkOrNull()).isNull();
  }

  @Test
  void 담당에서_비서가_빠졌으면_회차를_건너뛰고_반복을_지운다() throws Exception {
    saveAndMakeDue();
    assigneeRepository.remove(issueId, agent);
    assertThat(recurrenceService.runDue(Instant.now())).isZero();
    assertThat(events.stream(IssueRecurringRunEvent.class)).isEmpty();
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
    assertThat(activeWorkOrNull()).isNull();
    assertThat(lastWorkState()).isEqualTo("CANCELED");
  }

  // WP-1114 — 이슈를 끝내거나 담당에서 AI 를 빼면 회차 시각을 기다리지 않고 그 자리에서 반복을 거둔다(상세에 「다음 실행 …」이 남지 않게).

  @Test
  void 작업을_완료하면_그_자리에서_반복이_지워진다() throws Exception {
    call(put(path()).content(req("FREQ=DAILY", "09:00")), owner).andExpect(status().isOk());
    issueService.updateStatus(owner, key, number, "DONE");
    // 스케줄러를 돌리지 않아도 반복이 없다.
    call(get(path()), owner).andExpect(status().isNoContent());
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
    assertThat(activeWorkOrNull()).isNull();
  }

  @Test
  void 작업을_취소하면_그_자리에서_반복이_지워진다() throws Exception {
    call(put(path()).content(req("FREQ=MONTHLY;BYMONTHDAY=5,31", "08:30")), owner)
        .andExpect(status().isOk());
    issueService.updateStatus(owner, key, number, "CANCELED");
    call(get(path()), owner).andExpect(status().isNoContent());
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
  }

  @Test
  void 작업을_지우면_그_자리에서_반복이_지워진다() throws Exception {
    call(put(path()).content(req("FREQ=DAILY", "09:00")), owner).andExpect(status().isOk());
    issueService.softDelete(owner, key, number);
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
    assertThat(activeWorkOrNull()).isNull();
  }

  @Test
  void 비서를_프로젝트_멤버에서_빼면_그_자리에서_반복이_지워진다() throws Exception {
    // 멤버 제거는 담당 변경 서비스를 거치지 않고 담당·작업 기록을 직접 정리한다(ProjectMemberDeparture) — 그 경로도 반복을 거둔다.
    call(put(path()).content(req("FREQ=DAILY", "09:00")), owner).andExpect(status().isOk());
    projectService.removeMember(owner, key, agent);
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
    assertThat(lastWorkState()).isEqualTo("CANCELED");
  }

  @Test
  void 담당에서_비서를_빼면_그_자리에서_반복이_지워진다() throws Exception {
    call(put(path()).content(req("FREQ=DAILY", "09:00")), owner).andExpect(status().isOk());
    assigneeService.replace(owner, key, number, List.of(owner));
    call(get(path()), owner).andExpect(status().isNoContent());
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
    assertThat(lastWorkState()).isEqualTo("CANCELED");
  }

  @Test
  void 비서가_아닌_담당자를_빼면_반복은_그대로다() throws Exception {
    assigneeService.replace(owner, key, number, List.of(owner, agent));
    call(put(path()).content(req("FREQ=DAILY", "09:00")), owner).andExpect(status().isOk());
    assigneeService.replace(owner, key, number, List.of(agent));
    call(get(path()), owner)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.enabled").value(true));
    assertThat(activeWork()).isNotNull();
  }

  // WP-1190 — 개인 비서를 해제하면 그 비서가 돌리던 반복을 그 자리에서 거둔다(상세 「다음 실행 …」·AI 위임 작업 「다음 회차 대기」가 남지 않게).

  @Test
  void 비서를_해제하면_그_자리에서_반복이_지워지고_다음회차대기는_취소된다() throws Exception {
    call(put(path()).content(req("FREQ=DAILY", "09:00")), owner).andExpect(status().isOk());
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");

    call(delete("/api/v1/users/me/assistant"), owner).andExpect(status().is2xxSuccessful());

    call(get(path()), owner).andExpect(status().isNoContent());
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
    assertThat(activeWorkOrNull()).isNull();
    assertThat(lastWorkState()).isEqualTo("CANCELED");
    // 담당은 그대로 — 같은 비서를 다시 등록하면 그 AGENT 를 다시 쓴다.
    assertThat(assigneeRepository.findUserIdsByIssue(issueId)).contains(agent);
  }

  @Test
  void 회차_실행_중에_비서를_해제하면_묘비로_남기고_그_회차_결과는_받는다() throws Exception {
    String runId = dispatchOnce();
    call(delete("/api/v1/users/me/assistant"), owner).andExpect(status().is2xxSuccessful());
    call(get(path()), owner).andExpect(status().isNoContent());
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.DELETED)).isTrue();
    // 일하던 회차 작업은 다음 회차 대기가 아니라 그대로 둔다 — 결과가 오면 남긴다.
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("WORKING");

    report(agent, runId, true, "해제 전 결과").andExpect(status().isNoContent());
    assertThat(agentMessages()).containsExactly("해제 전 결과");
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
  }

  @Test
  void 회차_실행_중에_완료하면_묘비로_남기고_그_회차_결과는_받는다() throws Exception {
    String runId = dispatchOnce();
    issueService.updateStatus(owner, key, number, "DONE");
    // 묘비 — 조회·스케줄러에서는 없는 반복이다.
    call(get(path()), owner).andExpect(status().isNoContent());
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.DELETED)).isTrue();
    setNextRunAt(Instant.now().minusSeconds(30));
    assertThat(recurrenceService.runDue(Instant.now())).isZero();

    report(agent, runId, true, "완료 전 결과").andExpect(status().isNoContent());
    assertThat(agentMessages()).containsExactly("완료 전 결과");
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
  }

  @Test
  void 회차_실행_중에_스케줄러가_담당_해제를_발견해도_묘비로_남기고_그_회차_결과는_받는다() throws Exception {
    // WP-1116 — 닫기·담당 해제 서비스를 거치지 않고 어긋난 행(담당 행만 직접 빠짐)은 스케줄러의 안전망이 거둔다. 그때도 도는 회차의 결과는 받는다.
    String runId = dispatchOnce();
    assigneeRepository.remove(issueId, agent);
    setNextRunAt(Instant.now().minusSeconds(30));
    assertThat(recurrenceService.runDue(Instant.now())).isZero();
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.DELETED)).isTrue();
    call(get(path()), owner).andExpect(status().isNoContent());
    assertThat(lastWorkState()).isEqualTo("CANCELED");

    report(agent, runId, true, "해제 전 결과").andExpect(status().isNoContent());
    assertThat(agentMessages()).containsExactly("해제 전 결과");
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
  }

  @Test
  void 회차_실행_중에_스케줄러가_지워진_작업을_발견해도_묘비로_남기고_결과가_안_오면_정리가_지운다() throws Exception {
    // 서비스의 retire 를 거치지 않고 지워진 행(삭제 표시만 바뀜) — 스케줄러가 묘비로 남기고, 결과가 끝내 안 오면 대기 시간 초과 정리가 지운다.
    dispatchOnce();
    dsl.update(com.workplace.jooq.Tables.ISSUE)
        .set(com.workplace.jooq.Tables.ISSUE.DELETED_AT, java.time.OffsetDateTime.now())
        .where(com.workplace.jooq.Tables.ISSUE.ID.eq(issueId))
        .execute();
    setNextRunAt(Instant.now().minusSeconds(30));
    assertThat(recurrenceService.runDue(Instant.now())).isZero();
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.DELETED)).isTrue();

    recurrenceService.runDue(
        Instant.now().plus(IssueRecurrenceService.PENDING_TIMEOUT).plusSeconds(60));
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
    assertThat(agentMessages()).isEmpty();
  }

  // ───────────────────────────── 결과 보고 ─────────────────────────────

  @Test
  void 성공_보고는_AI_이름으로_챗에_남고_다음회차대기로() throws Exception {
    String runId = dispatchOnce();
    report(agent, runId, true, "## 오늘 정리\n- 할 일 3건").andExpect(status().isNoContent());

    assertThat(agentMessages()).containsExactly("## 오늘 정리\n- 할 일 3건");
    var row = recurrenceRow();
    assertThat(row.get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isNull();
    assertThat(row.get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isZero();
    Record work = activeWork();
    assertThat(work.get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
    assertThat(work.get(AGENT_WORK.NOTE)).isEqualTo(IssueRecurrenceService.NOTE_SCHEDULED);
    assertThat(work.get(AGENT_WORK.NEXT_RUN_AT)).isEqualTo(row.get(ISSUE_RECURRENCE.NEXT_RUN_AT));

    // 같은 runId 를 다시 보내면 무시한다 — 글이 두 번 남지 않는다.
    report(agent, runId, true, "## 오늘 정리\n- 할 일 3건").andExpect(status().isNoContent());
    assertThat(agentMessages()).hasSize(1);
  }

  // WP-1311: 본문이 확인을 받으라고 해 쓰기를 멈춘 회차 — 결과 글을 답변 필요 질문으로 남기고, 다음 회차는 그대로 잡혀 있다.
  @Test
  void 질문_보고는_답변필요_질문으로_남고_다음회차대기는_그대로() throws Exception {
    String runId = dispatchOnce();
    report(agent, runId, true, "주간 보고 메일을 보낼까요?", true).andExpect(status().isNoContent());

    assertThat(agentMessages()).containsExactly("주간 보고 메일을 보낼까요?");
    assertThat(agentQuestionFlags()).containsExactly(true);
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.ENABLED)).isTrue();

    // 질문 표시가 없는 보고(WP-1311 전 모양)는 질문이 아니다. 실패 보고는 question 을 보내도 질문이 아니다(사유 글).
    report(agent, dispatchOnce(), true, "그냥 결과").andExpect(status().isNoContent());
    report(agent, dispatchOnce(), false, "도구 오류", true).andExpect(status().isNoContent());
    assertThat(agentQuestionFlags()).containsExactly(true, false, false);
  }

  @Test
  void 실패_보고는_사유를_남기고_3회_연속이면_반복을_멈춘다() throws Exception {
    for (int i = 1; i <= 3; i++) {
      String runId = dispatchOnce();
      report(agent, runId, false, "도구 오류 " + i).andExpect(status().isNoContent());
      var row = recurrenceRow();
      assertThat(row.get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isEqualTo(i);
      if (i < 3) {
        assertThat(row.get(ISSUE_RECURRENCE.ENABLED)).isTrue();
        assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
      }
    }
    var row = recurrenceRow();
    assertThat(row.get(ISSUE_RECURRENCE.ENABLED)).isFalse();
    // 멈춘 순간 AI 작업 알림 경로로 「막힘」 알림을 한 번 낸다(앞의 두 실패는 알리지 않는다).
    var notices = events.stream(AgentWorkNoticeEvent.class).toList();
    assertThat(notices).hasSize(1);
    assertThat(notices.get(0).state()).isEqualTo("BLOCKED");
    assertThat(notices.get(0).workerId()).isEqualTo(agent);
    assertThat(notices.get(0).issueId()).isEqualTo(issueId);
    Record work = activeWork();
    assertThat(work.get(AGENT_WORK.STATE)).isEqualTo("BLOCKED");
    assertThat(work.get(AGENT_WORK.NOTE)).isEqualTo(IssueRecurrenceService.NOTE_STOPPED);
    assertThat(agentMessages())
        .containsExactly(
            IssueRecurrenceService.FAILED_PREFIX + "도구 오류 1",
            IssueRecurrenceService.FAILED_PREFIX + "도구 오류 2",
            IssueRecurrenceService.FAILED_PREFIX + "도구 오류 3",
            IssueRecurrenceService.STOPPED_NOTICE);
    // 꺼진 반복은 시각이 지나도 돌지 않는다.
    setNextRunAt(Instant.now().minusSeconds(60));
    assertThat(recurrenceService.runDue(Instant.now())).isZero();
  }

  @Test
  void 성공하면_연속_실패수가_0으로() throws Exception {
    report(agent, dispatchOnce(), false, "x").andExpect(status().isNoContent());
    report(agent, dispatchOnce(), true, "ok").andExpect(status().isNoContent());
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isZero();
  }

  @Test
  void 다른_AI나_사람은_결과를_보고할_수_없다() throws Exception {
    String runId = dispatchOnce();
    long otherAgent = withMembership(TestFixtures.createAgentNoToken(dsl));
    report(otherAgent, runId, true, "가짜").andExpect(status().isForbidden());
    // 사람 JWT 로는 내부 엔드포인트를 쓸 수 없다.
    call(
            post("/api/v1/internal/issue-recurrence/" + issueId + "/runs")
                .content(om.writeValueAsString(Map.of("runId", runId, "ok", true, "message", "x"))),
            owner)
        .andExpect(status().isForbidden());
    assertThat(agentMessages()).isEmpty();
  }

  @Test
  void 지난_회차나_예전_AI의_보고는_조용히_무시한다() throws Exception {
    String runId = dispatchOnce();
    long otherAgent = withMembership(TestFixtures.createAgentNoToken(dsl));
    // 대기 중이 아닌 회차 — 보고자가 누구든 204 로 무시한다(403 아님).
    report(otherAgent, issueId + "-1", true, "지난 회차").andExpect(status().isNoContent());
    report(agent, issueId + "-1", true, "지난 회차").andExpect(status().isNoContent());
    assertThat(agentMessages()).isEmpty();
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isEqualTo(runId);
  }

  @Test
  void AI가_아닌_사용자는_내부_토큰으로도_보고할_수_없다() throws Exception {
    String runId = dispatchOnce();
    report(owner, runId, true, "사람").andExpect(status().isForbidden());
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isEqualTo(runId);
  }

  @Test
  void 결과를_못_받은_회차는_대기가_지나면_실패로_세고_3회면_멈춘다() throws Exception {
    dispatchOnce();
    // 결과 없이 대기 시간이 지난 뒤의 회차 — 정리가 지난 회차를 실패로 세고 이번 회차를 보낸다.
    setLastRunAt(Instant.now().minus(31, ChronoUnit.MINUTES));
    dispatchOnce();
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isEqualTo(1);
    setLastRunAt(Instant.now().minus(31, ChronoUnit.MINUTES));
    dispatchOnce();
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isEqualTo(2);
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("WORKING");

    // 세 번째 결과도 없이 다음 회차 — 3회 연속 실패로 멈추고 이번 회차는 보내지 않는다.
    setLastRunAt(Instant.now().minus(31, ChronoUnit.MINUTES));
    setNextRunAt(Instant.now().minusSeconds(30));
    assertThat(recurrenceService.runDue(Instant.now())).isZero();
    assertThat(events.stream(IssueRecurringRunEvent.class)).hasSize(3);
    var row = recurrenceRow();
    assertThat(row.get(ISSUE_RECURRENCE.ENABLED)).isFalse();
    assertThat(row.get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isNull();
    assertThat(row.get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isEqualTo(3);
    assertThat(agentMessages())
        .containsExactly(
            IssueRecurrenceService.LOST_RUN,
            IssueRecurrenceService.LOST_RUN,
            IssueRecurrenceService.LOST_RUN,
            IssueRecurrenceService.STOPPED_NOTICE);
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("BLOCKED");
    assertThat(events.stream(AgentWorkNoticeEvent.class)).hasSize(1);
  }

  @Test
  void 지난_회차_결과를_기다리는_중에_새_회차가_되면_실패로_세지_않고_미룬다() throws Exception {
    // 리뷰(PR #971): 09:00 회차를 보낸 뒤 09:03 에 09:05 로 당겨 저장 — 살아 있는 회차를 잃어버린 회차로 세지 않는다.
    String runId = dispatchOnce();
    call(put(path()).content(req("FREQ=DAILY", "07:30")), owner).andExpect(status().isOk());
    setNextRunAt(Instant.now().minusSeconds(10));

    assertThat(recurrenceService.runDue(Instant.now())).isZero();
    var row = recurrenceRow();
    assertThat(row.get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isEqualTo(runId);
    assertThat(row.get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isZero();
    assertThat(agentMessages()).isEmpty();
    assertThat(events.stream(IssueRecurringRunEvent.class)).hasSize(1);

    // 늦게 온 진짜 결과는 받고, 그 뒤의 확인에서 미룬 회차를 보낸다.
    report(agent, runId, true, "결과").andExpect(status().isNoContent());
    assertThat(agentMessages()).containsExactly("결과");
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
  }

  @Test
  void 결과를_30분_넘게_못_받으면_실패로_세고_다음회차대기로_되돌린다() throws Exception {
    String runId = dispatchOnce();
    setLastRunAt(Instant.now().minus(31, ChronoUnit.MINUTES));
    // 다음 회차는 미래라 보내지는 않고 대기만 정리한다.
    assertThat(recurrenceService.runDue(Instant.now())).isZero();
    var row = recurrenceRow();
    assertThat(row.get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isNull();
    assertThat(row.get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isEqualTo(1);
    assertThat(row.get(ISSUE_RECURRENCE.ENABLED)).isTrue();
    assertThat(agentMessages()).containsExactly(IssueRecurrenceService.LOST_RUN);
    Record work = activeWork();
    assertThat(work.get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
    assertThat(work.get(AGENT_WORK.NEXT_RUN_AT)).isEqualTo(row.get(ISSUE_RECURRENCE.NEXT_RUN_AT));
    // 늦게 온 결과는 무시한다.
    report(agent, runId, true, "늦은 결과").andExpect(status().isNoContent());
    assertThat(agentMessages()).hasSize(1);
  }

  @Test
  void 회차_실행_중에_다시_저장해도_작업중을_유지한다() throws Exception {
    String runId = dispatchOnce();
    call(put(path()).content(req("FREQ=DAILY", "07:30")), owner).andExpect(status().isOk());
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("WORKING");
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isEqualTo(runId);
    report(agent, runId, true, "결과").andExpect(status().isNoContent());
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
  }

  @Test
  void 실행_AI가_바뀌면_예전_AI의_진행중_회차는_받지_않는다() throws Exception {
    String runId = dispatchOnce();
    long agent2 = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, owner));
    personalAssistantRepository.setAgentId(owner, agent2);
    projectMemberRepository.insert(projectId(), agent2, "MEMBER");
    assigneeRepository.add(issueId, agent2, owner);
    call(put(path()).content(req("FREQ=DAILY", "08:00")), owner).andExpect(status().isOk());

    var row = recurrenceRow();
    assertThat(row.get(ISSUE_RECURRENCE.AGENT_USER_ID)).isEqualTo(agent2);
    assertThat(row.get(ISSUE_RECURRENCE.PENDING_RUN_ID)).isNull();
    assertThat(activeWorkOrNull()).isNull();
    report(agent, runId, true, "예전 AI 결과").andExpect(status().isNoContent());
    assertThat(agentMessages()).isEmpty();
  }

  @Test
  void 비서가_바뀌면_반복이_넣었던_예전_비서는_담당에서_빠진다() throws Exception {
    // WP-1119: 반복 저장이 넣은 비서 A → 개인 비서를 B 로 바꿔 다시 저장하면 A 는 빠지고 B 만 담당이다.
    assigneeRepository.remove(issueId, agent);
    call(put(path()).content(req("FREQ=DAILY", "08:00")), owner).andExpect(status().isOk());
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.ASSISTANT_ENROLLED)).isTrue();
    // 같은 비서로 다시 저장해도(이미 담당이라 이번엔 넣지 않음) 이 반복이 넣은 담당이라는 기록은 남는다.
    call(put(path()).content(req("FREQ=DAILY", "09:00")), owner).andExpect(status().isOk());
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.ASSISTANT_ENROLLED)).isTrue();
    // 이미 몇 회차 돈 반복 — 비서를 바꿔도 회차 수·지난 실행 시각이 이어져야 한다.
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.RUN_COUNT, 5)
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
    setLastRunAt(Instant.now().minusSeconds(3600));

    long agent2 = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, owner));
    personalAssistantRepository.setAgentId(owner, agent2);
    call(put(path()).content(req("FREQ=DAILY", "09:00")), owner).andExpect(status().isOk());

    assertThat(assigneeRepository.findUserIdsByIssue(issueId)).containsExactly(agent2);
    var row = recurrenceRow();
    assertThat(row.get(ISSUE_RECURRENCE.AGENT_USER_ID)).isEqualTo(agent2);
    assertThat(row.get(ISSUE_RECURRENCE.ASSISTANT_ENROLLED)).isTrue();
    // 예전 비서를 담당에서 빼도(담당 해제가 그 AI 의 반복을 거둔다) 이 반복은 지워지지 않고 이어진다.
    assertThat(row.get(ISSUE_RECURRENCE.DELETED)).isFalse();
    assertThat(row.get(ISSUE_RECURRENCE.RUN_COUNT)).isEqualTo(5);
    assertThat(row.get(ISSUE_RECURRENCE.LAST_RUN_AT)).isNotNull();
    assertThat(activeWorkOrNull()).as("예전 비서의 작업 기록은 끝난다").isNull();
    assertThat(activeWorkOrNull(agent2).get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
    // 프로젝트 멤버에서는 빼지 않는다 — 같은 개인 프로젝트의 다른 반복이 쓰고 있을 수 있다.
    assertThat(projectMemberRepository.isDirectMember(projectId(), agent)).isTrue();
    // 빼고 넣기를 한 번의 담당 교체로 한다 — 이력·이벤트가 한 번.
    var last =
        events.stream(com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent.class)
            .reduce((a, b) -> b)
            .orElseThrow();
    assertThat(last.added()).extracting(u -> u.id()).containsExactly(agent2);
    assertThat(last.removed()).extracting(u -> u.id()).containsExactly(agent);
  }

  @Test
  void 사람이_먼저_넣은_비서는_비서가_바뀌어도_담당에_남는다() throws Exception {
    // 시드는 반복을 저장하기 전에 사람이 agent 를 담당으로 넣어 두었다 — 반복이 넣은 담당이 아니다.
    call(put(path()).content(req("FREQ=DAILY", "08:00")), owner).andExpect(status().isOk());
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.ASSISTANT_ENROLLED)).isFalse();

    long agent2 = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, owner));
    personalAssistantRepository.setAgentId(owner, agent2);
    call(put(path()).content(req("FREQ=DAILY", "08:00")), owner).andExpect(status().isOk());

    assertThat(assigneeRepository.findUserIdsByIssue(issueId))
        .containsExactlyInAnyOrder(agent, agent2);
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.ASSISTANT_ENROLLED)).isTrue();
  }

  @Test
  void 회차_실행_중에_지우면_결과는_남기고_그때_행을_지운다() throws Exception {
    String runId = dispatchOnce();
    call(delete(path()), owner).andExpect(status().isNoContent());
    // 묘비 — 조회·스케줄러에서는 없는 반복이다.
    call(get(path()), owner).andExpect(status().isNoContent());
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.DELETED)).isTrue();
    assertThat(lastWorkState()).isEqualTo("CANCELED");
    setNextRunAt(Instant.now().minusSeconds(30));
    assertThat(recurrenceService.runDue(Instant.now())).isZero();

    report(agent, runId, true, "마지막 결과").andExpect(status().isNoContent());
    assertThat(agentMessages()).containsExactly("마지막 결과");
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
    assertThat(activeWorkOrNull()).isNull();
  }

  @Test
  void 지운_반복의_결과가_끝내_오지_않으면_정리가_행을_지운다() throws Exception {
    dispatchOnce();
    call(delete(path()), owner).andExpect(status().isNoContent());
    setLastRunAt(Instant.now().minus(31, ChronoUnit.MINUTES));
    recurrenceService.runDue(Instant.now());
    assertThat(dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))).isZero();
    assertThat(agentMessages()).isEmpty();
  }

  @Test
  void 다음_회차를_정할_수_없으면_저장은_400_실행은_반복을_멈춘다() throws Exception {
    saveAndMakeDue();
    IssueRecurrenceService target = AopTestUtils.getTargetObject(recurrenceService);
    IssueRecurrenceRules original =
        (IssueRecurrenceRules) ReflectionTestUtils.getField(target, "rules");
    IssueRecurrenceRules noNext = Mockito.spy(original);
    Mockito.doReturn(null).when(noNext).nextRunAfter(Mockito.any(), Mockito.any(), Mockito.any());
    ReflectionTestUtils.setField(target, "rules", noNext);
    try {
      assertThat(recurrenceService.runDue(Instant.now())).isZero();
      assertThat(events.stream(IssueRecurringRunEvent.class)).isEmpty();
      var row = recurrenceRow();
      assertThat(row.get(ISSUE_RECURRENCE.ENABLED)).isFalse();
      assertThat(row.get(ISSUE_RECURRENCE.NEXT_RUN_AT)).isNotNull();
      assertThat(agentMessages()).containsExactly(IssueRecurrenceService.NO_NEXT_NOTICE);
      Record work = activeWork();
      assertThat(work.get(AGENT_WORK.STATE)).isEqualTo("BLOCKED");
      assertThat(work.get(AGENT_WORK.NOTE)).isEqualTo(IssueRecurrenceService.NOTE_NO_NEXT);
      assertThat(events.stream(AgentWorkNoticeEvent.class)).hasSize(1);

      // 저장도 받지 않는다(켜진 반복에 다음 회차 없음 금지). 테스트 트랜잭션을 롤백 전용으로 만들므로 마지막에 둔다.
      call(put(path()).content(req("FREQ=DAILY", "09:00")), owner)
          .andExpect(status().isBadRequest());
    } finally {
      ReflectionTestUtils.setField(target, "rules", original);
    }
  }

  // ───────────────────────────── AI 위임 작업 목록 ─────────────────────────────

  @Test
  void AI위임작업_목록_행에_반복요약이_실린다() throws Exception {
    call(put(path()).content(req("FREQ=WEEKLY;BYDAY=FR", "18:00")), owner)
        .andExpect(status().isOk());
    JsonNode list = json(call(get("/api/v1/me/ai-tasks"), owner).andExpect(status().isOk()));
    JsonNode item = null;
    for (JsonNode it : list.get("items")) {
      if (it.get("id").asLong() == issueId) item = it;
    }
    assertThat(item).isNotNull();
    assertThat(item.get("recurrence").get("rrule").asText()).isEqualTo("FREQ=WEEKLY;BYDAY=FR");
    assertThat(item.get("recurrence").get("time").asText()).isEqualTo("18:00");
    assertThat(item.get("recurrence").get("enabled").asBoolean()).isTrue();
  }

  // ───────────────────────────── 질문에 답하면 이어 처리(WP-1312) ─────────────────────────────

  @Test
  void 질문에_소유자가_멘션없이_답하면_같은_AI가_소유자_권한으로_이어_처리한다() throws Exception {
    askQuestion("초안을 채널에 올릴까요?");
    Long questionId = recurrenceRow().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID);
    assertThat(questionId).isNotNull();
    Instant nextBefore = recurrenceRow().get(ISSUE_RECURRENCE.NEXT_RUN_AT).toInstant();

    long answerId = chat(owner, "올려 줘");

    var followUps = followUpEvents();
    assertThat(followUps).hasSize(1);
    var e = followUps.get(0);
    // 회차와 같은 신원·권한 — 실행 AI 는 반복의 비서, 도구는 소유자 권한.
    assertThat(e.actingAgentId()).isEqualTo(agent);
    assertThat(e.ownerUserId()).isEqualTo(owner);
    assertThat(e.issueId()).isEqualTo(issueId);
    assertThat(e.runId()).isEqualTo(issueId + "-f" + answerId);
    assertThat(e.followUp().question()).isEqualTo("초안을 채널에 올릴까요?");
    assertThat(e.followUp().answer()).isEqualTo("올려 줘");
    // 답한 사람은 이벤트 actor(소유자)다. 이어 처리는 회차 번호를 싣지 않는다.
    assertThat(e.actor().id()).isEqualTo(owner);
    assertThat(e.round()).isNull();
    var row = recurrenceRow();
    assertThat(row.get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNull();
    assertThat(row.get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID)).isEqualTo(e.runId());
    Record work = activeWork();
    assertThat(work.get(AGENT_WORK.STATE)).isEqualTo("WORKING");
    assertThat(work.get(AGENT_WORK.NOTE)).isEqualTo(IssueRecurrenceService.NOTE_FOLLOW_UP);
    // 답 글의 챗 이벤트는 이어 처리로 깨운 AI 를 실어, 멘션이 함께 있어도 일반 챗 응답을 또 깨우지 않게 한다.
    assertThat(answerEvent(answerId).followUpAgentId()).isEqualTo(agent);

    // 이어 처리 결과 — 글로 남기고, 연속 실패 수·다음 회차는 그대로, 작업은 「다음 회차 대기」로 돌아간다.
    report(agent, e.runId(), true, "채널에 올렸습니다").andExpect(status().isNoContent());
    assertThat(agentMessages()).containsExactly("초안을 채널에 올릴까요?", "채널에 올렸습니다");
    row = recurrenceRow();
    assertThat(row.get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID)).isNull();
    assertThat(row.get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isZero();
    assertThat(row.get(ISSUE_RECURRENCE.NEXT_RUN_AT).toInstant()).isEqualTo(nextBefore);
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
    // 같은 결과를 다시 보내도 한 번만 반영한다.
    report(agent, e.runId(), true, "채널에 올렸습니다").andExpect(status().isNoContent());
    assertThat(agentMessages()).hasSize(2);
  }

  @Test
  void 남은_질문이_없으면_멘션없는_사람_글은_AI를_깨우지_않는다() throws Exception {
    report(agent, dispatchOnce(), true, "오늘 정리").andExpect(status().isNoContent());
    long id = chat(owner, "고마워");
    assertThat(followUpEvents()).isEmpty();
    assertThat(answerEvent(id).followUpAgentId()).isNull();
  }

  @Test
  void 소유자가_아닌_사람의_답은_이어_처리하지_않는다() throws Exception {
    askQuestion("메일을 보낼까요?");
    long other = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, other, "USER");
    projectMemberRepository.insert(projectId(), other, "MEMBER");

    chat(other, "보내 줘");

    assertThat(followUpEvents()).isEmpty();
    // 소유자의 답은 아직 받을 수 있다.
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNotNull();
    chat(owner, "보내 줘");
    assertThat(followUpEvents()).hasSize(1);
  }

  @Test
  void 칠일이_지난_질문에_답해도_이어_처리하지_않는다() throws Exception {
    askQuestion("메일을 보낼까요?");
    dsl.update(ISSUE_RECURRENCE)
        .set(
            ISSUE_RECURRENCE.PENDING_QUESTION_ASKED_AT,
            Instant.now().minus(8, ChronoUnit.DAYS).atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();

    chat(owner, "보내 줘");

    assertThat(followUpEvents()).isEmpty();
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNull();
  }

  @Test
  void 답을_두_번_해도_이어_처리는_한_번이다() throws Exception {
    askQuestion("메일을 보낼까요?");
    chat(owner, "보내 줘");
    long second = chat(owner, "아 그리고 제목도 바꿔 줘");
    assertThat(followUpEvents()).hasSize(1);
    assertThat(answerEvent(second).followUpAgentId()).isNull();
  }

  @Test
  void 멘션과_함께_답해도_이어_처리로만_깨운다() throws Exception {
    askQuestion("메일을 보낼까요?");
    long id = chat(owner, "<@" + agent + "> 보내 줘");
    assertThat(followUpEvents()).hasSize(1);
    // 챗 이벤트가 그 AI 를 이어 처리로 깨웠다고 실어 — ChatEventDispatcher 가 같은 AI 의 챗 응답을
    // 건너뛴다(ChatEventDispatcherTest).
    var created = answerEvent(id);
    assertThat(created.mentions()).extracting(m -> m.id()).contains(agent);
    assertThat(created.followUpAgentId()).isEqualTo(agent);
  }

  @Test
  void 이어_처리가_다시_물으면_새_질문으로_남아_또_답할_수_있다() throws Exception {
    askQuestion("메일을 보낼까요?");
    chat(owner, "보내 줘");
    String followRunId = recurrenceRow().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID);
    report(agent, followRunId, true, "받는 사람을 누구로 할까요?", true).andExpect(status().isNoContent());

    assertThat(agentQuestionFlags()).containsExactly(true, true);
    var row = recurrenceRow();
    assertThat(row.get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNotNull();
    assertThat(row.get(ISSUE_RECURRENCE.PENDING_QUESTION_TEXT)).isEqualTo("받는 사람을 누구로 할까요?");

    chat(owner, "팀장님께");
    var followUps = followUpEvents();
    assertThat(followUps).hasSize(2);
    assertThat(followUps.get(1).followUp().question()).isEqualTo("받는 사람을 누구로 할까요?");
    assertThat(followUps.get(1).followUp().answer()).isEqualTo("팀장님께");
  }

  // WP-1376: 회차 결과 맨 끝 「정해 주세요」 절 — ai-agent 가 절에 항목이 있으면 결과 전체를 question 으로 보고하고, 서버는 그 표시만 따라
  // `[확인 필요]` 질문과 같은 경로(답을 기다리는 질문·소유자 첫 글 → 이어 처리)로 처리한다. 서버는 본문을 다시 판별하지 않는다(판별 규칙은
  // ai-agent decision-section.ts 의 hasDecisionSection 한 곳). 이어 처리가 다시 물으면 다시 등록되고, 「하지 마」로 절 없이 끝나면
  // 질문이 닫힌다.
  @Test
  void 정해_주세요_절로_끝난_결과도_질문으로_남고_답하면_이어_처리하며_절_없이_끝나면_닫힌다() throws Exception {
    String result = "## 오늘 정리\n- 견적 메일 2건\n\n## 정해 주세요\n1. A사 견적 메일에 회신할까요? (회신 / 보류)";
    report(agent, dispatchOnce(), true, result, true).andExpect(status().isNoContent());
    assertThat(agentQuestionFlags()).containsExactly(true);
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.PENDING_QUESTION_TEXT)).isEqualTo(result);

    // 소유자의 첫 글이 답 — 이어 처리에 결과 전체(정할 항목 포함)를 질문으로, 글을 답으로 넘긴다. 이어 처리를 받은 AI 는 챗 이벤트에 실려
    // 같은 글로 일반 챗 응답을 또 하지 않는다(WP-1377 의 일반 대화 답도 followUpAgentId 가 있으면 하지 않는다 — 이어 처리가 먼저).
    long answerId = chat(owner, "애매하네");
    var followUps = followUpEvents();
    assertThat(followUps).hasSize(1);
    assertThat(followUps.get(0).followUp().question()).isEqualTo(result);
    assertThat(followUps.get(0).followUp().answer()).isEqualTo("애매하네");
    assertThat(answerEvent(answerId).followUpAgentId()).isEqualTo(agent);

    // 답이 애매해 이어 처리가 다시 「정해 주세요」로 물었다 — 새 질문으로 다시 등록된다.
    String again = "고른 항목을 알 수 없어 처리하지 않았습니다.\n\n## 정해 주세요\n1. 회신할까요, 보류할까요?";
    report(agent, recurrenceRow().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID), true, again, true)
        .andExpect(status().isNoContent());
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.PENDING_QUESTION_TEXT)).isEqualTo(again);

    // 「넘어가」 — 이어 처리가 절 없이 끝나면(질문 아님) 질문이 닫혀, 소유자의 다음 글은 더 이어 처리하지 않는다.
    chat(owner, "넘어가");
    assertThat(followUpEvents()).hasSize(2);
    report(agent, recurrenceRow().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID), true, "하지 않았습니다.")
        .andExpect(status().isNoContent());
    assertThat(agentQuestionFlags()).containsExactly(true, true, false);
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNull();
    chat(owner, "고마워");
    assertThat(followUpEvents()).hasSize(2);
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
  }

  @Test
  void 이어_처리_실패는_연속_실패로_세지_않는다() throws Exception {
    askQuestion("메일을 보낼까요?");
    chat(owner, "보내 줘");
    String followRunId = recurrenceRow().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID);
    report(agent, followRunId, false, "메일 계정 연결이 끊겼습니다").andExpect(status().isNoContent());

    assertThat(agentMessages())
        .containsExactly(
            "메일을 보낼까요?", IssueRecurrenceService.FOLLOW_UP_FAILED_PREFIX + "메일 계정 연결이 끊겼습니다");
    var row = recurrenceRow();
    assertThat(row.get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isZero();
    assertThat(row.get(ISSUE_RECURRENCE.ENABLED)).isTrue();
    assertThat(row.get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID)).isNull();
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
  }

  @Test
  void 답을_기다리는_중에도_다음_정기_회차는_돈다() throws Exception {
    askQuestion("메일을 보낼까요?");
    String runId = dispatchOnce();
    assertThat(runId).isNotNull();
    assertThat(events.stream(IssueRecurringRunEvent.class).filter(e -> e.followUp() == null))
        .hasSize(2);
    // 질문은 그대로 남아 있다.
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNotNull();
  }

  @Test
  void 질문_없이_끝난_다음_회차는_앞선_질문을_낡은_것으로_지운다() throws Exception {
    askQuestion("메일을 보낼까요?");
    // 다음 회차가 묻지 않고 끝났다 — 소유자의 다음 글(그 회차 결과에 대한 인사 등)을 지난 질문의 답으로 잡지 않는다.
    report(agent, dispatchOnce(), true, "오늘 정리").andExpect(status().isNoContent());
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNull();

    chat(owner, "좋네요");
    assertThat(followUpEvents()).isEmpty();
  }

  @Test
  void 실패한_다음_회차는_앞선_질문을_남긴다() throws Exception {
    askQuestion("메일을 보낼까요?");
    report(agent, dispatchOnce(), false, "연결 오류").andExpect(status().isNoContent());
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNotNull();

    chat(owner, "보내 줘");
    assertThat(followUpEvents()).hasSize(1);
  }

  @Test
  void 이어_처리와_정기_회차가_함께_돌아도_결과를_따로_받는다() throws Exception {
    askQuestion("메일을 보낼까요?");
    chat(owner, "보내 줘");
    String followRunId = recurrenceRow().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID);
    String runId = dispatchOnce();

    // 정기 회차 결과가 먼저 와도 이어 처리가 도는 중이라 「작업 중」을 유지한다.
    report(agent, runId, true, "정기 결과").andExpect(status().isNoContent());
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("WORKING");
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID)).isEqualTo(followRunId);

    report(agent, followRunId, true, "보냈습니다").andExpect(status().isNoContent());
    assertThat(agentMessages()).containsExactly("메일을 보낼까요?", "정기 결과", "보냈습니다");
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
  }

  @Test
  void 이어_처리_결과를_30분_넘게_못_받으면_비우고_알린다() throws Exception {
    askQuestion("메일을 보낼까요?");
    chat(owner, "보내 줘");
    String followRunId = recurrenceRow().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID);
    dsl.update(ISSUE_RECURRENCE)
        .set(
            ISSUE_RECURRENCE.FOLLOW_UP_DISPATCHED_AT,
            Instant.now().minus(31, ChronoUnit.MINUTES).atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();

    assertThat(recurrenceService.runDue(Instant.now())).isZero();

    var row = recurrenceRow();
    assertThat(row.get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID)).isNull();
    assertThat(row.get(ISSUE_RECURRENCE.CONSECUTIVE_FAILURES)).isZero();
    assertThat(agentMessages()).containsExactly("메일을 보낼까요?", IssueRecurrenceService.FOLLOW_UP_LOST);
    assertThat(activeWork().get(AGENT_WORK.STATE)).isEqualTo("SCHEDULED");
    // 늦게 온 결과는 무시한다.
    report(agent, followRunId, true, "늦은 결과").andExpect(status().isNoContent());
    assertThat(agentMessages()).hasSize(2);
  }

  @Test
  void 이어_처리_중에_반복을_지우면_묘비로_남기고_그_결과는_받는다() throws Exception {
    askQuestion("메일을 보낼까요?");
    chat(owner, "보내 줘");
    String followRunId = recurrenceRow().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID);
    call(delete(path()), owner).andExpect(status().isNoContent());
    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.DELETED)).isTrue();

    report(agent, followRunId, true, "보냈습니다").andExpect(status().isNoContent());
    assertThat(agentMessages()).containsExactly("메일을 보낼까요?", "보냈습니다");
    assertThat(recurrenceRow()).isNull();
  }

  @Test
  void 지운_반복의_이어_처리가_다시_물어도_답할_수_없으니_질문으로_남기지_않는다() throws Exception {
    askQuestion("메일을 보낼까요?");
    chat(owner, "보내 줘");
    String followRunId = recurrenceRow().get(ISSUE_RECURRENCE.FOLLOW_UP_RUN_ID);
    call(delete(path()), owner).andExpect(status().isNoContent());

    report(agent, followRunId, true, "받는 사람을 누구로 할까요?", true).andExpect(status().isNoContent());
    // 질문 표시 없이 일반 글로 — 답해도 이어 가지 않으므로 「답변 필요」 알림을 내지 않는다.
    assertThat(agentQuestionFlags()).containsExactly(true, false);
  }

  @Test
  void 실행_AI가_바뀌면_예전_AI의_질문은_답으로_이어가지_않는다() throws Exception {
    askQuestion("메일을 보낼까요?");
    long agent2 = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, owner));
    personalAssistantRepository.setAgentId(owner, agent2);
    projectMemberRepository.insert(projectId(), agent2, "MEMBER");
    assigneeRepository.add(issueId, agent2, owner);
    call(put(path()).content(req("FREQ=DAILY", "08:00")), owner).andExpect(status().isOk());

    assertThat(recurrenceRow().get(ISSUE_RECURRENCE.PENDING_QUESTION_MESSAGE_ID)).isNull();
    chat(owner, "보내 줘");
    assertThat(followUpEvents()).isEmpty();
  }

  // ───────────────────────────── 도우미 ─────────────────────────────

  /** 정기 회차 하나를 보내고 그 결과를 질문으로 보고한다 — 이슈 챗에 답을 기다리는 질문이 남는다. */
  private void askQuestion(String question) throws Exception {
    report(agent, dispatchOnce(), true, question, true).andExpect(status().isNoContent());
  }

  /** 소유자 등 사람이 이 이슈 챗에 글을 남기고 그 글 id 를 돌려준다(화면과 같은 API). */
  private long chat(long as, String body) throws Exception {
    long threadId = chatThreadRepository.insertIfAbsent(issueId);
    JsonNode r =
        json(
            call(
                    post("/api/v1/chat/threads/" + threadId + "/messages")
                        .content(om.writeValueAsString(Map.of("body", body))),
                    as)
                .andExpect(status().isCreated()));
    return r.get("id").asLong();
  }

  /** 지금까지 발행된 이어 처리 이벤트(질문에 대한 답으로 보낸 회차). */
  private List<IssueRecurringRunEvent> followUpEvents() {
    return events.stream(IssueRecurringRunEvent.class).filter(e -> e.followUp() != null).toList();
  }

  /** 그 글의 챗 생성 이벤트. */
  private ChatMessageCreatedEvent answerEvent(long messageId) {
    return events.stream(ChatMessageCreatedEvent.class)
        .filter(e -> e.messageId() == messageId)
        .findFirst()
        .orElseThrow();
  }

  /** 매일 08:00 반복을 저장하고 다음 회차를 지난 시각으로 당긴다. */
  private void saveAndMakeDue() throws Exception {
    call(put(path()).content(req("FREQ=DAILY", "08:00")), owner).andExpect(status().isOk());
    setNextRunAt(Instant.now().minusSeconds(60));
  }

  /** 반복이 없으면 저장하고, 회차 시각을 지난 시각으로 당겨 한 회차를 보낸 뒤 그 runId 를 돌려준다. */
  private String dispatchOnce() throws Exception {
    if (dsl.fetchCount(ISSUE_RECURRENCE, ISSUE_RECURRENCE.ISSUE_ID.eq(issueId)) == 0) {
      call(put(path()).content(req("FREQ=DAILY", "08:00")), owner).andExpect(status().isOk());
    }
    // 회차 id 가 매번 달라지게 회차 시각을 조금씩 다르게 당긴다.
    setNextRunAt(Instant.now().minusSeconds(60 + recurrenceRow().get(ISSUE_RECURRENCE.RUN_COUNT)));
    assertThat(recurrenceService.runDue(Instant.now())).isEqualTo(1);
    return recurrenceRow().get(ISSUE_RECURRENCE.PENDING_RUN_ID);
  }

  private void setNextRunAt(Instant t) {
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.NEXT_RUN_AT, t.atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  private void setLastRunAt(Instant t) {
    dsl.update(ISSUE_RECURRENCE)
        .set(ISSUE_RECURRENCE.LAST_RUN_AT, t.atOffset(ZoneOffset.UTC))
        .where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId))
        .execute();
  }

  private Record recurrenceRow() {
    return dsl.selectFrom(ISSUE_RECURRENCE).where(ISSUE_RECURRENCE.ISSUE_ID.eq(issueId)).fetchOne();
  }

  /** 시드 이슈의 개인 프로젝트 id. */
  private long projectId() {
    return dsl.select(com.workplace.jooq.Tables.ISSUE.PROJECT_ID)
        .from(com.workplace.jooq.Tables.ISSUE)
        .where(com.workplace.jooq.Tables.ISSUE.ID.eq(issueId))
        .fetchOne(com.workplace.jooq.Tables.ISSUE.PROJECT_ID);
  }

  private Record activeWork() {
    Record r = activeWorkOrNull();
    assertThat(r).as("진행 중 AI 작업").isNotNull();
    return r;
  }

  private Record activeWorkOrNull() {
    return activeWorkOrNull(agent);
  }

  /** 그 AI 의 진행 중(끝나지 않은) 작업 기록 — 없으면 null. */
  private Record activeWorkOrNull(long workerId) {
    return dsl.selectFrom(AGENT_WORK)
        .where(AGENT_WORK.ISSUE_ID.eq(issueId))
        .and(AGENT_WORK.WORKER_ID.eq(workerId))
        .and(AGENT_WORK.ENDED_AT.isNull())
        .fetchOne();
  }

  private String lastWorkState() {
    return dsl.select(AGENT_WORK.STATE)
        .from(AGENT_WORK)
        .where(AGENT_WORK.ISSUE_ID.eq(issueId))
        .and(AGENT_WORK.WORKER_ID.eq(agent))
        .orderBy(AGENT_WORK.ID.desc())
        .limit(1)
        .fetchOne(AGENT_WORK.STATE);
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

  private ResultActions report(long as, String runId, boolean ok, String message, boolean question)
      throws Exception {
    var r =
        mvc.perform(
            post("/api/v1/internal/issue-recurrence/" + issueId + "/runs")
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .header("X-On-Behalf-Of", String.valueOf(as))
                .header("X-On-Behalf-Of-Tenant", "1")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    om.writeValueAsString(
                        Map.of(
                            "runId", runId, "ok", ok, "message", message, "question", question))));
    TenantContext.set(1L);
    return r;
  }

  private ResultActions report(long as, String runId, boolean ok, String message) throws Exception {
    var r =
        mvc.perform(
            post("/api/v1/internal/issue-recurrence/" + issueId + "/runs")
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .header("X-On-Behalf-Of", String.valueOf(as))
                .header("X-On-Behalf-Of-Tenant", "1")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    om.writeValueAsString(Map.of("runId", runId, "ok", ok, "message", message))));
    TenantContext.set(1L);
    return r;
  }

  private String path() {
    return "/api/v1/projects/" + key + "/issues/" + number + "/recurrence";
  }

  private String req(String rrule, String time) throws Exception {
    var m = new java.util.HashMap<String, Object>();
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
