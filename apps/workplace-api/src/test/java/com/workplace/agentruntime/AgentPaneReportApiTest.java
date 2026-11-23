package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static com.workplace.jooq.Tables.AGENT_RUNTIME_SLOT_STATE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
import org.springframework.security.core.authority.SimpleGrantedAuthority;
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
  private String runnerToken;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    runnerToken =
        locationService
            .create(admin, new CreateAgentLocationRequest("L1", null, 5))
            .plaintextToken();
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
   * 지금 generation 과 다른 Pod 의 늦은 차단 보고는 저장 없이 버린다 — 끝나는 중인 옛 Pod 가 설정을 바꾼 뒤의 새 generation 을 자기 사유로
   * 덮지 않게(WP-1913 리뷰 반려 ①). 정체를 모르는 보고(옛 이미지)는 **조용한 204** 다 — 그 이미지는 generation 이 다시 맞을 일이 없어 다시
   * 보내도 성공할 수 없으므로, 409 로 알리면 gw-boot 가 표식 없이 계속 다시 보내는 고리가 된다(WP-1968 2차 반려 ③). 정체가 같은 지금 Pod 는
   * generation 을 보지 않고 받고(반려 ⑤), 지난 정체는 정체 판정에서 이미 409 다.
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

  /**
   * 옛 Pod 의 늦은 OK 보고도 저장 없이 버려 지금 차단을 지우지 못한다 — 지금 generation 을 지우는 것은 지금 Pod 의 OK 뿐이다(WP-1913 리뷰
   * 반려 ①). 정체를 모르는 보고의 generation 불일치라 응답은 조용한 204 이고, 저장·지우기 어느 것도 일어나지 않는다 (WP-1968 2차 반려 ③).
   */
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

  /**
   * 같은 generation 의 옛 Pod(T1) 가 새 Pod(T2) 상태 보고 뒤 늦게 보낸 BLOCKED 는 저장 없이 409 로 버린다(WP-1958·WP-1968)
   * — 정체를 모르는 보고(시각 규칙)도 받지 않은 보고라 감독 회차가 실패로 보고 다시 보내게 한다.
   */
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
        .andExpect(status().isConflict());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(runtimeEvents()).isZero();
  }

  /** 옛 Pod(T1) 의 늦은 OK 는 저장 없이 409 로 버려 새 Pod(T2) 의 차단을 지우지 못한다(WP-1958·WP-1968). */
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
        .andExpect(status().isConflict());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("새 Pod 차단");
    assertThat(runtimeEvents()).isZero();
  }

  /** BLOCKED 는 보고한 Pod 시작 시각을 저장하고, 보고한 시각만큼 지금 Pod 시작도 올린다(WP-1958). */
  @Test
  void BLOCKED_는_보고한_파드_시각을_저장한다() throws Exception {
    // DB 저장 컬럼이 timestamptz(마이크로초) 이라 나노 자릿수는 반올림된다 — 정렬하지 않으면
    // 내림·반올림이 갈려 실행마다 절반 확률로 단언이 어긋났다(WP-1998). 단언 쪽 truncation 은 방어선.

    // 마이크로초로 끊어 보낸다 — DB(timestamptz)는 마이크로초에서 반올림해, 나노초를 그대로 싣고 자른 값과 견주면 절반의 실행에서 1µs 가
    // 어긋났다(WP-2017).
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
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1, null);

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
    slots.upsert(agent, "NEW", AgentState.WORKING, "WP-2", null, t2.plusSeconds(5), t2, null);
    slots.upsert(agent, "OLD", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1, null);

    report(key, blockedBody(t2)).andExpect(status().isNoContent());

    List<String> keys =
        dsl.select(AGENT_RUNTIME_SLOT_STATE.SLOT_KEY)
            .from(AGENT_RUNTIME_SLOT_STATE)
            .where(AGENT_RUNTIME_SLOT_STATE.AGENT_USER_ID.eq(agent))
            .fetch(AGENT_RUNTIME_SLOT_STATE.SLOT_KEY);
    assertThat(keys).containsExactly("NEW");
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("WORKING");
  }

  /**
   * 옛 컨테이너의 늦은 차단은 옛 Pod 보고라 버려진다 — 칸·합친 상태·차단 메시지 모두 그대로. 버렸다고 감독 회차가 알 수 있게 409 로 답한다(WP-1968 —
   * 다시 보내면 받을 수 있는 버림).
   */
  @Test
  void 옛_컨테이너의_늦은_차단은_칸을_다시_합치지_않는다() throws Exception {
    OffsetDateTime t1 = OffsetDateTime.now().minusMinutes(10);
    OffsetDateTime t2 = t1.plusMinutes(5);
    seedMerged(t1.minusMinutes(3), t2, "WP-2");
    slots.upsert(agent, "NEW", AgentState.WORKING, "WP-2", null, t2.plusSeconds(5), t2, null);

    report(key, blockedBody(t1)).andExpect(status().isConflict());

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
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1, null);
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
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1, null);

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
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1, null);
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
   * 보이는 칸은 그대로(차단은 관찰 generation 이라 화면 사유가 가려짐, 합친 상태도 그대로)인데 차단으로 적용 판정만 쉴 때 → 지금으로 바뀌면 화면 알림 한 번과
   * runner 깨우기 한 번이 나간다(WP-2000).
   */
  @Test
  void report_whenOnlyDecisionChanges_publishesOnce() throws Exception {
    OffsetDateTime pod = OffsetDateTime.now().minusMinutes(5);
    seedUnapplied(2, 1);
    appEvents.clear();

    report(key, blockedBody(pod, 1)).andExpect(status().isNoContent());

    assertThat(runtimeEvents()).isEqualTo(1);
    assertThat(desiredEvents()).isEqualTo(1);
  }

  /**
   * OK 보고도 runner 판정(decide)이 쉴 때 → 지금으로 바뀌면 깨운다(WP-2000 코드 리뷰). Pod 를 만들지 못한 실패(FAILED·시작 시각 없음)라
   * 화면 판정(pending)은 전후 모두 NOW 이므로 화면 알림은 나가지 않는다 — 깨우기는 decide, 화면은 pending 이라는 두 판정의 분리.
   */
  @Test
  void reportOk_whenDecisionBecomesNow_wakesRunnerWithoutScreenNotice() throws Exception {
    OffsetDateTime pod = OffsetDateTime.now().minusMinutes(5);
    seedUnapplied(2, 1);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PHASE, "FAILED")
        .set(AGENT_RUNTIME_SETTING.AGENT_REPORTED_AT, pod.minusHours(1))
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    appEvents.clear();

    // generation 을 싣지 않은 OK(옛 플러그인 보고)는 그대로 받는다.
    report(key, "{\"state\":\"OK\",\"podStartedAt\":\"" + pod + "\"}")
        .andExpect(status().isNoContent());

    assertThat(desiredEvents()).isEqualTo(1);
    assertThat(runtimeEvents()).isZero();
  }

  /** OK 가 차단을 지워 판정이 지금 → 쉴 때로 내려가면 화면 알림만 한 번 나가고 깨우지는 않는다(WP-2000). */
  @Test
  void reportOk_whenDecisionLeavesNow_publishesOnce() throws Exception {
    OffsetDateTime pod = OffsetDateTime.now().minusMinutes(5);
    seedUnapplied(2, 1);
    seedBlock(1L, pod);
    appEvents.clear();

    report(key, okBody(pod, 1)).andExpect(status().isNoContent());

    assertThat(runtimeEvents()).isEqualTo(1);
    assertThat(desiredEvents()).isZero();
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
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1, null);
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
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1, null);
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
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1, null);
    slots.upsert(agent, "NEW", AgentState.IDLE, null, null, t2.plusSeconds(5), t2, null);
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
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1, null, null);

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
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1, null, null);
    appEvents.clear();

    report(key, blockedBody(t2, 1)).andExpect(status().isNoContent());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
    assertThat(desiredEvents()).isEqualTo(1);
    // 보이는 칸은 그대로지만(옛 칸은 처음부터 합친 상태에 없었고 차단은 아직 앞 generation 이라 가려진다) 적용 판정이 쉴 때 → 지금으로 바뀌어 한 번
    // 알린다(WP-2000).
    assertThat(runtimeEvents()).isEqualTo(1);
  }

  /** 같은 컨테이너에서 일하는 칸이 남아 있으면 차단 보고가 와도 지금 적용으로 바뀌지 않아 runner 에 알리지 않는다(WP-1969). */
  @Test
  void 같은_컨테이너가_일하는_중이면_차단_보고로_runner_에_알리지_않는다() throws Exception {
    OffsetDateTime t1 = OffsetDateTime.now().minusMinutes(10);
    OffsetDateTime t2 = t1.plusMinutes(5);
    seedMerged(t1.minusMinutes(3), t2, "WP-2");
    seedUnapplied(2, 1);
    slots.upsert(agent, "NEW", AgentState.WORKING, "WP-2", null, t2.plusSeconds(5), t2, null);
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
    // 앞 generation 의 차단은 화면에서 이미 가려져 있었지만, 지우면 적용 판정이 지금 → 쉴 때로 내려가 한 번 알린다(WP-2000). 깨우지는 않는다.
    assertThat(runtimeEvents()).isEqualTo(1);
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

  /**
   * 같은 generation 이어도 앞 컨테이너의 늦은 OK 는 새 컨테이너의 차단을 지우지 못한다(WP-1969) — 버린다고 감독 회차가 알 수 있게
   * 409(WP-1968).
   */
  @Test
  void 적용_대기_중에도_앞_컨테이너의_늦은_OK_는_무시한다() throws Exception {
    OffsetDateTime t2 = OffsetDateTime.now().minusMinutes(5);
    seedUnapplied(2, 1);
    seedBlock(1L, t2);

    report(key, okBody(t2.minusMinutes(5), 1)).andExpect(status().isConflict());

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
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-2", null, t2.plusSeconds(5), t2, null);
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
    slots.upsert(agent, "WP", AgentState.WORKING, "WP-1", null, t1.plusSeconds(5), t1, null);
    appEvents.clear();

    report(key, blockedBody(t2)).andExpect(status().isNoContent());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isNull();
    assertThat(desiredEvents()).isZero();
  }

  // ---- WP-1968: 칸 차단 보고를 Pod 정체로 받고, 버림은 409 로 알린다 ----

  /** runner 가 관찰한 Pod 정체(observed_pod_uid)를 직접 심는다 — 칸 보고의 podUid 와 견보기 위해(WP-1968). */
  private void setObservedPodUid(String observedPodUid) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID, observedPodUid)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  /** 바로 앞에 쓰이던 Pod 정체(previous_pod_uid)를 직접 심는다 — 끝나는 중인 옛 Pod 의 늦은 보고를 재현하기 위해(WP-1968 반려 ①). */
  private void setPreviousPodUid(String previousPodUid) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID, previousPodUid)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  /**
   * **지난** Pod(바로 앞 정체)의 OK 는 저장 없이 409 로 거절하고 차단 칸을 비우지 못한다(WP-1968 반려 ①) — 끝나는 중인 옛 Pod 의 늦은 OK 가
   * 지금 Pod 의 차단을 지우면 관리자 화면의 「오류」가 사라져 진입점 오류가 영영 안 보이게 되고, 지금은 204 라 호출하는 감독 회차(gw-boot)가 성공으로 알아채
   * 다시 보내지 않기 때문이다. 지금 정체와 **다른** 보고(재시작 직후 새 Pod)는 409 가 아니라 지금 Pod 로 받아진다 — 아래 {@code
   * 보고가_처음_밝힌_정체는_관찰_없이_지금_Pod_로_받는다}.
   */
  @Test
  void 지난_Pod_의_OK_보고는_409로_거절하고_칸을_비우지_못한다() throws Exception {
    setObservedPodUid("pod-a");
    setPreviousPodUid("pod-b");
    report(key, "{\"state\":\"BLOCKED\",\"message\":\"로그인 오류\",\"podUid\":\"pod-a\"}")
        .andExpect(status().isNoContent());

    report(key, "{\"state\":\"OK\",\"podUid\":\"pod-b\"}").andExpect(status().isConflict());

    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("로그인 오류");
  }

  /**
   * 관찰이 아직 옛 정체를 가리키는 동안에 온 새 Pod 의 첫 보고도 204 로 받아 지금 Pod 로 밝힌다(WP-1968 반려 ①) — runner 관찰(약 60초)을
   * 기다리는 동안 재시작 직후 새 Pod 의 시작 OK 가 OTHER 로 버려져 관리자 화면에 「오류」가 영영 남지 않게 한다. 정체는 지금 정체 → 바로 앞 정체로 미뤄
   * 둔다(지연 도착한 옛 Pod 보고가 되돌리지 못하게). 보고에 Pod 시작 시각을 함께 싣는다 — 시각 없는 모르는 정체는 ADOPT 하지 않기 때문이다(2차 반려 ②,
   * 아래 {@code 시각_없는_모르는_정체는_ADOPT_하지_않고_409로_버린다}). 갈아끼움을 막는 굳힘은 **표시**({@code basisless_pod_uid})가
   * 있는 자리에만 걸린다 — 기준 없이 ADOPT 로만 밝힌 정체 자리(WP-2026 리뷰 반려 ①, 아래 {@code
   * 기준_없는_관찰_정체는_정상_시각의_다른_정체에_갈아끼워지지_않는다}).
   */
  @Test
  void 보고가_처음_밝힌_정체는_관찰_없이_지금_Pod_로_받는다() throws Exception {
    setPodIdentity("pod-a", null, OffsetDateTime.now().minusMinutes(10));
    OffsetDateTime podStart = OffsetDateTime.now().minusMinutes(5).truncatedTo(ChronoUnit.MICROS);

    report(
            key,
            "{\"state\":\"BLOCKED\",\"message\":\"로그인 오류\",\"podUid\":\"pod-b\",\"podStartedAt\":\""
                + podStart
                + "\"}")
        .andExpect(status().isNoContent());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("로그인 오류");
    assertThat(row.get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isEqualTo("pod-a");

    // 그 뒤에 도착한 옛 Pod 의 늦은 OK 는 이제(정체가 밝혀진 뒤) 409 로 거절된다.
    report(key, "{\"state\":\"OK\",\"podUid\":\"pod-a\"}").andExpect(status().isConflict());
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("로그인 오류");
  }

  /**
   * 첫 인식(관찰된 정체가 없음)도 시작 시각을 요구한다(WP-1968 6차 반려 ①) — 시각 없이 ADOPT 하면 그 인식이 기준 없이 박히고, 그 뒤 옛 Pod A 가
   * 시각을 실어 다시 ADOPT 되면 observed=A·previous=B 로 박혀 살아 있는 Pod B 가 영구 OTHER(상태 미저장·칸 409)가 된다 — 이 이슈의
   * 시계가 앞선 경우 그대로. 저장은 하나도 되지 않아 관찰(약 60초)이 정체를 밝힌 뒤의 보고가 이어받는다(HTTP 레벨 방어선 — 저장소 레벨 {@code
   * podIdentity_firstIdentificationRequiresStart} 와 같은 규칙).
   */
  @Test
  void 시각_없는_첫_보고는_ADOPT_하지_않고_409로_버린다() throws Exception {
    setObservedPodUid(null);
    setPreviousPodUid(null);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE, "로그인 오류")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT, OffsetDateTime.now())
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();

    // 관찰된 정체가 없는 첫 보고 — 시작 시각이 없어 인식을 밝히지 못하면 거절한다.
    report(key, "{\"state\":\"BLOCKED\",\"message\":\"로그인 오류\",\"podUid\":\"pod-b\"}")
        .andExpect(status().isConflict());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isNull();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isNull();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("로그인 오류");
  }

  /**
   * 시각이 없는 모르는 정체는 ADOPT 하지 않고 409 로 버린다(WP-1968 2차 반려 ②) — 보고에 시각 자체가 없어 기준 없이 ADOPT 되면 정체가 과거로
   * 되돌아 살아 있는 Pod 가 영원히 previous 로 남는 교착(상태 버림·칸 409 무한)이 생기고 WP-1958 보호도 사라진다. 관찰(약 60초)이 정체를 밝힌 뒤
   * 다시 보내면 MATCH 로 받아진다. 시계 이상으로 걸러진 시각의 보고는 정체 미확정일 때만 ADOPT 로 받아 갈라 두었으므로(WP-2026) 그 경우는 아래
   * {@code 시계_이상으로_걸러진_시각의_첫_칸_보고는_409_없이_204} 테스트가 따로 다룬다.
   */
  @Test
  void 시각_없는_모르는_정체는_ADOPT_하지_않고_409로_버린다() throws Exception {
    setObservedPodUid("pod-a");
    setPreviousPodUid(null);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE, "로그인 오류")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT, OffsetDateTime.now())
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();

    // 시각 없이 정체만 다른 보고 — 정체를 갈아끼우지 않고 거절한다.
    report(key, "{\"state\":\"OK\",\"podUid\":\"pod-b\"}").andExpect(status().isConflict());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("로그인 오류");
    assertThat(row.get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-a");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isNull();
  }

  /**
   * 서버 시각보다 30초 넘게 앞선 Pod 시작(시계 이상)의 첫 칸 보고는 정체 미확정이라도 409 없이 204 로 받아 지금 Pod 로 밝힌다(WP-2026) — 관찰
   * 보고에 정체를 싣지 못하는 구 runner 는 이 조합에서 시작 OK 가 영영 409 로 버려지고 차단 칸이 풀리지 않았다.
   */
  @Test
  void 시계_이상으로_걸러진_시각의_첫_칸_보고는_409_없이_204() throws Exception {
    setObservedPodUid(null);
    setPreviousPodUid(null);
    // 서버 시각보다 40초 앞(30초 여유 밖)의 Pod 시작 — acceptedPodStart 가 걸러 정체 판정에는 시계 이상으로 걸러진 값으로 간다.
    OffsetDateTime skewStart = OffsetDateTime.now().plusSeconds(40);

    report(
            key,
            "{\"state\":\"BLOCKED\",\"message\":\"로그인 오류\",\"podUid\":\"pod-b\",\"podStartedAt\":\""
                + skewStart
                + "\"}")
        .andExpect(status().isNoContent());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("로그인 오류");
    assertThat(row.get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isNull();
    // 시계 이상으로 걸러진 값은 기준으로 오르지 않는다(acceptedPodStart 가 없는 것처럼 다룬 자리).
    assertThat(row.get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNull();

    // 밝힌 정체로 이어지는 다음 보고(정체 일치)는 그대로 받아져 차단을 비운다.
    OffsetDateTime okStart = OffsetDateTime.now().minusMinutes(5).truncatedTo(ChronoUnit.MICROS);
    report(key, "{\"state\":\"OK\",\"podUid\":\"pod-b\",\"podStartedAt\":\"" + okStart + "\"}")
        .andExpect(status().isNoContent());
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
  }

  /**
   * 관찰 정체가 이미 있는 상태에서 다른 정체가 시계 이상 시각을 싣고 오면 그대로 409 로 버린다(WP-2026) — 시계 이상 걸러짐의 ADOPT 는 정체 미확정일 때만
   * 허용이라, 정체를 아는 구간의 교착 방지(5차 반려 ② · 6차 반려 ①)는 그대로다. 애초에 시각이 없는 같은 거절(위 {@code
   * 시각_없는_모르는_정체는_ADOPT_하지_않고_409로_버린다})과 짝을 이뤄, 시각 유무·시계 이상 여부가 아니라 정체 아님을 거절의 기준으로 남긴다.
   */
  @Test
  void 관찰_정체가_있는_상태의_시계_이상_다른_정체_보고는_409() throws Exception {
    setObservedPodUid("pod-b");
    setPreviousPodUid(null);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE, "로그인 오류")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT, OffsetDateTime.now())
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    OffsetDateTime skewStart = OffsetDateTime.now().plusSeconds(40);

    report(key, "{\"state\":\"OK\",\"podUid\":\"pod-a\",\"podStartedAt\":\"" + skewStart + "\"}")
        .andExpect(status().isConflict());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("로그인 오류");
    assertThat(row.get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isNull();
  }

  /**
   * 기준 없이 밝힌 정체는 관찰이 시각을 밝힐 때까지 다른 정체에 갈아끼워지지 않는다(WP-2026 리뷰 반려 ①) — 시계 이상 첫 ADOPT 는 기준(시각)을 세우지 못해
   * {@code isOlderPod} 가 판정하지 못하므로, 그 동안 정상 시각의 다른 정체를 ADOPT 로 받으면 앞서 밝힌 살아 있는 Pod 가 previous 로 박혀
   * 칸 409 루프·상태 미저장의 영구 교착이 다시 열린다. 살아 있는 Pod 의 보고는 그대로 204 로 받아지고, 그 보고가 기준을 채우면 굳힘은 풀려 일반 규칙(이른
   * 정체 거절)으로 돌아온다.
   */
  @Test
  void 기준_없는_관찰_정체는_정상_시각의_다른_정체에_갈아끼워지지_않는다() throws Exception {
    // 1) 시계 이상 첫 보고로 정체만 밝힌다 — 기준(시각)은 그대로 비어 있다.
    OffsetDateTime skewStart = OffsetDateTime.now().plusSeconds(40);
    report(
            key,
            "{\"state\":\"BLOCKED\",\"message\":\"로그인 오류\",\"podUid\":\"pod-new\",\"podStartedAt\":\""
                + skewStart
                + "\"}")
        .andExpect(status().isNoContent());
    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-new");
    assertThat(row.get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNull();

    // 2) 정상 시각의 다른 정체 보고 — 기준이 없어 시각으로 견볼 수 없으므로 ADOPT 로 받지 않고 409 로 거절한다(정체는 그대로, 칸도 그대로).
    OffsetDateTime oldStart = OffsetDateTime.now().minusMinutes(10).truncatedTo(ChronoUnit.MICROS);
    report(key, "{\"state\":\"OK\",\"podUid\":\"pod-old\",\"podStartedAt\":\"" + oldStart + "\"}")
        .andExpect(status().isConflict());
    row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-new");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isNull();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("로그인 오류");

    // 3) 살아 있는 Pod(pod-new)의 보고는 계속 받아져 차단이 풀리고, 정상 시각이면 기준이 채워져 굳힘도 풀린다.
    OffsetDateTime newStart = OffsetDateTime.now().minusMinutes(5).truncatedTo(ChronoUnit.MICROS);
    report(key, "{\"state\":\"OK\",\"podUid\":\"pod-new\",\"podStartedAt\":\"" + newStart + "\"}")
        .andExpect(status().isNoContent());
    row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-new");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(row.get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT).toInstant())
        .isEqualTo(newStart.toInstant());

    // 4) 기준이 채워진 뒤엔 일반 규칙으로 돌아가, 그보다 30초 넘게 이른 옛 정체는 C1 이 409 로 막는다.
    report(
            key,
            "{\"state\":\"BLOCKED\",\"message\":\"늦은 옛 Pod\",\"podUid\":\"pod-old\",\"podStartedAt\":\""
                + oldStart
                + "\"}")
        .andExpect(status().isConflict());
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-new");
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
  }

  /**
   * 시각 없는 관찰 정체 자리의 정상 시각 다른 정체는 204 로 받아 지금 Pod 로 갈아끼운다(WP-2026 리뷰 반려 ②) — 굳힘(barBasislessAdopt)이
   * 「관찰 정체 있음 + 시각 없음」 전체에 걸면 관찰이 정체만 밝히고 시각은 못 밝힌 자리에서 새 Pod 의 정상 시각 보고가 영영 ADOPT 되지 않아 기존 동작이
   * 깨진다. 표시({@code basisless_pod_uid})가 있는 자리에만 막아 두 자리를 갈라 둔다 — 그 표시는 기준 없이 ADOPT 로만 밝힌 정체에 남는다.
   */
  @Test
  void 시각_없는_관찰_정체_자리의_정상_시각_다른_정체는_204로_받는다() throws Exception {
    // 관찰이 정체만 밝힌 자리 — 시작·기준 시각은 그대로 비어 있고 표시도 없다.
    setObservedPodUid("pod-b");
    setPreviousPodUid(null);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE, "로그인 오류")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT, OffsetDateTime.now())
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    OffsetDateTime podStart = OffsetDateTime.now().minusMinutes(5).truncatedTo(ChronoUnit.MICROS);

    // 정상 시각의 다른 정체 보고 — 굳힘에 걸리지 않고 지금 Pod 로 받아 204 다(기존 동작 유지, 반려 ②).
    report(key, "{\"state\":\"OK\",\"podUid\":\"pod-a\",\"podStartedAt\":\"" + podStart + "\"}")
        .andExpect(status().isNoContent());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-a");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isEqualTo("pod-b");
    assertThat(row.get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT).toInstant())
        .isEqualTo(podStart.toInstant());
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    // 기준(시각)이 함께 간 ADOPT 라 표시는 남지 않는다 — 굳힘은 다음 보고에서도 다시 걸리지 않는다.
    assertThat(row.get(AGENT_RUNTIME_SETTING.BASISLESS_POD_UID)).isNull();
  }

  /**
   * 시계 이상 첫 ADOPT 는 <b>보고 기준만</b> 비우고 관찰한 {@code started_at} 은 그대로 두고 표시만 남긴다(WP-2026 3차 반려 ③) — 시작
   * 시각까지 비우면 이른 Pod 거절(C1)이 꺼지고 다음 관찰이 새 Pod 로 판정해 {@code agent_*} 칸을 비운다. 표시 잠금은 이제 서버 시각 60초 창
   * 안에서만 막으므로, 그 안에는 옛 Pod 의 늦은 보고도 정체를 갈아끼우지 못한다. 기준이 함께 간 ADOPT 로 받으면 표시·표시 시각을 모두 지운다.
   */
  @Test
  void 시계_이상_ADOPT_는_보고_기준만_비우고_관찰_시각은_지킨다() throws Exception {
    // ① 의 자리 — 정체는 아직 모르고(관찰·앞 정체 비어 있음) 구 runner 관찰이 옛 Pod 시작(T_a)만 남겨 두었다.
    OffsetDateTime oldStart = OffsetDateTime.now().minusMinutes(10).truncatedTo(ChronoUnit.MICROS);
    setPodIdentity(null, null, oldStart);
    OffsetDateTime skewStart = OffsetDateTime.now().plusSeconds(40);

    // 새 Pod(pod-b)의 시계 이상 첫 칸 보고 — 정체는 밝히되 기준은 비우고 표시만 남긴다.
    report(
            key,
            "{\"state\":\"BLOCKED\",\"message\":\"로그인 오류\",\"podUid\":\"pod-b\",\"podStartedAt\":\""
                + skewStart
                + "\"}")
        .andExpect(status().isNoContent());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isNull();
    // 관찰이 비친 옛 Pod 시작(T_a)은 그대로 두고(3차 반려 ③ — C1 이 늘 서 있도록), 보고 기준만 비운다.
    assertThat(row.get(AGENT_RUNTIME_SETTING.STARTED_AT).toInstant())
        .isEqualTo(oldStart.toInstant());
    assertThat(row.get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT)).isNull();
    assertThat(row.get(AGENT_RUNTIME_SETTING.BASISLESS_POD_UID)).isEqualTo("pod-b");
    assertThat(row.get(AGENT_RUNTIME_SETTING.BASISLESS_MARKED_AT)).isNotNull();

    // 옛 Pod(pod-a)의 늦은 보고({@code T_a}) — 기준이 비어 있어 시각으로 견볼 수 없고 표시가 선 동안이라 정체를 갈아끼우지 못한다.
    report(key, "{\"state\":\"OK\",\"podUid\":\"pod-a\",\"podStartedAt\":\"" + oldStart + "\"}")
        .andExpect(status().isConflict());

    row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-b");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isNull();
    assertThat(row.get(AGENT_RUNTIME_SETTING.BASISLESS_POD_UID)).isEqualTo("pod-b");
  }

  /** 지금 정체·바로 앞 정체·지금 Pod 시작을 한 번에 심는다 — 재시작이 여러 번 지난 상황을 재현하기 위해(WP-1968 반려 C1). */
  private void setPodIdentity(String observed, String previous, OffsetDateTime startedAt) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID, observed)
        .set(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID, previous)
        .set(AGENT_RUNTIME_SETTING.STARTED_AT, startedAt)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  /**
   * 정체를 아직 모르는 첫 OK 도 204 로 받아 차단을 비우되, 지난 상태까지 비우지 않는다(WP-1968 반려 ⑥) — 배포 뒤 `observed_pod_uid` 칸이
   * 아직 비어 있어 첫 보고를 새 Pod 로 오판하면 모든 AI 의 `agent_*` 상태가 한 번에 지워졌다. 정체만 지금 Pod 로 밝히고(previous 는 비워 둔다)
   * 상태는 그대로 둔다.
   */
  @Test
  void 첫_정체를_밝히는_OK는_차단만_비우고_지난_상태는_그대로_둔다() throws Exception {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.AGENT_STATE, "WORKING")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE, "로그인 오류")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT, OffsetDateTime.now())
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();

    OffsetDateTime podStart = OffsetDateTime.now().minusMinutes(5).truncatedTo(ChronoUnit.MICROS);
    report(key, "{\"state\":\"OK\",\"podUid\":\"pod-new\",\"podStartedAt\":\"" + podStart + "\"}")
        .andExpect(status().isNoContent());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-new");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID)).isNull();
    assertThat(row.get(AGENT_RUNTIME_SETTING.AGENT_STATE)).isEqualTo("WORKING");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
  }

  /**
   * 두 세대 전 정체의 늦은 OK 는 409 로 버리되 지금 Pod 보고는 그대로 204 다(WP-1968 반려 C1) — 그 옛 Pod 의 보고를 ADOPT 로 받으면
   * 정체가 과거로 되돌아가 살아 있는 지금 Pod 가 `previous` 로 남아 영원히 OTHER(상태 미저장·칸 409·관찰 필터)가 되는 교착이 생긴다.
   */
  @Test
  void 두_세대_전_정체의_늦은_OK는_409로_버리고_지금_Pod_OK는_204로_받는다() throws Exception {
    OffsetDateTime podStart = OffsetDateTime.now().minusMinutes(5).truncatedTo(ChronoUnit.MICROS);
    OffsetDateTime olderStart =
        OffsetDateTime.now().minusMinutes(30).truncatedTo(ChronoUnit.MICROS);
    setPodIdentity("pod-c", "pod-b", podStart);
    report(
            key,
            "{\"state\":\"BLOCKED\",\"message\":\"로그인 오류\",\"podUid\":\"pod-c\",\"podStartedAt\":\""
                + podStart
                + "\"}")
        .andExpect(status().isNoContent());

    // 두 세대 전 정체(pod-a, 시작이 지금 Pod 보다 이른다)의 늦은 OK — 정체를 되돌리지 않고 409 로 버린다.
    report(key, "{\"state\":\"OK\",\"podUid\":\"pod-a\",\"podStartedAt\":\"" + olderStart + "\"}")
        .andExpect(status().isConflict());
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("로그인 오류");
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-c");

    // 살아 있는 지금 Pod(pod-c)의 OK 는 교착 없이 그대로 받아져 차단이 비워진다.
    report(key, "{\"state\":\"OK\",\"podUid\":\"pod-c\",\"podStartedAt\":\"" + podStart + "\"}")
        .andExpect(status().isNoContent());
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
  }

  /**
   * 낮은 generation 보고는 정체를 ADOPT 하지 않는다(WP-1968 5차 반려 ④) — 몇 초만 살았던 옛 Pod(B)의 늦은 보고가 정체를 되돌리면
   * (observed=B·previous=C) 살아 있는 지금 Pod(C)가 영원히 previous 로 남아 이 뒤의 칸 보고가 계속 409 가 된다. 지금 도는 Pod(관찰
   * generation)의 generation 을 싣고도 정체가 다른 보고는 ADOPT 대신 409 로 버린다 — 정체 갈아끼움도 차단 저장도 없다.
   */
  @Test
  void 낮은_generation_보고는_정체를_ADOPT_하지_않고_409로_버린다() throws Exception {
    long gen = settingOf().get(AGENT_RUNTIME_SETTING.GENERATION);
    // 관찰 generation 은 옛 값(설정이 올라 지금 적용을 기다리는 중)이고, 지금 Pod 로 아는 정체는 살아 있는 C.
    seedUnapplied(gen, gen - 1);
    setObservedPodUid("pod-c");

    // 몇 초만 살았던 옛 Pod B 의 늦은 보고 — 정체도 다르고 generation 도 앞세대다.
    report(
            key,
            "{\"state\":\"BLOCKED\",\"message\":\"옛 Pod 차단\",\"generation\":"
                + (gen - 1)
                + ",\"podStartedAt\":\""
                + OffsetDateTime.now()
                + "\",\"podUid\":\"pod-b\"}")
        .andExpect(status().isConflict());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID)).isEqualTo("pod-c");
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
  }

  /**
   * 「쉴 때 적용」 대기 중(설정 generation 이 앞서고 관찰 generation 은 도는 Pod 값) 정체가 같은 지금 Pod 의 보고는 204 로 받아 칸을
   * 비운다(WP-1968 반려 ⑤·5차 반려 ③) — IDLE 적용을 미뤄 둔 동안 설정 generation 이 오르면 지금 Pod 의 칸 차단 보고가 매 회차 409 를
   * 받아 시작 OK 가 영영 반영되지 않았다. generation 거르기({@code acceptableGeneration})는 정체와 상관없이 같은
   * 기준이라(WP-1969), 관찰 generation 이 맞는 보고만 그 예외로 받는다. 정체를 모르는(옛 플러그인) 보고도 generation 불일치는 조용히 204 로
   * 버린다 — 다시 보내도 성공할 수 없는 버림이라 409 로 알리면 재전송 고리가 된다(2차 반려 ③).
   */
  @Test
  void generation이_뒤처져도_정체가_같으면_204로_받는다() throws Exception {
    setObservedPodUid("pod-a");
    OffsetDateTime t = OffsetDateTime.now().minusMinutes(2).truncatedTo(ChronoUnit.MICROS);
    long podGeneration = settingOf().get(AGENT_RUNTIME_SETTING.GENERATION);
    report(
            key,
            "{\"state\":\"BLOCKED\",\"message\":\"로그인 오류\",\"generation\":"
                + podGeneration
                + ",\"podUid\":\"pod-a\"}")
        .andExpect(status().isNoContent());
    // 설정 generation 한 칸 올려 지금 Pod 보고(그대로)보다 뒤처지게 하고, 관찰 generation 은 도는 Pod 값으로 맞춘다 — 쉴 때 적용
    // 대기(WP-1969 예외).
    seedUnapplied(podGeneration + 1, podGeneration);

    report(
            key,
            "{\"state\":\"OK\",\"podStartedAt\":\""
                + t
                + "\",\"podUid\":\"pod-a\",\"generation\":"
                + podGeneration
                + "}")
        .andExpect(status().isNoContent());
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();

    // 정체를 모르는(옛 이미지) 보고의 generation 불일치는 조용히 204 — 그 이미지는 generation 이 다시 맞을 일이 없어 다시 보내도 성공할 수
    // 없으므로, 409 로 답하면 gw-boot 가 표식 없이 계속 다시 보내는 고리가 된다(WP-1968 2차 반려 ③). 저장도 지우지도 않는다.
    report(key, "{\"state\":\"BLOCKED\",\"message\":\"다시 막힘\",\"generation\":0}")
        .andExpect(status().isNoContent());
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
  }

  /**
   * 정체가 같아도 저장된 기준보다 이른 시작의 보고는 409 로 버리고 칸을 비운다(WP-1968 5차 반려 ②) — 같은 Pod 안 컨테이너 재시작(restartPolicy
   * Always → uid 고정)에서는 정체가 같아도 재시작 전 컨테이너의 늦은 보고가 차단을 덮고 기준을 되돌려 WP-1958 이 회귀한다. 같은 기준(재시작 후
   * 컨테이너)의 보고는 그대로 받아져 차단을 실제로 비운다.
   */
  @Test
  void 정체가_같아도_기준보다_이른_시작_보고는_409로_버린다() throws Exception {
    OffsetDateTime early = OffsetDateTime.now().minusMinutes(2).truncatedTo(ChronoUnit.MICROS);
    OffsetDateTime start = OffsetDateTime.now().truncatedTo(ChronoUnit.MICROS);
    setObservedPodUid("pod-a");
    // 재시작한 컨테이너가 올려 둔 기준(더 늦은 시작) — 정체는 같은 Pod 이지만 앞 컨테이너의 시작은 이전이다.
    setReportedPodStart(start);
    appEvents.clear();

    // 재시작 전 컨테이너의 늦은 OK — 정체가 같아도 시작이 기준보다 이르면 409 로 버린다.
    report(key, "{\"state\":\"OK\",\"podStartedAt\":\"" + early + "\",\"podUid\":\"pod-a\"}")
        .andExpect(status().isConflict());
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    assertThat(runtimeEvents()).isZero();

    // 같은 기준의 보고(재시작 후 컨테이너)는 204 로 받아 차단을 실제로 비운다.
    report(
            key,
            "{\"state\":\"BLOCKED\",\"message\":\"로그인 오류\",\"podStartedAt\":\""
                + start
                + "\",\"podUid\":\"pod-a\"}")
        .andExpect(status().isNoContent());
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isEqualTo("로그인 오류");

    report(key, "{\"state\":\"OK\",\"podStartedAt\":\"" + start + "\",\"podUid\":\"pod-a\"}")
        .andExpect(status().isNoContent());
    assertThat(settingOf().get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
  }

  /**
   * 정체가 같아도 이른 시작의 차단 보고는 409 로 버리고 기준을 되돌리지 못한다(WP-1968 5차 반려 ②) — 같은 Pod 안 컨테이너 재시작에서 재시작 전 컨테이너의
   * 시작이 {@code reported_pod_started_at} 을 덮으면, 그 뒤 재시작 후 컨테이너의 정상 보고가 영영 옛 Pod 로 오판된다.
   */
  @Test
  void 정체가_같아도_이른_시작_차단은_409로_버리고_기준을_되돌리지_못한다() throws Exception {
    OffsetDateTime early = OffsetDateTime.now().minusMinutes(2).truncatedTo(ChronoUnit.MICROS);
    OffsetDateTime start = OffsetDateTime.now().truncatedTo(ChronoUnit.MICROS);
    setObservedPodUid("pod-a");
    setReportedPodStart(start);
    appEvents.clear();

    report(
            key,
            "{\"state\":\"BLOCKED\",\"message\":\"설정 오류\",\"podStartedAt\":\""
                + early
                + "\",\"podUid\":\"pod-a\"}")
        .andExpect(status().isConflict());

    Record row = settingOf();
    assertThat(row.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE)).isNull();
    // 기준이 앞 컨테이너의 시작으로 되돌려지지 않는다.
    assertThat(row.get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT).toInstant())
        .isEqualTo(start.toInstant());
    assertThat(runtimeEvents()).isZero();
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

  /** 관리자 화면 응답을 읽는다 — 사람 인증으로 GET. */
  private ResultActions adminGet() throws Exception {
    useTenant(1L);
    ResultActions r =
        mvc.perform(
            get("/api/v1/admin/agents/" + agent + "/runtime-setting")
                .with(
                    authentication(
                        WebSessionAuth.of(
                            admin, List.of(new SimpleGrantedAuthority("user:write"))))));
    useTenant(1L);
    return r;
  }

  /** runner 토큰으로 관찰 보고를 올린다. */
  private void observe(long generation, String phase) throws Exception {
    useTenant(1L);
    mvc.perform(
            post("/api/v1/agent-runtime/runner/observed")
                .header("Authorization", "Bearer " + runnerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"agents\":[{\"agentUserId\":"
                        + agent
                        + ",\"observedGeneration\":"
                        + generation
                        + ",\"phase\":\""
                        + phase
                        + "\"}]}"))
        .andExpect(status().isOk());
    useTenant(1L);
  }

  /**
   * 저장 → 다시 만듦 → 새 generation 의 진입점 차단 보고 → runner 관찰 순서를 실제 요청으로 따라간다(WP-2000 최종 리뷰) — 차단 보고가 관찰보다
   * 먼저 와도 「쉴 때 적용」·「지금 적용」이 아니라 오류(FAILED)만 보이고, 관찰이 따라온 뒤에도 같다.
   */
  @Test
  void pendingApply_followsSaveRecreateBlockObserveSequence() throws Exception {
    useTenant(1L);
    long old = settingService.start(admin, agent).generation();
    observe(old, "FAILED");

    long next =
        settingService
            .put(
                admin,
                agent,
                new PutAgentRuntimeSettingRequest(
                    "claude-code", null, Map.of("model", "sonnet"), null))
            .generation();
    assertThat(next).isGreaterThan(old);
    adminGet()
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.pendingApply").value("NOW"))
        .andExpect(jsonPath("$.status").value("STARTING"));

    report(key, "{\"state\":\"BLOCKED\",\"message\":\"설정 오류\",\"generation\":" + next + "}")
        .andExpect(status().isNoContent());
    adminGet()
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.pendingApply").doesNotExist())
        .andExpect(jsonPath("$.status").value("FAILED"));

    observe(next, "RUNNING");
    adminGet()
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.pendingApply").doesNotExist())
        .andExpect(jsonPath("$.status").value("FAILED"));
  }
}
