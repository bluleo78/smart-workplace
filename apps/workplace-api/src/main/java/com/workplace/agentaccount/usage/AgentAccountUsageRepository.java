package com.workplace.agentaccount.usage;

import static com.workplace.jooq.Tables.AGENT_ACCOUNT;
import static com.workplace.jooq.Tables.AGENT_ACCOUNT_BINDING;
import static com.workplace.jooq.Tables.AGENT_ACCOUNT_USAGE;
import static com.workplace.jooq.Tables.AGENT_ACCOUNT_USAGE_CHECK;

import com.workplace.jooq.tables.records.AgentAccountUsageCheckRecord;
import com.workplace.jooq.tables.records.AgentAccountUsageRecord;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 계정 사용량(agent_account_usage·agent_account_usage_check) jOOQ 리포지토리(WP-1449). 창별 최신 스냅샷과 계정별 조회
 * 기록(마지막 시도·성공·실패 이유·임대·마지막 사용 시각)을 다룬다. 테넌트 격리는 RLS + tenant_id GUC DEFAULT 로 보장되므로 RLS 아래에서 도는
 * 메서드는 {@code @Transactional} 안에서 호출된다.
 */
@Repository
@RequiredArgsConstructor
public class AgentAccountUsageRepository {

  /** 마지막 사용 시각을 다시 쓰기 전 최소 간격 — runner /observed 가 자주 불려도 쓰기를 줄인다. */
  private static final Duration LAST_USED_MIN_GAP = Duration.ofMinutes(1);

  private final DSLContext dsl;

  /**
   * 이 계정을 지금 조회할 권한을 원자적으로 잡는다. 조회 기록 행이 없으면 만들고, 있으면 「마지막 시도가 interval 이전」이고 「임대가 없거나 만료」일 때만
   * 갱신한다. 한 문장(INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING)이라 여러 대·여러 회차가 동시에 와도 한쪽만 true 를
   * 받는다. 잡으면 lease_until 을 now()+lease 로 두어 조회가 오래 걸려도 다른 쪽이 끼어들지 않게 한다. 시각은 DB 시계(now())로 판정한다 —
   * 서버 간 시계 차이를 피한다(마지막 시도 시각도 저장 때 DB 시계로 쓴다).
   *
   * <p>간격 판정에는 여유(slack = min(lease, interval/2))를 둔다 — 스케줄러는 직전 회차가 끝난 뒤 interval 만큼 쉬고
   * 돌므로(fixedDelay) 다음 회차의 now() - interval 과 마지막 시도 시각의 차이는 「저장 뒤 회차 끝까지」 몇 ms 뿐이다. 여유가 없으면 그 사이
   * 작은 지연·시계 오차만으로도 선점에 실패해 한 회차를 통째로 건너뛰어 실제 조회 간격이 두 배가 된다. lease 이하로 두어 다른 대의 조회와 겹치지 않고,
   * interval 의 절반 이하로 두어 간격 설정의 뜻을 크게 흐리지 않는다.
   *
   * @return 선점에 성공했는가(false 면 다른 쪽이 조회 중이거나 간격이 안 지남)
   */
  @Transactional
  public boolean tryClaim(long tenantId, long accountId, Duration interval, Duration lease) {
    Duration slack = lease.compareTo(interval.dividedBy(2)) < 0 ? lease : interval.dividedBy(2);
    long dueAfterSeconds = interval.minus(slack).toSeconds();
    long leaseSeconds = lease.toSeconds();
    return dsl.fetchOptional(
            "INSERT INTO agent_account_usage_check (tenant_id, account_id, lease_until) "
                + "VALUES (?, ?, now() + (? * interval '1 second')) "
                + "ON CONFLICT (account_id) DO UPDATE "
                + "SET lease_until = now() + (? * interval '1 second') "
                + "WHERE (agent_account_usage_check.checked_at IS NULL "
                + "  OR agent_account_usage_check.checked_at <= now() - (? * interval '1 second')) "
                + "AND (agent_account_usage_check.lease_until IS NULL "
                + "  OR agent_account_usage_check.lease_until < now()) "
                + "RETURNING account_id",
            tenantId,
            accountId,
            leaseSeconds,
            leaseSeconds,
            dueAfterSeconds)
        .isPresent();
  }

  /**
   * 조회 성공을 저장한다 — 받은 창만 upsert(없는 창은 이전 값 유지)하고 조회 기록 행은 시도·성공 시각을 DB 시계(now())로, 실패 이유를 비우고, 한도 도달
   * 여부를 쓰고, 임대를 푼다. 시도 시각을 DB 시계로 쓰는 까닭은 {@link #tryClaim} 의 간격 판정과 같은 시계를 쓰기 위해서다(앱·DB 시계 차이로 회차를
   * 건너뛰지 않게). 창의 observed_at 은 조회기가 응답을 읽은 시각(앱 시계) 그대로 둔다.
   *
   * @param windows 이번 응답에서 읽은 창들(일부만 있을 수 있다)
   * @param limitReached provider 가 한도 도달을 알렸는가
   */
  @Transactional
  public void saveSuccess(long accountId, List<UsageSnapshot> windows, boolean limitReached) {
    Field<OffsetDateTime> dbNow = DSL.currentOffsetDateTime();
    for (UsageSnapshot w : windows) {
      // 값 칸을 한 번만 만들어 INSERT 와 충돌 시 UPDATE 에 같이 쓴다(칸 목록 중복 방지).
      Map<Field<?>, Object> values = new LinkedHashMap<>();
      values.put(AGENT_ACCOUNT_USAGE.USED_PERCENT, w.usedPercent());
      values.put(AGENT_ACCOUNT_USAGE.RESETS_AT, odt(w.resetsAt()));
      values.put(AGENT_ACCOUNT_USAGE.LIMIT_STATUS, w.limitStatus());
      values.put(AGENT_ACCOUNT_USAGE.OBSERVED_AT, odt(w.observedAt()));
      dsl.insertInto(AGENT_ACCOUNT_USAGE)
          .set(AGENT_ACCOUNT_USAGE.ACCOUNT_ID, accountId)
          .set(AGENT_ACCOUNT_USAGE.WINDOW_KEY, w.window().key())
          .set(values)
          .onConflict(AGENT_ACCOUNT_USAGE.ACCOUNT_ID, AGENT_ACCOUNT_USAGE.WINDOW_KEY)
          .doUpdate()
          .set(values)
          .execute();
    }
    // 키 칸(ACCOUNT_ID)만 INSERT 에 더하고 나머지는 UPDATE 와 공유 — last_used_at 을 덮어쓰지 않으려 칸을 명시한다.
    Map<Field<?>, Object> values = new LinkedHashMap<>();
    values.put(AGENT_ACCOUNT_USAGE_CHECK.CHECKED_AT, dbNow);
    values.put(AGENT_ACCOUNT_USAGE_CHECK.SUCCEEDED_AT, dbNow);
    values.put(AGENT_ACCOUNT_USAGE_CHECK.LIMIT_REACHED, limitReached);
    values.put(AGENT_ACCOUNT_USAGE_CHECK.ERROR_CODE, null);
    values.put(AGENT_ACCOUNT_USAGE_CHECK.ERROR_MESSAGE, null);
    values.put(AGENT_ACCOUNT_USAGE_CHECK.LEASE_UNTIL, null);
    upsertCheck(accountId, values);
  }

  /**
   * 조회 실패를 저장한다 — 스냅샷은 건드리지 않아 마지막 성공 값이 남고, 조회 기록 행만 시도 시각(DB 시계 now() — {@link #saveSuccess} 와 같은
   * 까닭)·실패 이유로 갱신하며 임대를 푼다.
   *
   * @param errorCode 실패 코드(토큰 등 평문 금지)
   * @param errorMessage 짧은 한국어 문구
   */
  @Transactional
  public void saveFailure(long accountId, String errorCode, String errorMessage) {
    Map<Field<?>, Object> values = new LinkedHashMap<>();
    values.put(AGENT_ACCOUNT_USAGE_CHECK.CHECKED_AT, DSL.currentOffsetDateTime());
    values.put(AGENT_ACCOUNT_USAGE_CHECK.ERROR_CODE, errorCode);
    values.put(AGENT_ACCOUNT_USAGE_CHECK.ERROR_MESSAGE, errorMessage);
    values.put(AGENT_ACCOUNT_USAGE_CHECK.LEASE_UNTIL, null);
    upsertCheck(accountId, values);
  }

  /**
   * 조회 기록 행을 upsert 한다 — 행이 없으면 account_id 와 values 로 만들고, 있으면 values 의 칸만 갱신한다. values 에 없는 칸(예:
   * last_used_at)은 건드리지 않는다.
   */
  private void upsertCheck(long accountId, Map<Field<?>, Object> values) {
    dsl.insertInto(AGENT_ACCOUNT_USAGE_CHECK)
        .set(AGENT_ACCOUNT_USAGE_CHECK.ACCOUNT_ID, accountId)
        .set(values)
        .onConflict(AGENT_ACCOUNT_USAGE_CHECK.ACCOUNT_ID)
        .doUpdate()
        .set(values)
        .execute();
  }

  /**
   * 결과를 남기지 않고 임대만 푼다 — 조회 중 계정이 폐기됐거나 원문이 바뀌어 결과를 버릴 때, 또는 조회가 예상 못 한 예외로 끝났을 때 쓴다. 시도 시각은 그대로라 다음
   * 회차가 임대 만료(lease)를 기다리지 않고 바로 다시 잡을 수 있다.
   */
  @Transactional
  public void releaseLease(long accountId) {
    dsl.update(AGENT_ACCOUNT_USAGE_CHECK)
        .setNull(AGENT_ACCOUNT_USAGE_CHECK.LEASE_UNTIL)
        .where(AGENT_ACCOUNT_USAGE_CHECK.ACCOUNT_ID.eq(accountId))
        .execute();
  }

  /**
   * 원문(키)이 바뀐 계정의 사용량을 비운다 — 창 스냅샷을 지우고, 조회 기록 행의 시도·성공 시각·실패 이유를 비우고 한도 도달을 false 로 둔다. 남은 값은 옛 키의
   * 것이라 새 키의 사용률·실패로 보이면 관리자가 잘못 고른다. 시도 시각이 비므로 상태는 「모름(UNKNOWN)」이 되고 다음 회차가 간격을 기다리지 않고 바로 조회한다.
   *
   * <p>마지막 사용 시각(키와 무관한 계정 사용 기록)과 임대(lease_until)는 그대로 둔다 — 옛 키로 도는 조회가 있으면 그 임대가 겹치기를 막고, 그 결과는
   * 수집 서비스의 secret_version 확인으로 버려진 뒤 임대가 풀린다. 원문 교체와 같은 트랜잭션에서 불린다.
   */
  @Transactional
  public void resetForNewSecret(long accountId) {
    dsl.deleteFrom(AGENT_ACCOUNT_USAGE)
        .where(AGENT_ACCOUNT_USAGE.ACCOUNT_ID.eq(accountId))
        .execute();
    dsl.update(AGENT_ACCOUNT_USAGE_CHECK)
        .setNull(AGENT_ACCOUNT_USAGE_CHECK.CHECKED_AT)
        .setNull(AGENT_ACCOUNT_USAGE_CHECK.SUCCEEDED_AT)
        .setNull(AGENT_ACCOUNT_USAGE_CHECK.ERROR_CODE)
        .setNull(AGENT_ACCOUNT_USAGE_CHECK.ERROR_MESSAGE)
        .set(AGENT_ACCOUNT_USAGE_CHECK.LIMIT_REACHED, false)
        .where(AGENT_ACCOUNT_USAGE_CHECK.ACCOUNT_ID.eq(accountId))
        .execute();
  }

  /** 계정별 창 스냅샷 — 계정 id → 스냅샷 목록. 스냅샷이 없는 계정은 빠진다. */
  @Transactional(readOnly = true)
  public Map<Long, List<UsageSnapshot>> findSnapshots(Collection<Long> accountIds) {
    if (accountIds.isEmpty()) return Map.of();
    Map<Long, List<UsageSnapshot>> out = new HashMap<>();
    for (AgentAccountUsageRecord r :
        dsl.selectFrom(AGENT_ACCOUNT_USAGE)
            .where(AGENT_ACCOUNT_USAGE.ACCOUNT_ID.in(accountIds))
            .orderBy(AGENT_ACCOUNT_USAGE.ACCOUNT_ID, AGENT_ACCOUNT_USAGE.WINDOW_KEY)) {
      out.computeIfAbsent(r.getAccountId(), k -> new ArrayList<>())
          .add(
              new UsageSnapshot(
                  UsageWindow.fromKey(r.getWindowKey()),
                  r.getUsedPercent(),
                  instant(r.getResetsAt()),
                  r.getLimitStatus(),
                  instant(r.getObservedAt())));
    }
    return out;
  }

  /** 계정별 조회 기록 — 계정 id → 행. 기록이 없는 계정은 빠진다. */
  @Transactional(readOnly = true)
  public Map<Long, UsageCheckRow> findChecks(Collection<Long> accountIds) {
    if (accountIds.isEmpty()) return Map.of();
    Map<Long, UsageCheckRow> out = new HashMap<>();
    for (AgentAccountUsageCheckRecord r :
        dsl.selectFrom(AGENT_ACCOUNT_USAGE_CHECK)
            .where(AGENT_ACCOUNT_USAGE_CHECK.ACCOUNT_ID.in(accountIds))) {
      out.put(
          r.getAccountId(),
          new UsageCheckRow(
              instant(r.getCheckedAt()),
              instant(r.getSucceededAt()),
              Boolean.TRUE.equals(r.getLimitReached()),
              r.getErrorCode(),
              r.getErrorMessage(),
              instant(r.getLastUsedAt())));
    }
    return out;
  }

  /**
   * 이 AI 들이 묶인(폐기되지 않은) 계정의 마지막 사용 시각을 at 으로 올린다. 조회 기록 행이 없으면 만든다(tenant_id 는 계정 행에서). 기존 값이 at 보다
   * 1분 안쪽으로 최신이면 건너뛰어 runner /observed 의 잦은 호출이 쓰기로 번지지 않게 한다.
   *
   * @return 실제로 쓴(삽입·갱신한) 계정 수
   */
  @Transactional
  public int touchLastUsed(Collection<Long> agentUserIds, Instant at) {
    if (agentUserIds.isEmpty()) return 0;
    OffsetDateTime atOdt = odt(at);
    OffsetDateTime threshold = odt(at.minus(LAST_USED_MIN_GAP));
    return dsl.insertInto(
            AGENT_ACCOUNT_USAGE_CHECK,
            AGENT_ACCOUNT_USAGE_CHECK.TENANT_ID,
            AGENT_ACCOUNT_USAGE_CHECK.ACCOUNT_ID,
            AGENT_ACCOUNT_USAGE_CHECK.LAST_USED_AT)
        .select(
            dsl.selectDistinct(AGENT_ACCOUNT.TENANT_ID, AGENT_ACCOUNT.ID, DSL.val(atOdt))
                .from(AGENT_ACCOUNT_BINDING)
                .join(AGENT_ACCOUNT)
                .on(AGENT_ACCOUNT.ID.eq(AGENT_ACCOUNT_BINDING.ACCOUNT_ID))
                .leftJoin(AGENT_ACCOUNT_USAGE_CHECK)
                .on(AGENT_ACCOUNT_USAGE_CHECK.ACCOUNT_ID.eq(AGENT_ACCOUNT.ID))
                .where(AGENT_ACCOUNT_BINDING.AGENT_USER_ID.in(agentUserIds))
                .and(AGENT_ACCOUNT.REVOKED_AT.isNull())
                // 1분 안에 이미 갱신된 계정은 SELECT 에서 걸러 삽입 시도·충돌·행 잠금이 아예 생기지 않게 한다
                .and(
                    AGENT_ACCOUNT_USAGE_CHECK
                        .LAST_USED_AT
                        .isNull()
                        .or(AGENT_ACCOUNT_USAGE_CHECK.LAST_USED_AT.le(threshold))))
        .onConflict(AGENT_ACCOUNT_USAGE_CHECK.ACCOUNT_ID)
        .doUpdate()
        .set(AGENT_ACCOUNT_USAGE_CHECK.LAST_USED_AT, atOdt)
        // 위 SELECT 와 읽은 뒤 갱신 사이의 경합 방어로 한 번 더 건다
        .where(
            AGENT_ACCOUNT_USAGE_CHECK
                .LAST_USED_AT
                .isNull()
                .or(AGENT_ACCOUNT_USAGE_CHECK.LAST_USED_AT.le(threshold)))
        .execute();
  }

  /** Instant → DB 시각(null 허용). */
  private static OffsetDateTime odt(Instant i) {
    return i == null ? null : i.atOffset(ZoneOffset.UTC);
  }

  /** DB 시각 → Instant(null 허용). */
  private static Instant instant(OffsetDateTime o) {
    return o == null ? null : o.toInstant();
  }
}
