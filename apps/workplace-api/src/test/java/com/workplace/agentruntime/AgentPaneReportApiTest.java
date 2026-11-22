package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.outbound.AgentRuntimeChangeNotifier;
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
    // DB 저장 컬럼이 timestamp(6) (마이크로초) 이라 나노 자릿수는 반올림된다 — 정렬하지 않으면
    // 내림·반올림이 갈려 실행마다 절반 확률로 단언이 어긋났다(WP-1998). 단언 쪽 truncation 은 방어선.
    OffsetDateTime t = OffsetDateTime.now().minusMinutes(2).truncatedTo(ChronoUnit.MICROS);

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
