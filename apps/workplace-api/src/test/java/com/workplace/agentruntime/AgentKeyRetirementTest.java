package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.AGENT_LOCATION;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.outbound.AgentRuntimeChangeNotifier;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.dto.AgentRuntime;
import com.workplace.user.service.UserService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.function.LongConsumer;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1264 키 정리 한 규칙(AgentKeyRetirement) 표 테스트 — 실행 설정의 전이마다 Works 자동 발급 키가 정리 유예로 줄어드는지(retiring_at
 * 이 남는지)를 실제 서비스 경로로 확인한다. 옛 Pod 가 사라지는 전이(끄기·켜진 채 다른 위치로 이동·설정 삭제·「내부 · 기본」 전환·AI 가 떠남)만 줄이고, 설정만
 * 바꿈·켜기·다시 시작·꺼진 채 이동·실제 위치가 같은 위치 지정 변경은 줄이지 않는다.
 */
@Transactional
@RecordApplicationEvents
class AgentKeyRetirementTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired AgentApiKeyRepository keyRepo;
  @Autowired UserService userService;
  @Autowired ApplicationEvents appEvents;

  private long admin;
  private AgentRuntimeTestFixtures fx;
  private long l1;
  private long l2;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    fx = new AgentRuntimeTestFixtures(dsl, om, settingService, admin);
    l1 =
        locationService
            .create(admin, new CreateAgentLocationRequest("L1", null, 5))
            .location()
            .id();
    l2 =
        locationService
            .create(admin, new CreateAgentLocationRequest("L2", null, 5))
            .location()
            .id();
  }

  /**
   * 표 한 줄.
   *
   * @param running 시작 상태가 켜짐인지(false 면 꺼짐)
   * @param locationId 시작 위치 지정(null 이면 기본 위치를 따른다 — 기본은 L1)
   * @param transition 실행 설정 전이
   * @param retires 키가 정리 유예로 줄어야 하는지
   */
  private record Case(
      String name, boolean running, Long locationId, LongConsumer transition, boolean retires) {}

  private PutAgentRuntimeSettingRequest setting(Long locationId, String model) {
    return new PutAgentRuntimeSettingRequest(
        "claude-code", locationId, Map.of("model", model), null);
  }

  /** 각 전이 뒤 키에 정리 유예 표시가 남았는지가 표와 같다. */
  @Test
  void transitions_retireManagedKeysOnlyWhenOldPodDisappears() {
    List<Case> table =
        List.of(
            new Case("끄기", true, null, a -> settingService.stop(admin, a), true),
            new Case(
                "켜진 채 다른 위치로 이동",
                true,
                null,
                a -> settingService.put(admin, a, setting(l2, "opus")),
                true),
            new Case(
                "켜진 채 기본 위치를 직접 지정(실제 위치 같음)",
                true,
                null,
                a -> settingService.put(admin, a, setting(l1, "opus")),
                false),
            new Case(
                "꺼진 채 다른 위치로 이동",
                false,
                null,
                a -> settingService.put(admin, a, setting(l2, "opus")),
                false),
            new Case(
                "켜진 채 설정만 바꿈",
                true,
                null,
                a -> settingService.put(admin, a, setting(null, "sonnet")),
                false),
            new Case("켜기", false, null, a -> settingService.start(admin, a), false),
            new Case("다시 시작", true, null, a -> settingService.restart(admin, a), false),
            new Case("꺼진 AI 의 설정 삭제", false, l2, a -> settingService.delete(admin, a), true),
            new Case(
                "「내부 · 기본」 전환",
                false,
                null,
                a -> userService.setAgentRuntime(admin, a, AgentRuntime.INTERNAL),
                true),
            new Case(
                "꺼진 AI 의 사용 중지",
                false,
                null,
                a -> settingService.stopForRemoval(a, admin, false),
                true),
            new Case(
                "켜진 AI 삭제", true, null, a -> settingService.stopForRemoval(a, admin, true), true));

    for (Case c : table) {
      long agent = c.running() ? fx.runningAgent(c.locationId()) : fx.newAgent(c.locationId());
      long keyId =
          keyRepo.insertManaged(
              agent,
              1L,
              "ak_rt" + agent,
              "hash-rt-" + agent,
              "Works 자동 발급",
              OffsetDateTime.now().plusDays(30),
              null);

      TenantContext.set(1L);
      c.transition().accept(agent);

      OffsetDateTime retiringAt =
          dsl.select(AGENT_API_KEY.RETIRING_AT)
              .from(AGENT_API_KEY)
              .where(AGENT_API_KEY.ID.eq(keyId))
              .fetchOne(AGENT_API_KEY.RETIRING_AT);
      OffsetDateTime expiresAt =
          dsl.select(AGENT_API_KEY.EXPIRES_AT)
              .from(AGENT_API_KEY)
              .where(AGENT_API_KEY.ID.eq(keyId))
              .fetchOne(AGENT_API_KEY.EXPIRES_AT);
      if (c.retires()) {
        assertThat(retiringAt).as(c.name()).isNotNull();
        assertThat(expiresAt)
            .as(c.name())
            .isBefore(OffsetDateTime.now().plusMinutes(5).plusSeconds(5));
      } else {
        assertThat(retiringAt).as(c.name()).isNull();
        assertThat(expiresAt).as(c.name()).isAfter(OffsetDateTime.now().plusDays(29));
      }
    }
  }

  /** 이 AI 의 Works 자동 발급 키 하나를 넣는다(만료 30일 뒤). */
  private long managedKey(long agent) {
    return keyRepo.insertManaged(
        agent,
        1L,
        "ak_rt" + agent,
        "hash-rt-" + agent,
        "Works 자동 발급",
        OffsetDateTime.now().plusDays(30),
        null);
  }

  private OffsetDateTime retiringAtOf(long keyId) {
    return dsl.select(AGENT_API_KEY.RETIRING_AT)
        .from(AGENT_API_KEY)
        .where(AGENT_API_KEY.ID.eq(keyId))
        .fetchOne(AGENT_API_KEY.RETIRING_AT);
  }

  /**
   * 기본 위치를 옮기면 위치를 지정하지 않고 켜진 AI 는 실제 위치가 바뀌어(옛 runner 가 Pod 를 지움) 키가 줄고, 위치를 직접 지정한 켜진 AI·위치를 지정하지
   * 않은 꺼진 AI 는 줄지 않는다. 관리자 화면 알림은 위치 변경 한 건뿐이다(웹이 AI 실행 조회를 모두 다시 읽으므로 AI 별 알림을 더 내지 않는다).
   */
  @Test
  void setDefault_retiresOnlyRunningUnpinnedAgents() {
    long runningUnpinned = fx.runningAgent(null);
    long runningPinned = fx.runningAgent(l1);
    long stoppedUnpinned = fx.newAgent(null);
    long kRunningUnpinned = managedKey(runningUnpinned);
    long kRunningPinned = managedKey(runningPinned);
    long kStoppedUnpinned = managedKey(stoppedUnpinned);
    appEvents.clear();

    TenantContext.set(1L);
    locationService.setDefault(l2);

    assertThat(retiringAtOf(kRunningUnpinned)).as("기본 이동 — 켜진 미지정 AI").isNotNull();
    assertThat(retiringAtOf(kRunningPinned)).as("기본 이동 — 위치를 지정한 AI").isNull();
    assertThat(retiringAtOf(kStoppedUnpinned)).as("기본 이동 — 꺼진 미지정 AI").isNull();
    List<ResourceChangedEvent> events =
        appEvents.stream(ResourceChangedEvent.class)
            .filter(e -> AgentRuntimeChangeNotifier.RESOURCE_AGENT_RUNTIME.equals(e.resource()))
            .toList();
    assertThat(events).hasSize(1);
    assertThat(events.get(0).ids()).isEmpty();
    assertThat(events.get(0).attrs()).containsEntry("locationId", l2);
  }

  /**
   * 옛 기본 위치가 없었으면(데이터로만 생기는 상태 — 기본 위치는 지울 수 없다) 위치를 지정하지 않은 켜진 AI 도 띄워질 곳이 없었으므로 지워질 Pod 가 없다 —
   * 기본을 정해도 키를 줄이지 않는다.
   */
  @Test
  void setDefault_withoutPreviousDefault_doesNotRetire() {
    long runningUnpinned = fx.runningAgent(null);
    long key = managedKey(runningUnpinned);
    dsl.update(AGENT_LOCATION).set(AGENT_LOCATION.IS_DEFAULT, false).execute();

    TenantContext.set(1L);
    locationService.setDefault(l2);

    assertThat(retiringAtOf(key)).isNull();
  }
}
