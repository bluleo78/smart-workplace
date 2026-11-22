package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static com.workplace.jooq.Tables.AGENT_RUNTIME_SLOT_STATE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.agentruntime.dto.AgentState;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.outbound.AgentRuntimeChangeNotifier;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1913 칸 차단 보고 API 통합 테스트 — Pod 안 진입점이 칸을 띄우지 못하면(설정·로그인 오류) 이유를 자기 AI 키로 보고하면 실행 설정의
 * pane_blocked_* 칸에 저장되고, 다시 띄우면(OK) 칸이 비워진다. 500자 초과 본문은 저장 없이 400, 사람 인증은 403 이다. 칸이 실제로 바뀔 때만
 * 관리자 화면 실시간 알림이 나가는지도 본다.
 */
@Transactional
@RecordApplicationEvents
class AgentPaneReportApiTest extends IntegrationTestBase {

  private static final String URL = "/api/v1/agent-runtime/me/pane";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired AgentApiKeyService keyService;
  @Autowired ApplicationEvents appEvents;
  @Autowired AgentRuntimeSlotRepository slots;

  private long admin;
  private long agent;
  private String key;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    locationService.create(admin, new CreateAgentLocationRequest("L1", null, 5));
    agent = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    settingService.put(
        admin, agent, new PutAgentRuntimeSettingRequest("claude-code", null, Map.of(), null));
    key = keyService.issueManaged(agent, 1L, null, null, "L1").plaintext();
  }

  /** AI 키로 칸 차단을 보고한다 — 호출 전후로 GUC 를 테넌트 1 로 맞춘다. */
  private ResultActions report(String akKey, String body) throws Exception {
    useTenant(1L);
    ResultActions r =
        mvc.perform(
            put(URL)
                .header("Authorization", "Bearer " + akKey)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    useTenant(1L);
    return r;
  }

  /** 이 AI 의 실행 설정 행. */
  private Record settingOf() {
    return dsl.selectFrom(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .fetchOne();
  }

  /**
   * 관리자 화면 실시간 알림(resource agent-runtime) 수 — 칸 차단 보고가 화면에 보이는 것(「오류」+사유)을 바꿨을 때만 보내야 이미 열려 있는 관리자
   * 화면이 갱신된다(WP-1913). 테스트는 트랜잭션을 되돌리므로 커밋 직전 디스패처는 돌지 않고 발행된 이벤트만 기록된다.
   */
  private long runtimeEvents() {
    return appEvents.stream(ResourceChangedEvent.class)
        .filter(e -> AgentRuntimeChangeNotifier.RESOURCE_AGENT_RUNTIME.equals(e.resource()))
        .count();
  }

  /** BLOCKED 보고를 받으면 204 로 차단 메시지와 시각을 저장한다. */
  @Test
  void blocked_보고가_메시지를_저장한다() throws Exception {
    report(key, "{\"state\":\"BLOCKED\",\"message\":\"설정 오류로 칸을 못 띄웠어요\"}")
        .andExpect(status().isNoContent());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("설정 오류로 칸을 못 띄웠어요");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT)).isNotNull();
  }

  /** OK 보고를 받으면 앞서 저장한 차단 메시지를 지운다. */
  @Test
  void ok_보고가_메시지를_지운다() throws Exception {
    report(key, "{\"state\":\"BLOCKED\",\"message\":\"로그인 오류\"}").andExpect(status().isNoContent());
    report(key, "{\"state\":\"OK\"}").andExpect(status().isNoContent());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT)).isNull();
  }

  /** 차단 메시지가 500자를 넘으면 400 으로 받고 저장하지 않는다. */
  @Test
  void 차단_메시지가_500자를_넘으면_400() throws Exception {
    report(key, "{\"state\":\"BLOCKED\",\"message\":\"" + "a".repeat(501) + "\"}")
        .andExpect(status().isBadRequest());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
  }

  /**
   * 메시지에 섞인 개행·제어 문자는 공백으로 바꾸고 앞뒤를 뺀 뒤 저장한다(WP-1913) — 로그 한 줄을 그대로 실으면 화면 한 줄이 여러 줄로 갈라지고 NUL 이 끼어
   * 깨진다(gw-boot 의 tr·sed 와 같은 취향, 서버가 마지막으로 방어).
   */
  @Test
  void 차단_메시지의_제어_문자는_공백으로_바꿔_저장한다() throws Exception {
    report(key, "{\"state\":\"BLOCKED\",\"message\":\"\\n설정 오류\\n로 칸을 못 띄웠어요\\u0000\\t\"}")
        .andExpect(status().isNoContent());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE))
        .isEqualTo("설정 오류 로 칸을 못 띄웠어요");
  }

  /** 제어 문자만 있는 메시지는 내용이 없으므로 400 으로 받고 저장하지 않는다 — 공백 메시지와 같은 취급(이유 없는 차단). */
  @Test
  void 차단_메시지가_제어_문자뿐이면_400() throws Exception {
    report(key, "{\"state\":\"BLOCKED\",\"message\":\"\\u0000\\n\\t\"}")
        .andExpect(status().isBadRequest());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
  }

  /** state 가 BLOCKED·OK 가 아니면 400 으로 받고 저장하지 않는다 — 서비스 본문 검증이 거절한다. */
  @Test
  void state가_BLOCKED도_OK도_아니면_400() throws Exception {
    report(key, "{\"state\":\"WHATEVER\"}").andExpect(status().isBadRequest());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
  }

  /** BLOCKED 보고에 message 가 없으면 400 으로 받고 저장하지 않는다 — 이유 없는 차단은 화면에 쓸 수 없다. */
  @Test
  void BLOCKED_보고에_message가_없으면_400() throws Exception {
    report(key, "{\"state\":\"BLOCKED\"}").andExpect(status().isBadRequest());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
  }

  /** 칸 차단 보고가 관리자 화면 실시간 알림을 한 번 보낸다 — 「오류」+사유가 새로 표시되므로(WP-1913). */
  @Test
  void 차단_보고가_실시간_변경_알림을_보낸다() throws Exception {
    appEvents.clear();

    report(key, "{\"state\":\"BLOCKED\",\"message\":\"설정 오류로 칸을 못 띄웠어요\"}")
        .andExpect(status().isNoContent());

    assertThat(runtimeEvents()).isEqualTo(1);
  }

  /** 같은 메시지의 거듭된 차단 보고(진입점 재시도)는 알리지 않는다 — 화면에 보이는 것이 그대로이므로(WP-1913). */
  @Test
  void 같은_차단_메시지의_거듭된_보고는_알리지_않는다() throws Exception {
    report(key, "{\"state\":\"BLOCKED\",\"message\":\"설정 오류로 칸을 못 띄웠어요\"}")
        .andExpect(status().isNoContent());
    appEvents.clear();

    report(key, "{\"state\":\"BLOCKED\",\"message\":\"설정 오류로 칸을 못 띄웠어요\"}")
        .andExpect(status().isNoContent());

    assertThat(runtimeEvents()).isZero();
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE))
        .isEqualTo("설정 오류로 칸을 못 띄웠어요");
  }

  /** 다시 띄웠다는 OK 보고가 칸을 비우면서 실시간 알림을 한 번 보낸다 — 「오류」가 화면에서 사라지므로(WP-1913). */
  @Test
  void ok_보고가_칸을_지우며_실시간_변경_알림을_보낸다() throws Exception {
    report(key, "{\"state\":\"BLOCKED\",\"message\":\"로그인 오류\"}").andExpect(status().isNoContent());
    appEvents.clear();

    report(key, "{\"state\":\"OK\"}").andExpect(status().isNoContent());

    assertThat(runtimeEvents()).isEqualTo(1);
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
  }

  /**
   * 지금 generation 에서 온 차단 보고는 사유와 함께 generation 을 저장한다 — 읽는 쪽이 지금 generation 의 것만 합치게(WP-1913 리뷰 반려
   * ①).
   */
  @Test
  void 차단_보고의_generation을_저장한다() throws Exception {
    long gen = settingOf().get(AGENT_RUNTIME_SETTING.GENERATION);

    report(key, "{\"state\":\"BLOCKED\",\"message\":\"설정 오류\",\"generation\":" + gen + "}")
        .andExpect(status().isNoContent());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_GENERATION)).isEqualTo(gen);
  }

  /**
   * 지금 generation 과 다른 Pod 의 늦은 차단 보고는 무시한다 — 끝나는 중인 옛 Pod 가 설정을 바꾼 뒤의 새 generation 을 자기 사유로 덮지
   * 않게(WP-1913 리뷰 반려 ①). 보고는 최선 노력이라 응답은 그대로 204 다.
   */
  @Test
  void 지금_generation과_다른_차단_보고는_무시한다() throws Exception {
    long gen = settingOf().get(AGENT_RUNTIME_SETTING.GENERATION);

    report(
            key,
            "{\"state\":\"BLOCKED\",\"message\":\"옛 Pod 의 차단\",\"generation\":" + (gen - 1) + "}")
        .andExpect(status().isNoContent());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_GENERATION)).isNull();
  }

  /** 옛 Pod 의 늦은 OK 보고도 지금 차단을 지우지 못한다 — 지금 generation 을 지우는 것은 지금 Pod 의 OK 뿐이다(WP-1913 리뷰 반려 ①). */
  @Test
  void 지금_generation과_다른_OK_보고는_차단을_지우지_못한다() throws Exception {
    long gen = settingOf().get(AGENT_RUNTIME_SETTING.GENERATION);
    report(key, "{\"state\":\"BLOCKED\",\"message\":\"지금 차단\",\"generation\":" + gen + "}")
        .andExpect(status().isNoContent());
    appEvents.clear();

    report(key, "{\"state\":\"OK\",\"generation\":" + (gen - 1) + "}")
        .andExpect(status().isNoContent());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("지금 차단");
    assertThat(runtimeEvents()).isZero();
  }

  /**
   * 설정을 고쳐 generation 이 오른 뒤 새 generation Pod 가 같은 사유를 다시 보고하면 알림이 나간다 — 저장 원문은 그대로지만 읽을 때 화면이 「시작
   * 중」 → 「오류」로 바뀌기 때문이다. 알림이 빠지면 목록·상세가 새로고침 전까지 계속 「시작 중」으로 남아 이슈의 원래 증상이 되살아난다 (WP-1913 리뷰 반려 ① —
   * 알림 기준을 저장 원문이 아니라 갱신 전·후 currentPaneBlocked 로 바꾼 것을 고정).
   */
  @Test
  void generation이_오른_뒤_같은_사유를_다시_보고하면_알림이_나간다() throws Exception {
    long gen = settingOf().get(AGENT_RUNTIME_SETTING.GENERATION);
    report(key, "{\"state\":\"BLOCKED\",\"message\":\"설정 오류\",\"generation\":" + gen + "}")
        .andExpect(status().isNoContent());
    // 관리자가 설정을 고쳐 generation 이 오르면 옛 사유는 읽을 때 가려진다 — 저장 원문은 그대로 「설정 오류」다.
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.GENERATION, gen + 1)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    appEvents.clear();

    report(key, "{\"state\":\"BLOCKED\",\"message\":\"설정 오류\",\"generation\":" + (gen + 1) + "}")
        .andExpect(status().isNoContent());

    assertThat(runtimeEvents()).isEqualTo(1);
    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("설정 오류");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_GENERATION)).isEqualTo(gen + 1);
  }

  /** 새 Pod 시작 시각을 칸 보고가 올려 둔 값(reported_pod_started_at)으로 심는다(WP-1958) — 새 Pod 가 먼저 상태를 보고한 상황. */
  private void setReportedPodStart(OffsetDateTime t) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT, t)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  /** 같은 generation 의 옛 Pod(T1) 가 새 Pod(T2) 상태 보고 뒤 늦게 보낸 BLOCKED 는 무시한다(WP-1958). */
  @Test
  void 같은_generation_에서_옛_파드의_늦은_BLOCKED_는_무시한다() throws Exception {
    long gen = settingOf().get(AGENT_RUNTIME_SETTING.GENERATION);
    OffsetDateTime t2 = OffsetDateTime.now().minusMinutes(1);
    setReportedPodStart(t2);
    appEvents.clear();

    report(
            key,
            "{\"state\":\"BLOCKED\",\"message\":\"옛 Pod 차단\",\"generation\":"
                + gen
                + ",\"podStartedAt\":\""
                + t2.minusMinutes(10)
                + "\"}")
        .andExpect(status().isNoContent());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(runtimeEvents()).isZero();
  }

  /** 옛 Pod(T1) 의 늦은 OK 는 새 Pod(T2) 의 차단을 지우지 못한다(WP-1958). */
  @Test
  void 같은_generation_에서_옛_파드의_늦은_OK_는_새_파드_차단을_지우지_못한다() throws Exception {
    long gen = settingOf().get(AGENT_RUNTIME_SETTING.GENERATION);
    OffsetDateTime t2 = OffsetDateTime.now().minusMinutes(1);
    report(
            key,
            "{\"state\":\"BLOCKED\",\"message\":\"새 Pod 차단\",\"generation\":"
                + gen
                + ",\"podStartedAt\":\""
                + t2
                + "\"}")
        .andExpect(status().isNoContent());
    appEvents.clear();

    report(
            key,
            "{\"state\":\"OK\",\"generation\":"
                + gen
                + ",\"podStartedAt\":\""
                + t2.minusMinutes(10)
                + "\"}")
        .andExpect(status().isNoContent());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("새 Pod 차단");
    assertThat(runtimeEvents()).isZero();
  }

  /** BLOCKED 는 보고한 Pod 시작 시각을 저장하고, 보고한 시각만큼 지금 Pod 시작도 올린다(WP-1958). */
  @Test
  void BLOCKED_는_보고한_파드_시각을_저장한다() throws Exception {
    OffsetDateTime t = OffsetDateTime.now().minusMinutes(2);

    report(key, "{\"state\":\"BLOCKED\",\"message\":\"설정 오류\",\"podStartedAt\":\"" + t + "\"}")
        .andExpect(status().isNoContent());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_POD_STARTED_AT).toInstant())
        .isEqualTo(t.toInstant().truncatedTo(ChronoUnit.MICROS));
    assertThat(row.get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNotNull();
  }

  /** 서버 시각보다 30초 넘게 미래인 podStartedAt 은 시계 이상이라 시각 없는 보고처럼 다룬다 — 차단은 저장하되 시각은 남기지 않는다(WP-1958). */
  @Test
  void 미래_파드_시각의_BLOCKED_는_시각_없는_보고처럼_저장한다() throws Exception {
    OffsetDateTime future = OffsetDateTime.now().plusMinutes(5);

    report(key, "{\"state\":\"BLOCKED\",\"message\":\"설정 오류\",\"podStartedAt\":\"" + future + "\"}")
        .andExpect(status().isNoContent());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("설정 오류");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_POD_STARTED_AT)).isNull();
  }

  /** 시각 없는 BLOCKED·OK 는 지금처럼 동작한다 — 저장도 거르기도 없다(WP-1958). */
  @Test
  void 시각_없는_BLOCKED_OK_는_지금처럼_동작한다() throws Exception {
    setReportedPodStart(OffsetDateTime.now().minusMinutes(1));
    report(key, "{\"state\":\"BLOCKED\",\"message\":\"차단\"}").andExpect(status().isNoContent());
    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("차단");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_POD_STARTED_AT)).isNull();

    report(key, "{\"state\":\"OK\"}").andExpect(status().isNoContent());
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
  }

  /**
   * 칸 테이블 시드(WP-1969) — runner 가 관찰한 Pod 시작(started_at = p, 컨테이너가 재시작해도 그대로)과 칸이 올려 둔 Pod 시작
   * (reported_pod_started_at = reported)을 따로 두고, 합친 상태를 WORKING+이슈 키로 맞춘다. 앞 컨테이너가 일하다 멈춘 뒤 새 컨테이너가
   * 뜬 상황의 출발점이다.
   */
  private void seedMerged(OffsetDateTime p, OffsetDateTime reported, String issueKey) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.STARTED_AT, p)
        .set(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT, reported)
        .set(AGENT_RUNTIME_SETTING.AGENT_STATE, "WORKING")
        .set(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEY, issueKey)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  private long slotCount() {
    return dsl.fetchCount(
        AGENT_RUNTIME_SLOT_STATE, AGENT_RUNTIME_SLOT_STATE.AGENT_USER_ID.eq(agent));
  }

  private String blockedBody(OffsetDateTime podStart) {
    return "{\"state\":\"BLOCKED\",\"message\":\"시작 실패\",\"podStartedAt\":\"" + podStart + "\"}";
  }

  /** 새 컨테이너만 시작에 실패해 BLOCKED 만 보내도 앞 컨테이너의 WORKING 칸이 합쳐 빠진다(WP-1969). */
  @Test
  void 새_컨테이너의_차단은_앞_컨테이너의_작업중_칸을_뺀다() throws Exception {
    OffsetDateTime t1 = OffsetDateTime.now().minusMinutes(10);
    OffsetDateTime t2 = t1.plusMinutes(5);
    seedMerged(t1.minusMinutes(3), t1, "WP-1");
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1);

    report(key, blockedBody(t2)).andExpect(status().isNoContent());

    assertThat(slotCount()).isZero();
    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEY)).isNull();
  }

  /** 같은 컨테이너(Pod 시작 T2)에서 일하는 칸은 차단 보고 뒤에도 남고, 앞 컨테이너(T1) 칸만 빠진다. */
  @Test
  void 같은_컨테이너에서_일하는_칸은_차단_보고_뒤에도_남는다() throws Exception {
    OffsetDateTime t1 = OffsetDateTime.now().minusMinutes(10);
    OffsetDateTime t2 = t1.plusMinutes(5);
    seedMerged(t1.minusMinutes(3), t2, "WP-2");
    slots.upsert(agent, "NEW", AgentState.WORKING, "WP-2", null, t2.plusSeconds(5), t2);
    slots.upsert(agent, "OLD", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1);

    report(key, blockedBody(t2)).andExpect(status().isNoContent());

    List<String> keys =
        dsl.select(AGENT_RUNTIME_SLOT_STATE.SLOT_KEY)
            .from(AGENT_RUNTIME_SLOT_STATE)
            .where(AGENT_RUNTIME_SLOT_STATE.AGENT_USER_ID.eq(agent))
            .fetch(AGENT_RUNTIME_SLOT_STATE.SLOT_KEY);
    assertThat(keys).containsExactly("NEW");
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("WORKING");
  }

  /** 옛 컨테이너의 늦은 차단은 옛 Pod 보고라 버려진다 — 칸·합친 상태·차단 메시지 모두 그대로. */
  @Test
  void 옛_컨테이너의_늦은_차단은_칸을_다시_합치지_않는다() throws Exception {
    OffsetDateTime t1 = OffsetDateTime.now().minusMinutes(10);
    OffsetDateTime t2 = t1.plusMinutes(5);
    seedMerged(t1.minusMinutes(3), t2, "WP-2");
    slots.upsert(agent, "NEW", AgentState.WORKING, "WP-2", null, t2.plusSeconds(5), t2);

    report(key, blockedBody(t1)).andExpect(status().isNoContent());

    assertThat(slotCount()).isEqualTo(1);
    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("WORKING");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
  }

  /** 차단으로 AI 상태가 바뀌면 알림은 한 번 — 같은 보고가 거듭돼도 더 알리지 않는다. */
  @Test
  void 차단으로_AI_상태가_바뀌면_알림은_한_번이고_거듭된_보고는_알리지_않는다() throws Exception {
    OffsetDateTime t1 = OffsetDateTime.now().minusMinutes(10);
    OffsetDateTime t2 = t1.plusMinutes(5);
    seedMerged(t1.minusMinutes(3), t1, "WP-1");
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1);
    appEvents.clear();

    report(key, blockedBody(t2)).andExpect(status().isNoContent());
    assertThat(runtimeEvents()).isEqualTo(1);
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();

    report(key, blockedBody(t2)).andExpect(status().isNoContent());
    assertThat(runtimeEvents()).isEqualTo(1);
  }

  /** 칸이 하나도 없는 AI 가 이미 보이는 차단을 같은 메시지로 다시 보고해도 합치기 쓰기 때문에 알림이 나가지 않는다(WP-1969). */
  @Test
  void 칸이_없는_AI_의_같은_차단_보고는_합치기로_알리지_않는다() throws Exception {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE, "시작 실패")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT, OffsetDateTime.now())
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    appEvents.clear();

    report(key, "{\"state\":\"BLOCKED\",\"message\":\"시작 실패\"}").andExpect(status().isNoContent());

    assertThat(runtimeEvents()).isZero();
  }

  /**
   * 적용 대기 시드(WP-1969) — generation 을 올려 두고 지금 도는 Pod 는 한 단계 앞 generation 에 남겨 둔 상태(쉴 때 적용 설정이 저장돼
   * 아직 안 나간 상황)로 맞춘다. 켜진(RUN) AI 라 runner 에 알릴 수 있다.
   */
  private void seedUnapplied(long generation, long observed) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.GENERATION, generation)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION, observed)
        .set(AGENT_RUNTIME_SETTING.PHASE, "RUNNING")
        .set(AGENT_RUNTIME_SETTING.DESIRED, "RUN")
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  private String blockedBody(OffsetDateTime podStart, long generation) {
    return "{\"state\":\"BLOCKED\",\"message\":\"시작 실패\",\"generation\":"
        + generation
        + ",\"podStartedAt\":\""
        + podStart
        + "\"}";
  }

  /** 도는 Pod 의 차단을 직접 맞춘다(WP-1969) — 사유·generation·그 Pod 의 시작 시각. */
  private void seedBlock(Long generation, OffsetDateTime pod) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE, "도는 Pod 차단")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT, OffsetDateTime.now())
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_GENERATION, generation)
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_POD_STARTED_AT, pod)
        .set(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT, pod)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  private String okBody(OffsetDateTime podStart, long generation) {
    return "{\"state\":\"OK\",\"generation\":"
        + generation
        + ",\"podStartedAt\":\""
        + podStart
        + "\"}";
  }

  /** 원하는 상태·적용 방식을 바꾼다(WP-1969) — {@link #seedUnapplied} 뒤에 부른다. */
  private void setMode(String desired, String applyMode) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.DESIRED, desired)
        .set(AGENT_RUNTIME_SETTING.APPLY_MODE, applyMode)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  private long desiredEvents() {
    return appEvents.stream(AgentRuntimeDesiredChanged.class).count();
  }

  /** 적용 대기 중(generation 2, 도는 Pod 는 1)에도 지금 도는 generation 1 의 차단은 받아 앞 컨테이너 칸을 뺀다(WP-1969). */
  @Test
  void 적용_대기_중에도_지금_도는_generation_의_차단은_받는다() throws Exception {
    OffsetDateTime t1 = OffsetDateTime.now().minusMinutes(10);
    OffsetDateTime t2 = t1.plusMinutes(5);
    seedMerged(t1.minusMinutes(3), t1, "WP-1");
    seedUnapplied(2, 1);
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1);

    report(key, blockedBody(t2, 1)).andExpect(status().isNoContent());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("시작 실패");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_GENERATION)).isEqualTo(1L);
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
  }

  /** 차단으로 지금 적용이 되면 runner 에 한 번만 알린다 — 같은 보고가 거듭돼도 더 알리지 않는다(WP-1969). */
  @Test
  void 적용_대기_중_차단으로_지금_적용이_되면_runner_에_한_번_알린다() throws Exception {
    OffsetDateTime t1 = OffsetDateTime.now().minusMinutes(10);
    OffsetDateTime t2 = t1.plusMinutes(5);
    seedMerged(t1.minusMinutes(3), t1, "WP-1");
    seedUnapplied(2, 1);
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1);
    appEvents.clear();

    report(key, blockedBody(t2, 1)).andExpect(status().isNoContent());
    assertThat(desiredEvents()).isEqualTo(1);
    assertThat(runtimeEvents()).isEqualTo(1);

    report(key, blockedBody(t2, 1)).andExpect(status().isNoContent());
    assertThat(desiredEvents()).isEqualTo(1);
    // 거듭된 같은 보고는 화면에 보이는 값도 그대로라 관리자 화면 알림도 더 나가지 않는다.
    assertThat(runtimeEvents()).isEqualTo(1);
  }

  /**
   * 꺼 둔(STOP) AI 에게 온 지금 도는 Pod(관찰 generation)의 BLOCKED 는 받지 않는다(WP-1969) — 끝나는 중인 Pod 의 늦은 쓰기를
   * WP-1913 이 버리던 대로 둔다. 차단도 합친 칸도 runner 알림도 그대로다.
   */
  @Test
  void 꺼_둔_AI_의_관찰_generation_차단은_받지_않는다() throws Exception {
    OffsetDateTime t1 = OffsetDateTime.now().minusMinutes(10);
    OffsetDateTime t2 = t1.plusMinutes(5);
    seedMerged(t1.minusMinutes(3), t1, "WP-1");
    seedUnapplied(2, 1);
    setMode("STOP", "IDLE");
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1);
    appEvents.clear();

    report(key, blockedBody(t2, 1)).andExpect(status().isNoContent());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("WORKING");
    assertThat(slotCount()).isEqualTo(1);
    assertThat(desiredEvents()).isZero();
    assertThat(runtimeEvents()).isZero();
  }

  /** 다시 시작이 걸려 있으면(RUN + 바로 적용) 앞 Pod 의 관찰 generation BLOCKED 는 받지 않는다(WP-1969). */
  @Test
  void 다시_시작이_걸린_AI_의_관찰_generation_차단은_받지_않는다() throws Exception {
    OffsetDateTime t1 = OffsetDateTime.now().minusMinutes(10);
    OffsetDateTime t2 = t1.plusMinutes(5);
    seedMerged(t1.minusMinutes(3), t1, "WP-1");
    seedUnapplied(2, 1);
    setMode("RUN", "NOW");
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1);
    appEvents.clear();

    report(key, blockedBody(t2, 1)).andExpect(status().isNoContent());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("WORKING");
    assertThat(slotCount()).isEqualTo(1);
    assertThat(desiredEvents()).isZero();
  }

  /**
   * 꺼 둔 AI 도 generation 을 밝히지 않은 BLOCKED 는 받아 칸을 합친다 — 남은 칸이 쉬는 중이라 지금 적용 전이가 생겨도 runner 에 알리지
   * 않는다(WP-1969). 꺼진 AI 를 깨워 다시 띄우지 않게 하는 {@code desired == RUN} 조건이 막는 길이다.
   */
  @Test
  void 꺼_둔_AI_의_generation_없는_차단은_받되_runner_에_알리지_않는다() throws Exception {
    OffsetDateTime t1 = OffsetDateTime.now().minusMinutes(10);
    OffsetDateTime t2 = t1.plusMinutes(5);
    seedMerged(t1.minusMinutes(3), t1, "WP-1");
    seedUnapplied(2, 1);
    setMode("STOP", "IDLE");
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1);
    slots.upsert(agent, "NEW", AgentState.IDLE, null, null, t2.plusSeconds(5), t2);
    appEvents.clear();

    report(key, blockedBody(t2)).andExpect(status().isNoContent());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("시작 실패");
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("IDLE");
    assertThat(desiredEvents()).isZero();
  }

  /**
   * 새 Pod 를 아직 관찰하지 못한(started_at 없음) AI 의 옛 WORKING 칸은 BLOCKED 로 다시 합치지 않는다(WP-1969) — 옛 칸을 가를 기준이
   * 없어 합치면 이미 지워진 AI 상태가 되살아난다. 칸 행은 그대로 두고 AI 상태는 비어 있어야 한다.
   */
  @Test
  void 새_Pod_를_관찰하기_전의_차단은_옛_칸을_되살리지_않는다() throws Exception {
    OffsetDateTime t1 = OffsetDateTime.now().minusMinutes(10);
    OffsetDateTime t2 = t1.plusMinutes(5);
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1, null);

    report(key, blockedBody(t2)).andExpect(status().isNoContent());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("시작 실패");
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEY)).isNull();
    assertThat(slotCount()).isEqualTo(1);
  }

  /** 같은 상황에서 쉴 때 적용 대기 중이면 저장된 차단을 보고 지금 적용으로 판정해 runner 에 알린다(WP-1969). */
  @Test
  void 새_Pod_를_관찰하기_전의_차단도_저장된_차단으로_적용_전이를_알린다() throws Exception {
    OffsetDateTime t1 = OffsetDateTime.now().minusMinutes(10);
    OffsetDateTime t2 = t1.plusMinutes(5);
    seedUnapplied(2, 1);
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1, null);
    appEvents.clear();

    report(key, blockedBody(t2, 1)).andExpect(status().isNoContent());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
    assertThat(desiredEvents()).isEqualTo(1);
    // 화면은 그대로다 — 옛 칸은 처음부터 합친 상태에 없었고 차단은 아직 앞 generation 이라 가려진다.
    assertThat(runtimeEvents()).isZero();
  }

  /** 같은 컨테이너에서 일하는 칸이 남아 있으면 차단 보고가 와도 지금 적용으로 바뀌지 않아 runner 에 알리지 않는다(WP-1969). */
  @Test
  void 같은_컨테이너가_일하는_중이면_차단_보고로_runner_에_알리지_않는다() throws Exception {
    OffsetDateTime t1 = OffsetDateTime.now().minusMinutes(10);
    OffsetDateTime t2 = t1.plusMinutes(5);
    seedMerged(t1.minusMinutes(3), t2, "WP-2");
    seedUnapplied(2, 1);
    slots.upsert(agent, "NEW", AgentState.WORKING, "WP-2", null, t2.plusSeconds(5), t2);
    appEvents.clear();

    report(key, blockedBody(t2, 1)).andExpect(status().isNoContent());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("WORKING");
    assertThat(desiredEvents()).isZero();
  }

  /** 더 새 generation(3) 의 차단은 도는 generation(2) 의 보고가 덮지 못한다(WP-1969). */
  @Test
  void 더_새_generation_의_차단은_도는_generation_의_보고가_덮지_못한다() throws Exception {
    seedUnapplied(3, 2);
    seedBlock(3L, null);
    appEvents.clear();

    report(key, "{\"state\":\"BLOCKED\",\"message\":\"옛 차단\",\"generation\":2}")
        .andExpect(status().isNoContent());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("도는 Pod 차단");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_GENERATION)).isEqualTo(3L);
    assertThat(runtimeEvents()).isZero();
  }

  /** 적용 대기 중 도는 Pod 가 회복해 OK 를 보내면 그 Pod 의 차단을 지운다 — 남으면 회복한 Pod 를 다시 띄운다(WP-1969). */
  @Test
  void 적용_대기_중_도는_Pod_의_OK_는_그_차단을_지운다() throws Exception {
    OffsetDateTime t2 = OffsetDateTime.now().minusMinutes(5);
    seedUnapplied(2, 1);
    seedBlock(1L, t2);
    appEvents.clear();

    report(key, okBody(t2, 1)).andExpect(status().isNoContent());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    // 앞 generation 의 차단은 화면에서 이미 가려져 있었고, 지워도 지금 적용으로 바뀌지 않는다.
    assertThat(runtimeEvents()).isZero();
    assertThat(desiredEvents()).isZero();
  }

  /** 다른 generation 이거나 generation 을 모르는 차단은 도는 Pod 의 OK 가 지우지 못한다(WP-1969). */
  @Test
  void 적용_대기_중_OK_는_같은_generation_의_차단만_지운다() throws Exception {
    OffsetDateTime t2 = OffsetDateTime.now().minusMinutes(5);
    seedUnapplied(3, 2);
    for (Long stored : new Long[] {null, 1L, 3L}) {
      seedBlock(stored, t2);

      report(key, okBody(t2, 2)).andExpect(status().isNoContent());

      assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE))
          .as("저장된 차단 generation %s", stored)
          .isEqualTo("도는 Pod 차단");
    }
  }

  /** 같은 generation 이어도 앞 컨테이너의 늦은 OK 는 새 컨테이너의 차단을 지우지 못한다(WP-1969). */
  @Test
  void 적용_대기_중에도_앞_컨테이너의_늦은_OK_는_무시한다() throws Exception {
    OffsetDateTime t2 = OffsetDateTime.now().minusMinutes(5);
    seedUnapplied(2, 1);
    seedBlock(1L, t2);

    report(key, okBody(t2.minusMinutes(5), 1)).andExpect(status().isNoContent());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("도는 Pod 차단");
  }

  /** 꺼 뒀거나 다시 시작이 걸린 AI 에게 온 앞 generation 의 OK 는 끝나는 Pod 의 늦은 쓰기라 버린다(WP-1969). */
  @Test
  void 쉴_때_적용_대기가_아니면_앞_generation_의_OK_는_무시한다() throws Exception {
    OffsetDateTime t2 = OffsetDateTime.now().minusMinutes(5);
    seedUnapplied(2, 1);
    seedBlock(1L, t2);
    setMode("RUN", "NOW");
    report(key, okBody(t2, 1)).andExpect(status().isNoContent());
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("도는 Pod 차단");

    setMode("STOP", "IDLE");
    report(key, okBody(t2, 1)).andExpect(status().isNoContent());
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("도는 Pod 차단");
  }

  /** 차단한 컨테이너의 칸이 모두 오래돼 상태가 비어도 일하는 중일 수 있어 지금 적용으로 바꾸지 않는다(WP-1969). */
  @Test
  void 차단한_컨테이너의_칸이_모두_오래됐으면_runner_에_알리지_않는다() throws Exception {
    OffsetDateTime t2 = OffsetDateTime.now().minusHours(8);
    seedMerged(t2.minusMinutes(3), t2, "WP-2");
    seedUnapplied(2, 1);
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-2", null, t2.plusSeconds(5), t2);
    appEvents.clear();

    report(key, blockedBody(t2, 1)).andExpect(status().isNoContent());
    report(key, blockedBody(t2, 1)).andExpect(status().isNoContent());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
    // 상태는 비어도 이 컨테이너에서 칸 보고가 있었다는 근거는 남는다.
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_REPORTED_AT)).isNotNull();
    assertThat(desiredEvents()).isZero();
  }

  /** generation 을 모르는 차단은 상태가 비어도 도는 Pod 의 시작 실패로 보지 않는다(WP-1969). */
  @Test
  void generation_없는_차단은_상태가_비어도_runner_에_알리지_않는다() throws Exception {
    OffsetDateTime t1 = OffsetDateTime.now().minusMinutes(10);
    OffsetDateTime t2 = t1.plusMinutes(5);
    seedMerged(t1.minusMinutes(3), t1, "WP-1");
    seedUnapplied(2, 1);
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1);
    appEvents.clear();

    report(key, blockedBody(t2)).andExpect(status().isNoContent());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
    assertThat(desiredEvents()).isZero();
  }

  /** 사람은 보고할 수 없다 — 403 AGENT_ONLY. */
  @Test
  void AI_키가_아니면_거절된다() throws Exception {
    TenantContext.set(1L);
    mvc.perform(
            put(URL)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"state\":\"OK\"}")
                .with(authentication(WebSessionAuth.of(admin, List.of()))))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.code").value("AGENT_ONLY"));
  }
}
