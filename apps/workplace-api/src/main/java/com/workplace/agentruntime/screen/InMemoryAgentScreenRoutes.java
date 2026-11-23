package com.workplace.agentruntime.screen;

import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * {@link AgentScreenRoutes} 의 메모리 구현(WP-1978) — <b>단위 테스트 전용</b>. DB 없이 {@link AgentScreenRelay} 를
 * 시험할 때만 쓰며 빈으로 등록하지 않는다(운영은 {@link JooqAgentScreenRoutes}). 시계는 앱 시계({@link Instant#now()}), 모든
 * 메서드는 synchronized 맵 한 개를 보호하는 단일 락 아래에서 돈다.
 */
public class InMemoryAgentScreenRoutes implements AgentScreenRoutes {

  /** 행 한 건 — 접속 표·임대·입력 상태까지 가진다. */
  private static final class Row {
    final Route route;
    String ticketHash;
    Instant ticketExpiresAt;
    boolean inputHolder;
    Instant leaseUntil;

    Row(Route route, String ticketHash, Instant ticketExpiresAt) {
      this.route = route;
      this.ticketHash = ticketHash;
      this.ticketExpiresAt = ticketExpiresAt;
      this.leaseUntil = Instant.now().plus(LEASE);
    }

    boolean alive() {
      return leaseUntil.isAfter(Instant.now());
    }
  }

  private final Map<UUID, Row> rows = new LinkedHashMap<>();

  private static boolean sameAgent(Route r, long tenantId, long agentUserId) {
    return r.tenantId() == tenantId && r.agentUserId() == agentUserId;
  }

  @Override
  public synchronized boolean reserve(
      Route route, String ticketHash, Duration ticketTtl, int maxPerAgent) {
    rows.values()
        .removeIf(
            row -> sameAgent(row.route, route.tenantId(), route.agentUserId()) && !row.alive());
    long alive =
        rows.values().stream()
            .filter(row -> sameAgent(row.route, route.tenantId(), route.agentUserId()))
            .count();
    if (alive >= maxPerAgent) {
      return false;
    }
    rows.put(route.sessionId(), new Row(route, ticketHash, Instant.now().plus(ticketTtl)));
    return true;
  }

  @Override
  public synchronized Optional<Route> consumeTicket(String ticketHash) {
    for (Row row : rows.values()) {
      if (ticketHash.equals(row.ticketHash)
          && row.ticketExpiresAt.isAfter(Instant.now())
          && row.alive()) {
        row.ticketHash = null;
        return Optional.of(row.route);
      }
    }
    return Optional.empty();
  }

  @Override
  public synchronized Optional<Route> find(UUID sessionId) {
    Row row = rows.get(sessionId);
    return row != null && row.alive() ? Optional.of(row.route) : Optional.empty();
  }

  @Override
  public synchronized boolean claimInput(UUID sessionId, long tenantId, long agentUserId) {
    if (inputTakenByOther(sessionId, tenantId, agentUserId)) {
      return false;
    }
    Row row = rows.get(sessionId);
    // 이 행이 없거나 임대가 지났으면 쥐지 못한다(Jooq 구현과 같다 — 영향 행 0).
    if (row == null || !row.alive()) {
      return false;
    }
    row.inputHolder = true;
    return true;
  }

  @Override
  public synchronized boolean inputTakenByOther(UUID sessionId, long tenantId, long agentUserId) {
    return rows.values().stream()
        .anyMatch(
            row ->
                sameAgent(row.route, tenantId, agentUserId)
                    && !row.route.sessionId().equals(sessionId)
                    && row.inputHolder
                    && row.alive());
  }

  @Override
  public synchronized void releaseInput(UUID sessionId) {
    Row row = rows.get(sessionId);
    if (row != null) {
      row.inputHolder = false;
    }
  }

  @Override
  public synchronized Set<UUID> renew(String podId, Collection<UUID> ids) {
    Set<UUID> missing = new HashSet<>();
    for (UUID id : ids) {
      Row row = rows.get(id);
      // 임대가 이미 지난 행은 늘리지 않고 빠진 것으로 돌려준다(Jooq 구현과 같다 — 만료 행을 되살리지 않게).
      if (row != null && row.route.ownerPodId().equals(podId) && row.alive()) {
        row.leaseUntil = Instant.now().plus(LEASE);
      } else {
        missing.add(id);
      }
    }
    return missing;
  }

  @Override
  public synchronized void remove(UUID sessionId) {
    rows.remove(sessionId);
  }

  @Override
  public synchronized void removeByPod(String podId) {
    rows.values().removeIf(row -> row.route.ownerPodId().equals(podId));
  }
}
