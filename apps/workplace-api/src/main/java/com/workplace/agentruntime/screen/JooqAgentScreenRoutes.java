package com.workplace.agentruntime.screen;

import static com.workplace.jooq.Tables.AGENT_SCREEN_ROUTE;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashSet;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * {@link AgentScreenRoutes} 의 DB 구현(WP-1978) — agent_screen_route 표로 여러 api 파드가 같은 화면 상태를 본다.
 *
 * <p>판정이 필요한 쓰기({@link #reserve}·{@link #claimInput})는 REQUIRES_NEW 트랜잭션에서 (tenant, agent) 단위
 * advisory 락을 잡고 한 번에 즉시 커밋한다 — 호출자(readOnly 이거나 나중에 롤백될 수 있는 바깥 트랜잭션)와 상태를 분리하고, 다른 파드가 바로 보게 하며,
 * 락을 오래 쥐지 않게 한다. 나머지는 단일 문장이라 원자적이다. 시각 비교는 모두 DB {@code now()} 로 해 파드 사이 시계 차를 무시한다.
 */
@Component
public class JooqAgentScreenRoutes implements AgentScreenRoutes {

  /** advisory 락 클래스 — 2인자 형식으로 다른 락과 공간을 나눈다(이슈 번호). */
  private static final int LOCK_CLASS = 1978;

  private final DSLContext dsl;
  private final TransactionTemplate requiresNew;

  public JooqAgentScreenRoutes(DSLContext dsl, PlatformTransactionManager txManager) {
    this.dsl = dsl;
    this.requiresNew = new TransactionTemplate(txManager);
    this.requiresNew.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  /** DB 시계 기준 임대 만료 시각 — now() + LEASE. */
  private static Field<OffsetDateTime> leaseUntil() {
    return dbNowPlus(LEASE);
  }

  /** DB 시계 기준 now() + d — 파드 시계와 섞지 않게 시각은 모두 DB 에서 만든다. */
  private static Field<OffsetDateTime> dbNowPlus(Duration d) {
    return DSL.field(
        "now() + make_interval(secs => {0})", OffsetDateTime.class, DSL.val(d.toSeconds()));
  }

  private static Route toRoute(Record r) {
    return new Route(
        r.get(AGENT_SCREEN_ROUTE.SESSION_ID),
        r.get(AGENT_SCREEN_ROUTE.TENANT_ID),
        r.get(AGENT_SCREEN_ROUTE.AGENT_USER_ID),
        r.get(AGENT_SCREEN_ROUTE.LOCATION_ID),
        r.get(AGENT_SCREEN_ROUTE.OPENED_BY),
        r.get(AGENT_SCREEN_ROUTE.OWNER_POD_ID),
        r.get(AGENT_SCREEN_ROUTE.OWNER_ADDR));
  }

  /** (tenant, agent) 단위 advisory 락 — 같은 AI 의 동시 예약·입력 켜기를 직렬화한다. 트랜잭션 종료 때 풀린다. */
  private void lockAgent(long tenantId, long agentUserId) {
    dsl.execute(
        "SELECT pg_advisory_xact_lock(?, ?)", LOCK_CLASS, Objects.hash(tenantId, agentUserId));
  }

  @Override
  public boolean reserve(Route route, String ticketHash, Duration ticketTtl, int maxPerAgent) {
    return Boolean.TRUE.equals(
        requiresNew.execute(
            status -> {
              lockAgent(route.tenantId(), route.agentUserId());
              // 죽은 파드가 남긴 임대 지난 행을 지워 상한을 막지 않게 한다.
              dsl.deleteFrom(AGENT_SCREEN_ROUTE)
                  .where(AGENT_SCREEN_ROUTE.TENANT_ID.eq(route.tenantId()))
                  .and(AGENT_SCREEN_ROUTE.AGENT_USER_ID.eq(route.agentUserId()))
                  .and(AGENT_SCREEN_ROUTE.LEASE_UNTIL.le(DSL.currentOffsetDateTime()))
                  .execute();
              int alive =
                  dsl.fetchCount(
                      AGENT_SCREEN_ROUTE,
                      AGENT_SCREEN_ROUTE
                          .TENANT_ID
                          .eq(route.tenantId())
                          .and(AGENT_SCREEN_ROUTE.AGENT_USER_ID.eq(route.agentUserId())));
              if (alive >= maxPerAgent) {
                return false;
              }
              dsl.insertInto(AGENT_SCREEN_ROUTE)
                  .set(AGENT_SCREEN_ROUTE.SESSION_ID, route.sessionId())
                  .set(AGENT_SCREEN_ROUTE.TENANT_ID, route.tenantId())
                  .set(AGENT_SCREEN_ROUTE.AGENT_USER_ID, route.agentUserId())
                  .set(AGENT_SCREEN_ROUTE.LOCATION_ID, route.locationId())
                  .set(AGENT_SCREEN_ROUTE.OPENED_BY, route.openedBy())
                  .set(AGENT_SCREEN_ROUTE.OWNER_POD_ID, route.ownerPodId())
                  .set(AGENT_SCREEN_ROUTE.OWNER_ADDR, route.ownerAddr())
                  .set(AGENT_SCREEN_ROUTE.TICKET_HASH, ticketHash)
                  // 표 만료는 DB 시계로 — consumeTicket 이 DB now() 와 비교하므로(파드 시계 차를 섞지 않게).
                  .set(AGENT_SCREEN_ROUTE.TICKET_EXPIRES_AT, dbNowPlus(ticketTtl))
                  .set(AGENT_SCREEN_ROUTE.LEASE_UNTIL, leaseUntil())
                  .execute();
              return true;
            }));
  }

  @Override
  public Optional<Route> consumeTicket(String ticketHash) {
    // 한 문장 UPDATE ... RETURNING 이라 동시에 두 번 와도 한 번만 성공한다.
    return dsl.update(AGENT_SCREEN_ROUTE)
        .set(AGENT_SCREEN_ROUTE.TICKET_HASH, (String) null)
        .where(AGENT_SCREEN_ROUTE.TICKET_HASH.eq(ticketHash))
        .and(AGENT_SCREEN_ROUTE.TICKET_EXPIRES_AT.gt(DSL.currentOffsetDateTime()))
        .and(AGENT_SCREEN_ROUTE.LEASE_UNTIL.gt(DSL.currentOffsetDateTime()))
        .returning()
        .fetchOptional()
        .map(JooqAgentScreenRoutes::toRoute);
  }

  @Override
  public Optional<Route> find(UUID sessionId) {
    return dsl.selectFrom(AGENT_SCREEN_ROUTE)
        .where(AGENT_SCREEN_ROUTE.SESSION_ID.eq(sessionId))
        .and(AGENT_SCREEN_ROUTE.LEASE_UNTIL.gt(DSL.currentOffsetDateTime()))
        .fetchOptional()
        .map(JooqAgentScreenRoutes::toRoute);
  }

  @Override
  public boolean claimInput(UUID sessionId, long tenantId, long agentUserId) {
    return Boolean.TRUE.equals(
        requiresNew.execute(
            status -> {
              lockAgent(tenantId, agentUserId);
              // 확인과 갱신을 같은 락 안에서 해 두 관리자가 동시에 켜지 못하게 한다.
              if (takenByOther(sessionId, tenantId, agentUserId)) {
                return false;
              }
              // 이 행이 살아 있을 때만 쥔다 — 행이 사라졌거나 임대가 지났으면 영향 행이 0 이라 false(표에 안 적힌 입력을 열지 않게).
              int updated =
                  dsl.update(AGENT_SCREEN_ROUTE)
                      .set(AGENT_SCREEN_ROUTE.INPUT_HOLDER, true)
                      .where(AGENT_SCREEN_ROUTE.SESSION_ID.eq(sessionId))
                      .and(AGENT_SCREEN_ROUTE.LEASE_UNTIL.gt(DSL.currentOffsetDateTime()))
                      .execute();
              return updated == 1;
            }));
  }

  @Override
  public boolean inputTakenByOther(UUID sessionId, long tenantId, long agentUserId) {
    return takenByOther(sessionId, tenantId, agentUserId);
  }

  /** 같은 tenant·agent 의 다른 세션 중 임대가 살아 있고 input_holder 인 행이 있는지. */
  private boolean takenByOther(UUID sessionId, long tenantId, long agentUserId) {
    return dsl.fetchExists(
        AGENT_SCREEN_ROUTE,
        AGENT_SCREEN_ROUTE
            .TENANT_ID
            .eq(tenantId)
            .and(AGENT_SCREEN_ROUTE.AGENT_USER_ID.eq(agentUserId))
            .and(AGENT_SCREEN_ROUTE.SESSION_ID.ne(sessionId))
            .and(AGENT_SCREEN_ROUTE.INPUT_HOLDER.isTrue())
            .and(AGENT_SCREEN_ROUTE.LEASE_UNTIL.gt(DSL.currentOffsetDateTime())));
  }

  @Override
  public void releaseInput(UUID sessionId) {
    dsl.update(AGENT_SCREEN_ROUTE)
        .set(AGENT_SCREEN_ROUTE.INPUT_HOLDER, false)
        .where(AGENT_SCREEN_ROUTE.SESSION_ID.eq(sessionId))
        .execute();
  }

  @Override
  public Set<UUID> renew(String podId, Collection<UUID> ids) {
    if (ids.isEmpty()) {
      return Set.of();
    }
    // 한 문장으로 늘리고 늘어난 id 를 돌려받아, 빠진 id(다른 파드가 만료 행을 지움 등)를 찾는다. 임대가 이미 지난 행은 늘리지 않는다 —
    // 다른 파드의 상한 계산에서 이미 빠졌을 수 있어 되살리면 상한을 넘을 수 있다. 빠진 것으로 돌려줘 중계가 닫게 한다.
    Set<UUID> renewed =
        new HashSet<>(
            dsl.update(AGENT_SCREEN_ROUTE)
                .set(AGENT_SCREEN_ROUTE.LEASE_UNTIL, leaseUntil())
                .where(AGENT_SCREEN_ROUTE.OWNER_POD_ID.eq(podId))
                .and(AGENT_SCREEN_ROUTE.SESSION_ID.in(ids))
                .and(AGENT_SCREEN_ROUTE.LEASE_UNTIL.gt(DSL.currentOffsetDateTime()))
                .returning(AGENT_SCREEN_ROUTE.SESSION_ID)
                .fetch(AGENT_SCREEN_ROUTE.SESSION_ID));
    Set<UUID> missing = new HashSet<>(ids);
    missing.removeAll(renewed);
    return missing;
  }

  @Override
  public void remove(UUID sessionId) {
    dsl.deleteFrom(AGENT_SCREEN_ROUTE).where(AGENT_SCREEN_ROUTE.SESSION_ID.eq(sessionId)).execute();
  }

  @Override
  public void removeByPod(String podId) {
    dsl.deleteFrom(AGENT_SCREEN_ROUTE).where(AGENT_SCREEN_ROUTE.OWNER_POD_ID.eq(podId)).execute();
  }
}
