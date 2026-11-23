package com.workplace.agentruntime.screen;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.agentruntime.screen.AgentScreenRoutes.Route;
import com.workplace.jooq.Tables;
import com.workplace.support.IntegrationTestBase;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * AI 작업 화면 공유 경로 저장소 검증(WP-1978) — 전역 표 agent_screen_route 를 여러 파드가 함께 보는 상한·접속 표·입력 중 판정. 커밋되는 시드를
 * 쓰므로 각 테스트가 끝나면 만든 행을 지운다.
 */
class JooqAgentScreenRoutesTest extends IntegrationTestBase {

  @Autowired JooqAgentScreenRoutes routes;
  @Autowired DSLContext dsl;

  /** 테스트 간 충돌을 피하는 큰 랜덤 tenant·agent. */
  private final long tenant = 2_000_000_000L + ThreadLocalRandom.current().nextLong(1_000_000_000L);

  private final long agent = 5_000L + ThreadLocalRandom.current().nextLong(1_000_000L);

  @AfterEach
  void cleanup() {
    dsl.deleteFrom(Tables.AGENT_SCREEN_ROUTE)
        .where(Tables.AGENT_SCREEN_ROUTE.TENANT_ID.eq(tenant))
        .execute();
  }

  private Route route(long agentId, String podId) {
    return new Route(UUID.randomUUID(), tenant, agentId, 7L, 11L, podId, podId + ":6060");
  }

  private boolean reserve(Route r, String hash) {
    return routes.reserve(r, hash, Duration.ofSeconds(30), 3);
  }

  private String hash() {
    return UUID.randomUUID().toString().replace("-", "");
  }

  @Test
  void reserve_limitCountsAllPods() {
    assertThat(reserve(route(agent, "pod-a"), hash())).isTrue();
    assertThat(reserve(route(agent, "pod-b"), hash())).isTrue();
    assertThat(reserve(route(agent, "pod-c"), hash())).isTrue();
    assertThat(reserve(route(agent, "pod-a"), hash())).isFalse();
    // 다른 AI 는 따로 센다.
    assertThat(reserve(route(agent + 1, "pod-a"), hash())).isTrue();
  }

  @Test
  void reserve_ignoresExpiredLease() {
    Route first = route(agent, "pod-a");
    assertThat(reserve(first, hash())).isTrue();
    assertThat(reserve(route(agent, "pod-b"), hash())).isTrue();
    assertThat(reserve(route(agent, "pod-c"), hash())).isTrue();
    dsl.update(Tables.AGENT_SCREEN_ROUTE)
        .set(
            Tables.AGENT_SCREEN_ROUTE.LEASE_UNTIL,
            OffsetDateTime.now(ZoneOffset.UTC).minusSeconds(5))
        .where(Tables.AGENT_SCREEN_ROUTE.SESSION_ID.eq(first.sessionId()))
        .execute();
    assertThat(reserve(route(agent, "pod-d"), hash())).isTrue();
    assertThat(
            dsl.fetchExists(
                Tables.AGENT_SCREEN_ROUTE,
                Tables.AGENT_SCREEN_ROUTE.SESSION_ID.eq(first.sessionId())))
        .isFalse();
  }

  @Test
  void consumeTicket_onlyOnce() {
    Route r = route(agent, "pod-a");
    String h = hash();
    reserve(r, h);
    assertThat(routes.consumeTicket(h)).contains(r);
    assertThat(routes.consumeTicket(h)).isEmpty();
    // 표를 써도 행은 살아 있다.
    assertThat(routes.find(r.sessionId())).contains(r);
  }

  @Test
  void consumeTicket_rejectsExpired() {
    Route r = route(agent, "pod-a");
    String h = hash();
    routes.reserve(r, h, Duration.ofSeconds(-1), 3);
    assertThat(routes.consumeTicket(h)).isEmpty();
  }

  /** 표 만료는 DB 시계(now() + ttl)로 적힌다 — consumeTicket 이 DB now() 와 비교하므로 앱 시계를 섞지 않는다(WP-1978 리뷰). */
  @Test
  void reserve_ticketExpiresAtUsesDbClock() {
    Route r = route(agent, "pod-a");
    reserve(r, hash());
    Integer secs =
        dsl.select(
                org.jooq.impl.DSL.field(
                    "extract(epoch from (ticket_expires_at - now()))::int", Integer.class))
            .from(Tables.AGENT_SCREEN_ROUTE)
            .where(Tables.AGENT_SCREEN_ROUTE.SESSION_ID.eq(r.sessionId()))
            .fetchOne(0, Integer.class);
    assertThat(secs).isBetween(28, 30);
  }

  /** 이 행이 없거나 임대가 지났으면 입력을 쥐지 못한다 — 표에 적히지 않은 입력을 열지 않게(WP-1978 리뷰). */
  @Test
  void claimInput_missingOrExpiredRow_returnsFalse() {
    assertThat(routes.claimInput(UUID.randomUUID(), tenant, agent)).isFalse();

    Route expired = route(agent, "pod-a");
    reserve(expired, hash());
    dsl.update(Tables.AGENT_SCREEN_ROUTE)
        .set(
            Tables.AGENT_SCREEN_ROUTE.LEASE_UNTIL,
            OffsetDateTime.now(ZoneOffset.UTC).minusSeconds(5))
        .where(Tables.AGENT_SCREEN_ROUTE.SESSION_ID.eq(expired.sessionId()))
        .execute();
    assertThat(routes.claimInput(expired.sessionId(), tenant, agent)).isFalse();
    assertThat(
            dsl.select(Tables.AGENT_SCREEN_ROUTE.INPUT_HOLDER)
                .from(Tables.AGENT_SCREEN_ROUTE)
                .where(Tables.AGENT_SCREEN_ROUTE.SESSION_ID.eq(expired.sessionId()))
                .fetchOne(Tables.AGENT_SCREEN_ROUTE.INPUT_HOLDER))
        .isFalse();
  }

  @Test
  void claimInput_exclusivePerAgent() {
    Route a = route(agent, "pod-a");
    Route b = route(agent, "pod-b");
    Route other = route(agent + 1, "pod-a");
    reserve(a, hash());
    reserve(b, hash());
    reserve(other, hash());
    assertThat(routes.claimInput(a.sessionId(), tenant, agent)).isTrue();
    assertThat(routes.claimInput(b.sessionId(), tenant, agent)).isFalse();
    assertThat(routes.inputTakenByOther(b.sessionId(), tenant, agent)).isTrue();
    assertThat(routes.inputTakenByOther(a.sessionId(), tenant, agent)).isFalse();
    // 다른 AI 는 영향 없음.
    assertThat(routes.claimInput(other.sessionId(), tenant, agent + 1)).isTrue();
    routes.releaseInput(a.sessionId());
    assertThat(routes.claimInput(b.sessionId(), tenant, agent)).isTrue();
  }

  @Test
  void renew_returnsMissing() {
    Route keep = route(agent, "pod-a");
    Route gone = route(agent, "pod-a");
    reserve(keep, hash());
    reserve(gone, hash());
    routes.remove(gone.sessionId());
    dsl.update(Tables.AGENT_SCREEN_ROUTE)
        .set(
            Tables.AGENT_SCREEN_ROUTE.LEASE_UNTIL,
            OffsetDateTime.now(ZoneOffset.UTC).plusSeconds(5))
        .where(Tables.AGENT_SCREEN_ROUTE.SESSION_ID.eq(keep.sessionId()))
        .execute();
    Set<UUID> missing = routes.renew("pod-a", List.of(keep.sessionId(), gone.sessionId()));
    assertThat(missing).containsExactly(gone.sessionId());
    OffsetDateTime lease =
        dsl.select(Tables.AGENT_SCREEN_ROUTE.LEASE_UNTIL)
            .from(Tables.AGENT_SCREEN_ROUTE)
            .where(Tables.AGENT_SCREEN_ROUTE.SESSION_ID.eq(keep.sessionId()))
            .fetchOne(Tables.AGENT_SCREEN_ROUTE.LEASE_UNTIL);
    assertThat(lease).isAfter(OffsetDateTime.now(ZoneOffset.UTC).plusSeconds(60));
  }

  /** 임대가 이미 지난 행은 늘리지 않고 빠진 것으로 돌려준다 — 다른 파드가 상한 계산에서 지웠을 수 있는 행을 되살리지 않게(중계가 닫는다). */
  @Test
  void renew_expiredRowReportedMissing() {
    Route expired = route(agent, "pod-a");
    reserve(expired, hash());
    dsl.update(Tables.AGENT_SCREEN_ROUTE)
        .set(
            Tables.AGENT_SCREEN_ROUTE.LEASE_UNTIL,
            OffsetDateTime.now(ZoneOffset.UTC).minusSeconds(5))
        .where(Tables.AGENT_SCREEN_ROUTE.SESSION_ID.eq(expired.sessionId()))
        .execute();

    Set<UUID> missing = routes.renew("pod-a", List.of(expired.sessionId()));

    assertThat(missing).containsExactly(expired.sessionId());
    assertThat(routes.find(expired.sessionId())).isEmpty();
  }

  /** 임대 지난 행은 AI 와 상관없이 모두 지우고, 살아 있는 행은 남긴다(WP-1978 리뷰 후속 ④). */
  @Test
  void removeExpired_removesExpiredRowsOfAllAgents() {
    Route alive = route(agent, "pod-a");
    Route deadSame = route(agent, "pod-b");
    Route deadOther = route(agent + 1, "pod-c");
    reserve(alive, hash());
    reserve(deadSame, hash());
    reserve(deadOther, hash());
    dsl.update(Tables.AGENT_SCREEN_ROUTE)
        .set(
            Tables.AGENT_SCREEN_ROUTE.LEASE_UNTIL,
            OffsetDateTime.now(ZoneOffset.UTC).minusSeconds(5))
        .where(Tables.AGENT_SCREEN_ROUTE.SESSION_ID.in(deadSame.sessionId(), deadOther.sessionId()))
        .execute();

    assertThat(routes.removeExpired()).isGreaterThanOrEqualTo(2);

    assertThat(
            dsl.fetchCount(
                Tables.AGENT_SCREEN_ROUTE, Tables.AGENT_SCREEN_ROUTE.TENANT_ID.eq(tenant)))
        .isEqualTo(1);
    assertThat(routes.find(alive.sessionId())).contains(alive);
  }

  @Test
  void removeByPod_onlyThatPod() {
    Route a = route(agent, "pod-a");
    Route b = route(agent, "pod-b");
    reserve(a, hash());
    reserve(b, hash());
    routes.removeByPod("pod-a");
    assertThat(routes.find(a.sessionId())).isEmpty();
    assertThat(routes.find(b.sessionId())).contains(b);
  }
}
