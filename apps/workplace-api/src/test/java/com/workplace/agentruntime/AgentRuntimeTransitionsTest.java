package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.dto.RunnerPrincipal;
import com.workplace.agentruntime.outbound.AgentRuntimeChangeNotifier;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.agentruntime.service.RunnerDesiredStateService;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.dto.AgentRuntime;
import com.workplace.user.service.UserService;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1274 실행 설정 전이의 부수 처리 한곳(AgentRuntimeTransitions) 테스트 — 전이마다 runner 알림(원하는 상태 변경 이벤트)이 영향받는 실제
 * 위치에 한 번씩, 관리자 알림(agent-runtime)이 한 번씩 나가는지를 실제 서비스 경로로 본다. 키 정리는 AgentKeyRetirementTest 가 지킨다.
 */
@Transactional
@RecordApplicationEvents
class AgentRuntimeTransitionsTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired UserService userService;
  @Autowired RunnerDesiredStateService runnerService;
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

  /** 전이 하나의 결과 — runner 에게 알린 위치들과 관리자 알림 종류들. */
  private record Effects(List<Long> runnerLocations, List<String> adminOps) {}

  /** 기록을 비우고 전이를 돌린 뒤 그 사이 나간 알림을 모은다. */
  private Effects effectsOf(Runnable transition) {
    appEvents.clear();
    TenantContext.set(1L);
    transition.run();
    List<Long> runner =
        appEvents.stream(AgentRuntimeDesiredChanged.class)
            .map(AgentRuntimeDesiredChanged::locationId)
            .toList();
    List<String> ops =
        appEvents.stream(ResourceChangedEvent.class)
            .filter(e -> AgentRuntimeChangeNotifier.RESOURCE_AGENT_RUNTIME.equals(e.resource()))
            .map(ResourceChangedEvent::op)
            .toList();
    return new Effects(runner, ops);
  }

  private PutAgentRuntimeSettingRequest put(Long locationId, String model) {
    return new PutAgentRuntimeSettingRequest(
        "claude-code", locationId, Map.of("model", model), null);
  }

  /** 저장·켜기·이동·다시 시작·끄기·꺼진 채 이동·삭제 — 전이마다 runner·관리자 알림이 한 번씩, 바뀐 것이 없으면 아무것도 나가지 않는다. */
  @Test
  void settingTransitions_notifyRunnerAndAdminOncePerTransition() {
    long agent =
        TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));

    // 새 행은 꺼진 채라 runner 는 알 것이 없다.
    assertThat(effectsOf(() -> settingService.put(admin, agent, put(l1, "opus"))))
        .isEqualTo(new Effects(List.of(), List.of("created")));
    assertThat(effectsOf(() -> settingService.put(admin, agent, put(l1, "opus"))))
        .isEqualTo(new Effects(List.of(), List.of()));
    assertThat(effectsOf(() -> settingService.start(admin, agent)))
        .isEqualTo(new Effects(List.of(l1), List.of("updated")));
    assertThat(effectsOf(() -> settingService.start(admin, agent)))
        .isEqualTo(new Effects(List.of(), List.of()));
    // 켜진 채 다른 위치로 — 옛 위치(지우기)와 새 위치(띄우기) 모두에.
    assertThat(effectsOf(() -> settingService.put(admin, agent, put(l2, "opus"))))
        .isEqualTo(new Effects(List.of(l1, l2), List.of("updated")));
    // 켜진 채 설정만 — 같은 위치에 한 번.
    assertThat(effectsOf(() -> settingService.put(admin, agent, put(l2, "sonnet"))))
        .isEqualTo(new Effects(List.of(l2), List.of("updated")));
    assertThat(effectsOf(() -> settingService.restart(admin, agent)))
        .isEqualTo(new Effects(List.of(l2), List.of("updated")));
    assertThat(effectsOf(() -> settingService.stop(admin, agent)))
        .isEqualTo(new Effects(List.of(l2), List.of("updated")));
    assertThat(effectsOf(() -> settingService.stop(admin, agent)))
        .isEqualTo(new Effects(List.of(), List.of()));
    // 꺼진 채 위치 변경도 generation 이 오르므로 전·후 위치에 알린다(runner 는 다시 받아 볼 뿐이다).
    assertThat(effectsOf(() -> settingService.put(admin, agent, put(l1, "sonnet"))))
        .isEqualTo(new Effects(List.of(l2, l1), List.of("updated")));
    assertThat(effectsOf(() -> settingService.delete(admin, agent)))
        .isEqualTo(new Effects(List.of(), List.of("deleted")));
  }

  /** AI 삭제·사용 중지 — 켜져 있었으면 그 위치 runner 에 한 번. 꺼진 AI 의 사용 중지는 아무것도 알리지 않는다. */
  @Test
  void removal_notifiesRunnerOnlyWhenRunningAndAdminByOutcome() {
    long runningDeleted = fx.runningAgent(l2);
    long runningSuspended = fx.runningAgent(null); // 기본 위치(L1)를 따른다
    long stoppedDeleted = fx.newAgent(l2);
    long stoppedSuspended = fx.newAgent(l2);

    assertThat(effectsOf(() -> settingService.stopForRemoval(runningDeleted, admin, true)))
        .isEqualTo(new Effects(List.of(l2), List.of("deleted")));
    assertThat(effectsOf(() -> settingService.stopForRemoval(runningSuspended, null, false)))
        .isEqualTo(new Effects(List.of(l1), List.of("updated")));
    assertThat(effectsOf(() -> settingService.stopForRemoval(stoppedDeleted, admin, true)))
        .isEqualTo(new Effects(List.of(), List.of("deleted")));
    assertThat(effectsOf(() -> settingService.stopForRemoval(stoppedSuspended, null, false)))
        .isEqualTo(new Effects(List.of(), List.of()));
  }

  /** 「내부 · 기본」 전환 — 꺼진 행이 지워지고 관리자에게 「지워짐」 한 번, runner 는 알 것이 없다. */
  @Test
  void internalSwitch_deletesStoppedSettingWithSingleAdminNotice() {
    long agent = fx.newAgent(l1);
    assertThat(effectsOf(() -> userService.setAgentRuntime(admin, agent, AgentRuntime.INTERNAL)))
        .isEqualTo(new Effects(List.of(), List.of("deleted")));
  }

  /**
   * WP-1287 — 기본 위치를 따르는 AI 와 직접 고른 AI 모두, 설정 변경·키 교체·기본 위치 변경 때 runner 알림이 영향받는 실제 위치에 한 번씩 나간다.
   * 호출자가 실제 위치를 해석하던 때는 기본을 따르는 AI 만 규칙 변경에 소리 없이 빠질 수 있었다.
   */
  @Test
  void defaultFollowingAndAssignedAgents_notifyRunnerOnceForSettingKeyAndDefaultChanges() {
    long following = fx.runningAgent(null); // 기본 위치(L1)를 따른다
    long assigned = fx.runningAgent(l2);

    // 설정 변경 — 각자 실제 위치에 한 번.
    assertThat(effectsOf(() -> settingService.put(admin, following, put(null, "sonnet"))))
        .isEqualTo(new Effects(List.of(l1), List.of("updated")));
    assertThat(effectsOf(() -> settingService.put(admin, assigned, put(l2, "sonnet"))))
        .isEqualTo(new Effects(List.of(l2), List.of("updated")));

    // 키 교체 — 첫 발급은 generation 을 올리지 않고, 쓰인 키를 바꾸면 그 위치에 한 번.
    assertThat(effectsOf(() -> rotateKey(following, l1)))
        .isEqualTo(new Effects(List.of(l1), List.of("updated")));
    assertThat(effectsOf(() -> rotateKey(assigned, l2)))
        .isEqualTo(new Effects(List.of(l2), List.of("updated")));

    // 기본 위치 변경 — 옛 기본·새 기본에 한 번씩(직접 고른 AI 는 영향이 없어 더 늘지 않는다).
    assertThat(effectsOf(() -> locationService.setDefault(l2)).runnerLocations())
        .containsExactly(l1, l2);
  }

  /**
   * WP-1287 — 기본 위치를 따르는 꺼진 AI 도 삭제·「내부 · 기본」 전환·AI 삭제·사용 중지가 막힘 없이 지나간다(전이가 이제 기본 위치를 직접 읽는다).
   * runner 는 알 것이 없고 관리자 알림만 결과대로 나간다.
   */
  @Test
  void stoppedDefaultFollowingAgent_removalPathsNotifyAdminOnly() {
    long deleted = fx.newAgent(null);
    long switched = fx.newAgent(null);
    long removed = fx.newAgent(null);
    long suspended = fx.newAgent(null);

    assertThat(effectsOf(() -> settingService.delete(admin, deleted)))
        .isEqualTo(new Effects(List.of(), List.of("deleted")));
    assertThat(effectsOf(() -> userService.setAgentRuntime(admin, switched, AgentRuntime.INTERNAL)))
        .isEqualTo(new Effects(List.of(), List.of("deleted")));
    assertThat(effectsOf(() -> settingService.stopForRemoval(removed, admin, true)))
        .isEqualTo(new Effects(List.of(), List.of("deleted")));
    assertThat(effectsOf(() -> settingService.stopForRemoval(suspended, null, false)))
        .isEqualTo(new Effects(List.of(), List.of()));
  }

  /** 키를 한 번 받고 그 generation 을 runner 가 관찰했다고 적은 뒤 기록을 비우고 다시 받는다 — 두 번째가 교체다. */
  private void rotateKey(long agent, long location) {
    RunnerPrincipal runner = new RunnerPrincipal(1L, location);
    runnerService.issueAgentKey(runner, agent);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION, fx.generationOf(agent))
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    appEvents.clear();
    runnerService.issueAgentKey(runner, agent);
  }
}
