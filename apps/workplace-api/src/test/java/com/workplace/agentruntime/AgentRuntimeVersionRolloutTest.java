package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_LOCATION;
import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.agentruntime.dto.ApplyMode;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.RuntimeVersion;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.agentruntime.service.AgentRuntimeVersionRollout;
import com.workplace.agentruntime.service.AgentRuntimeVersions;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1706 릴리스 버전 기록·조건부 올리기 테스트 — 설정을 저장·켤 때 지금 버전이 적히는지, 기록이 지금과 다를 때만(켜져 있고 한 번 뜬 AI 에 한해)
 * generation 이 한 번 오르는지, 동시에 불러도 한 번만 오르는지를 본다. 이 클래스의 테스트는 테넌트 1 의 {@code claude-code} 템플릿을 쓴다.
 * 롤백되는 테스트가 대부분이고, 동시성 테스트만 커밋한 뒤 직접 지운다.
 */
@Transactional
@RecordApplicationEvents
class AgentRuntimeVersionRolloutTest extends IntegrationTestBase {

  private static final String TEMPLATE = "claude-code";

  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired AgentRuntimeSettingRepository repo;
  @Autowired AgentRuntimeVersions versions;
  @Autowired AgentLocationService locationService;
  @Autowired TenantScopedRunner tenantRunner;
  @Autowired AgentRuntimeVersionRollout rollout;
  @Autowired ApplicationEvents appEvents;
  @Autowired MockMvc mvc;
  @Autowired AgentApiKeyService keyService;

  private RuntimeVersion current() {
    return versions.current(TEMPLATE).orElseThrow();
  }

  /** 가장 최근 fixtures() 가 돌려준 도우미 — 관찰 완료 표시에 쓴다. */
  private AgentRuntimeTestFixtures lastFixtures;

  /** fixtures() 가 만든 실행 위치 — 켜려면 위치가 있어야 한다. */
  private long loc;

  private long location() {
    return loc;
  }

  /** 테넌트 1 에 관리자·실행 위치와 도우미를 만든다. */
  private AgentRuntimeTestFixtures fixtures() {
    TenantContext.set(1L);
    long admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    loc =
        locationService
            .create(admin, new CreateAgentLocationRequest("L-" + admin, null, 5))
            .location()
            .id();
    lastFixtures = new AgentRuntimeTestFixtures(dsl, om, settingService, admin);
    return lastFixtures;
  }

  /** 기록 칸을 DSL 로 직접 쓴다(null 로 지우기 포함). */
  private void record(long agent, String image, String plugin) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.RUNTIME_IMAGE, image)
        .set(AGENT_RUNTIME_SETTING.RUNTIME_PLUGIN_VERSION, plugin)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  private void applyMode(long agent, ApplyMode mode) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.APPLY_MODE, mode.name())
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  private static List<Long> ids(List<Row> rows) {
    return rows.stream().map(Row::agentUserId).toList();
  }

  @Test
  void put_stampsCurrentVersion() {
    long agent = fixtures().newAgent(location());
    assertThat(repo.findRuntimeVersion(agent)).hasValue(current());
  }

  @Test
  void start_stampsCurrentVersion() {
    var fx = fixtures();
    long agent = fx.newAgent(loc);
    record(agent, null, null);
    assertThat(repo.findRuntimeVersion(agent)).isEmpty();
    settingService.start(fx.admin(), agent);
    assertThat(repo.findRuntimeVersion(agent)).hasValue(current());
  }

  @Test
  void setAcceptNewWork_keepsRecordedVersion() {
    var fx = fixtures();
    long agent = fx.runningAgent(loc);
    record(agent, "old@sha256:" + "a".repeat(64), "0.1.0");
    settingService.setAcceptNewWork(fx.admin(), agent, false);
    assertThat(repo.findRuntimeVersion(agent))
        .hasValue(new RuntimeVersion("old@sha256:" + "a".repeat(64), "0.1.0"));
  }

  @Test
  void bump_whenImageDiffers_bumpsIdleKeepsUpdatedBy() {
    var fx = fixtures();
    long agent = fx.runningAgent(loc);
    lastFixtures.observeApplied(agent);
    applyMode(agent, ApplyMode.NOW);
    record(agent, "old@sha256:" + "b".repeat(64), null);
    Row before = repo.find(agent).orElseThrow();
    OffsetDateTime updatedAt = updatedAt(agent);

    List<Row> bumped = repo.bumpForRuntimeVersion(TEMPLATE, current());

    assertThat(ids(bumped)).contains(agent);
    Row after = repo.find(agent).orElseThrow();
    assertThat(after.generation()).isEqualTo(before.generation() + 1);
    assertThat(after.applyMode()).isEqualTo(ApplyMode.IDLE);
    assertThat(updatedBy(agent)).isEqualTo(fx.admin());
    assertThat(updatedAt(agent)).isEqualTo(updatedAt);
    assertThat(repo.findRuntimeVersion(agent)).hasValue(current());
  }

  @Test
  void bump_whenRotation_stampsCurrentVersion() {
    long agent = fixtures().runningAgent(location());
    lastFixtures.observeApplied(agent);
    record(agent, "old@sha256:" + "c".repeat(64), "0.1.0");
    long gen = repo.find(agent).orElseThrow().generation();

    var now = new RuntimeVersion(current().image(), "9.9.9");
    long next = repo.bumpGenerationForRotation(agent, ApplyMode.IDLE, now);

    assertThat(next).isEqualTo(gen + 1);
    assertThat(repo.findRuntimeVersion(agent)).hasValue(now);
  }

  @Test
  void bump_whenSameVersion_returnsNothing() {
    long agent = fixtures().runningAgent(location());
    lastFixtures.observeApplied(agent);
    long gen = repo.find(agent).orElseThrow().generation();

    assertThat(ids(repo.bumpForRuntimeVersion(TEMPLATE, current()))).doesNotContain(agent);
    assertThat(repo.find(agent).orElseThrow().generation()).isEqualTo(gen);
  }

  @Test
  void bump_whenPendingNow_keepsNow() {
    long agent = fixtures().runningAgent(location());
    lastFixtures.observeApplied(agent);
    // 바로 적용이 걸려 있고 아직 반영되지 않은 generation.
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.GENERATION, AGENT_RUNTIME_SETTING.GENERATION.plus(1))
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    applyMode(agent, ApplyMode.NOW);
    record(agent, "old@sha256:" + "c".repeat(64), null);
    long gen = repo.find(agent).orElseThrow().generation();

    assertThat(ids(repo.bumpForRuntimeVersion(TEMPLATE, current()))).contains(agent);
    Row after = repo.find(agent).orElseThrow();
    assertThat(after.generation()).isEqualTo(gen + 1);
    assertThat(after.applyMode()).isEqualTo(ApplyMode.NOW);
  }

  @Test
  void bump_whenStoppedOrNeverLaunched_skipsButRecordOnlyWrites() {
    var fx = fixtures();
    long stopped = fx.newAgent(loc);
    long neverLaunched = fx.runningAgent(loc);
    record(stopped, "old@sha256:" + "d".repeat(64), null);
    record(neverLaunched, "old@sha256:" + "e".repeat(64), null);
    long stoppedGen = repo.find(stopped).orElseThrow().generation();
    long neverGen = repo.find(neverLaunched).orElseThrow().generation();

    assertThat(ids(repo.bumpForRuntimeVersion(TEMPLATE, current())))
        .doesNotContain(stopped, neverLaunched);
    assertThat(repo.recordRuntimeVersion(TEMPLATE, current())).isGreaterThanOrEqualTo(2);

    assertThat(repo.findRuntimeVersion(stopped)).hasValue(current());
    assertThat(repo.findRuntimeVersion(neverLaunched)).hasValue(current());
    assertThat(repo.find(stopped).orElseThrow().generation()).isEqualTo(stoppedGen);
    assertThat(repo.find(neverLaunched).orElseThrow().generation()).isEqualTo(neverGen);
  }

  @Test
  void bump_whenNoRecord_bumps() {
    long agent = fixtures().runningAgent(location());
    lastFixtures.observeApplied(agent);
    record(agent, null, null);
    long gen = repo.find(agent).orElseThrow().generation();

    assertThat(ids(repo.bumpForRuntimeVersion(TEMPLATE, current()))).contains(agent);
    assertThat(repo.find(agent).orElseThrow().generation()).isEqualTo(gen + 1);
    assertThat(ids(repo.bumpForRuntimeVersion(TEMPLATE, current()))).doesNotContain(agent);
  }

  @Test
  void bump_whenPluginVersionUnknown_ignoresPlugin() {
    long agent = fixtures().runningAgent(location());
    lastFixtures.observeApplied(agent);
    record(agent, current().image(), "0.1.50");

    assertThat(
            ids(repo.bumpForRuntimeVersion(TEMPLATE, new RuntimeVersion(current().image(), null))))
        .doesNotContain(agent);
    assertThat(repo.findRuntimeVersion(agent))
        .hasValue(new RuntimeVersion(current().image(), "0.1.50"));
  }

  @Test
  void bump_whenPluginVersionChanged_bumps() {
    long agent = fixtures().runningAgent(location());
    lastFixtures.observeApplied(agent);
    record(agent, current().image(), "0.1.50");
    long gen = repo.find(agent).orElseThrow().generation();

    assertThat(
            ids(
                repo.bumpForRuntimeVersion(
                    TEMPLATE, new RuntimeVersion(current().image(), "0.1.52"))))
        .contains(agent);
    assertThat(repo.find(agent).orElseThrow().generation()).isEqualTo(gen + 1);
    assertThat(repo.findRuntimeVersion(agent))
        .hasValue(new RuntimeVersion(current().image(), "0.1.52"));
  }

  /** 그 위치에 나간 runner 알림 수. */
  private long desiredChanged(long location) {
    return appEvents.stream(AgentRuntimeDesiredChanged.class)
        .filter(e -> e.locationId() == location)
        .count();
  }

  /** 켜고 관찰까지 끝난 AI 에 옛 이미지를 기록해 둔다. */
  private long launchedWithOldImage(AgentRuntimeTestFixtures fx) {
    long agent = fx.runningAgent(loc);
    lastFixtures.observeApplied(agent);
    record(agent, "old@sha256:" + "1".repeat(64), null);
    appEvents.clear();
    return agent;
  }

  @Test
  void rollout_whenSameVersion_keepsGeneration() {
    long agent = fixtures().runningAgent(location());
    lastFixtures.observeApplied(agent);
    long gen = repo.find(agent).orElseThrow().generation();
    appEvents.clear();

    assertThat(rollout.rolloutTenant(1L)).isEmpty();

    assertThat(repo.find(agent).orElseThrow().generation()).isEqualTo(gen);
    assertThat(desiredChanged(location())).isZero();
  }

  @Test
  void rollout_whenImageChanged_bumpsIdleAndNotifiesRunner() {
    var fx = fixtures();
    long agent = launchedWithOldImage(fx);
    long gen = repo.find(agent).orElseThrow().generation();

    assertThat(rollout.rolloutTenant(1L)).containsExactly(agent);

    Row after = repo.find(agent).orElseThrow();
    assertThat(after.generation()).isEqualTo(gen + 1);
    assertThat(after.applyMode()).isEqualTo(ApplyMode.IDLE);
    assertThat(desiredChanged(loc)).isEqualTo(1);
    assertThat(
            appEvents.stream(ResourceChangedEvent.class)
                .filter(e -> "agent-runtime".equals(e.resource()))
                .anyMatch(e -> e.ids().contains(agent)))
        .isTrue();
  }

  @Test
  void rollout_whenPendingNow_keepsNow() {
    var fx = fixtures();
    long agent = launchedWithOldImage(fx);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.GENERATION, AGENT_RUNTIME_SETTING.GENERATION.plus(1))
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    applyMode(agent, ApplyMode.NOW);

    assertThat(rollout.rolloutTenant(1L)).containsExactly(agent);
    assertThat(repo.find(agent).orElseThrow().applyMode()).isEqualTo(ApplyMode.NOW);
  }

  @Test
  void rollout_whenStopped_recordsOnly() {
    var fx = fixtures();
    long agent = fx.newAgent(loc);
    record(agent, "old@sha256:" + "2".repeat(64), null);
    long gen = repo.find(agent).orElseThrow().generation();
    appEvents.clear();

    assertThat(rollout.rolloutTenant(1L)).isEmpty();

    assertThat(repo.find(agent).orElseThrow().generation()).isEqualTo(gen);
    assertThat(repo.findRuntimeVersion(agent)).hasValue(current());
    assertThat(desiredChanged(loc)).isZero();
    assertThat(appEvents.stream(ResourceChangedEvent.class).count()).isZero();
  }

  @Test
  void rollout_whenNeverLaunched_recordsOnly() {
    var fx = fixtures();
    long agent = fx.runningAgent(loc);
    record(agent, "old@sha256:" + "3".repeat(64), null);
    long gen = repo.find(agent).orElseThrow().generation();

    assertThat(rollout.rolloutTenant(1L)).isEmpty();

    assertThat(repo.find(agent).orElseThrow().generation()).isEqualTo(gen);
    assertThat(repo.find(agent).orElseThrow().observedGeneration()).isNull();
    assertThat(repo.findRuntimeVersion(agent)).hasValue(current());
  }

  @Test
  void rollout_whenNoRecord_bumpsOnce() {
    var fx = fixtures();
    long agent = fx.runningAgent(loc);
    lastFixtures.observeApplied(agent);
    record(agent, null, null);
    long gen = repo.find(agent).orElseThrow().generation();

    var first = rollout.rolloutTenant(1L);
    var second = rollout.rolloutTenant(1L);
    assertThat(first).containsExactly(agent);
    assertThat(second).isEmpty();
    assertThat(repo.find(agent).orElseThrow().generation()).isEqualTo(gen + 1);
  }

  @Test
  void rollout_whenTwoAgentsAtSameLocation_notifiesRunnerOnce() {
    var fx = fixtures();
    long a = launchedWithOldImage(fx);
    long b = launchedWithOldImage(fx);

    assertThat(rollout.rolloutTenant(1L)).containsExactlyInAnyOrder(a, b);

    assertThat(desiredChanged(loc)).isEqualTo(1);
  }

  /** AI 키로 상태를 보고한다. */
  private ResultActions report(String key, String body) throws Exception {
    useTenant(1L);
    ResultActions r =
        mvc.perform(
            put("/api/v1/agent-runtime/me/status")
                .header("Authorization", "Bearer " + key)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    useTenant(1L);
    return r;
  }

  @Test
  void statusReport_afterVersionBump_drainsWorkingAgent() throws Exception {
    var fx = fixtures();
    long agent = launchedWithOldImage(fx);
    long gen = repo.find(agent).orElseThrow().generation();
    String key = keyService.issueManaged(agent, 1L, null, null, "L1").plaintext();
    rollout.rolloutTenant(1L);

    report(key, "{\"state\":\"WORKING\",\"issueKey\":\"WD-1\",\"generation\":" + gen + "}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("DRAIN"));
    report(key, "{\"state\":\"IDLE\",\"generation\":" + gen + "}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RESTART"));
  }

  /** 두 호출이 같은 행에 겹쳐도 한 번만 올린다 — 나중 UPDATE 가 앞 트랜잭션의 잠금을 기다렸다가 커밋된 기록으로 WHERE 를 다시 평가해 건너뛴다. */
  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void bump_whenConcurrent_bumpsOnce() throws Exception {
    long[] ids = new long[3]; // [admin, agent, location]
    callInTenant(
        1L,
        () -> {
          var fx = fixtures();
          ids[0] = fx.admin();
          ids[1] = fx.runningAgent(loc);
          ids[2] = loc;
          lastFixtures.observeApplied(ids[1]);
          record(ids[1], "old@sha256:" + "f".repeat(64), null);
          return null;
        });
    long agent = ids[1];
    try {
      long gen = callInTenant(1L, () -> repo.find(agent).orElseThrow().generation());
      CountDownLatch aBumped = new CountDownLatch(1);
      CountDownLatch release = new CountDownLatch(1);
      AtomicReference<List<Row>> aRows = new AtomicReference<>(new ArrayList<>());
      AtomicReference<List<Row>> bRows = new AtomicReference<>(new ArrayList<>());

      CompletableFuture<Void> a =
          CompletableFuture.runAsync(
              () ->
                  tenantRunner.runForTenant(
                      1L,
                      t -> {
                        aRows.set(repo.bumpForRuntimeVersion(TEMPLATE, current()));
                        aBumped.countDown();
                        try {
                          // 커밋 전에 멈춰 행 잠금을 쥔다.
                          if (!release.await(30, TimeUnit.SECONDS)) {
                            throw new AssertionError("release 신호가 오지 않았다");
                          }
                        } catch (InterruptedException e) {
                          Thread.currentThread().interrupt();
                          throw new AssertionError(e);
                        }
                      }));
      assertThat(aBumped.await(30, TimeUnit.SECONDS)).isTrue();
      CompletableFuture<Void> b =
          CompletableFuture.runAsync(
              () ->
                  tenantRunner.runForTenant(
                      1L, t -> bRows.set(repo.bumpForRuntimeVersion(TEMPLATE, current()))));
      // B 는 A 의 행 잠금을 기다리느라 아직 끝나지 않아야 한다.
      Thread.sleep(200);
      assertThat(b.isDone()).isFalse();
      release.countDown();
      a.get(30, TimeUnit.SECONDS);
      b.get(30, TimeUnit.SECONDS);

      assertThat(ids(aRows.get())).contains(agent);
      assertThat(ids(bRows.get())).doesNotContain(agent);
      assertThat(callInTenant(1L, () -> repo.find(agent).orElseThrow().generation()))
          .isEqualTo(gen + 1);
    } finally {
      cleanupInTenant(
          1L,
          () -> {
            dsl.deleteFrom(AGENT_RUNTIME_SETTING)
                .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
                .execute();
            dsl.deleteFrom(AGENT_LOCATION).where(AGENT_LOCATION.ID.eq(ids[2])).execute();
            dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(ids[0], agent)).execute();
          });
      baseDsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(ids[0], agent)).execute();
      baseDsl.deleteFrom(USER).where(USER.ID.in(ids[0], agent)).execute();
    }
  }

  private long updatedBy(long agent) {
    return dsl.select(AGENT_RUNTIME_SETTING.UPDATED_BY)
        .from(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .fetchOne(AGENT_RUNTIME_SETTING.UPDATED_BY);
  }

  private OffsetDateTime updatedAt(long agent) {
    return dsl.select(AGENT_RUNTIME_SETTING.UPDATED_AT)
        .from(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .fetchOne(AGENT_RUNTIME_SETTING.UPDATED_AT);
  }
}
