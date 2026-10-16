package com.workplace.filepreview.repository;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Table;
import org.jooq.impl.DSL;

/**
 * {@link PreviewStateStore} 의 공용 jOOQ 구현 — 선점 업서트·기록 CAS SQL 을 한 곳에만 둔다(WP-432).
 *
 * <p>하위 클래스는 테이블과 키 조건·충돌 키·INSERT 키 값만 채운다. 공통 상태 컬럼({@code status, failure_code,
 * failure_transient, attempts, page_count, engine_version, leased_until, updated_at})은 {@link
 * #table()} 에서 이름으로 찾으므로, 대상 테이블은 이 이름·타입을 그대로 가져야 한다.
 *
 * @param <K> 미리보기 상태 행의 키
 */
public abstract class AbstractPreviewStateRepository<K> implements PreviewStateStore<K> {

  protected final DSLContext dsl;

  // 공통 상태 컬럼 — 생성자에서 table() 로부터 한 번만 찾는다(하위 클래스의 table() 은 상수만 돌려줘야 한다).
  private final Field<String> status;
  private final Field<String> failureCode;
  private final Field<Boolean> failureTransient;
  private final Field<Integer> attempts;
  private final Field<String> engineVersion;
  private final Field<Integer> pageCount;
  private final Field<OffsetDateTime> leasedUntil;
  private final Field<OffsetDateTime> updatedAt;

  /** {@link Row} 를 만드는 데 필요한 열. */
  private final List<Field<?>> rowFields;

  protected AbstractPreviewStateRepository(DSLContext dsl) {
    this.dsl = dsl;
    this.status = column("status", String.class);
    this.failureCode = column("failure_code", String.class);
    this.failureTransient = column("failure_transient", Boolean.class);
    this.attempts = column("attempts", Integer.class);
    this.engineVersion = column("engine_version", String.class);
    this.pageCount = column("page_count", Integer.class);
    this.leasedUntil = column("leased_until", OffsetDateTime.class);
    this.updatedAt = column("updated_at", OffsetDateTime.class);
    this.rowFields =
        List.of(
            status,
            failureCode,
            failureTransient,
            attempts,
            engineVersion,
            pageCount,
            leasedUntil,
            updatedAt);
  }

  /** 미리보기 상태 테이블. 생성자에서 불리므로 인스턴스 필드에 의존하지 않는 상수를 돌려줘야 한다. */
  protected abstract Table<?> table();

  /** 키 한 행을 가리키는 조건. */
  protected abstract Condition keyIs(K key);

  /** 선점·TOO_LARGE 업서트의 {@code ON CONFLICT} 대상 열(기본 키). */
  protected abstract List<Field<?>> conflictKeys();

  /** INSERT 때 넣을 키 열 값(테넌트 열 포함). */
  protected abstract Map<Field<?>, Object> keyValues(K key, long tenantId);

  /** markReady 때 공통 열과 함께 SET 할 대상별 열. 기본은 없음. */
  protected Map<Field<?>, Object> readyExtras(K key) {
    return Map.of();
  }

  /** 하위 클래스의 조인 조회가 {@link Row} 를 만들 때 함께 select 할 열. */
  protected final List<Field<?>> rowFields() {
    return rowFields;
  }

  /** {@link #rowFields()} 를 select 한 레코드를 {@link Row} 로 바꾼다. */
  protected final Row toRow(Record r) {
    return new Row(
        r.get(status),
        r.get(failureCode),
        r.get(failureTransient),
        r.get(attempts),
        r.get(engineVersion),
        r.get(pageCount),
        r.get(leasedUntil),
        r.get(updatedAt));
  }

  @Override
  public Optional<Row> find(K key) {
    return dsl.select(rowFields).from(table()).where(keyIs(key)).fetchOptional(this::toRow);
  }

  @Override
  public Optional<Row> findForUpdate(K key) {
    return dsl.select(rowFields)
        .from(table())
        .where(keyIs(key))
        .forUpdate()
        .fetchOptional(this::toRow);
  }

  @Override
  public Optional<OffsetDateTime> claim(
      K key,
      long tenantId,
      String engineVersion,
      Duration lease,
      int maxAttempts,
      Duration transientCooldown,
      boolean allowFailedRetry) {
    // 경합 시 ON CONFLICT 의 WHERE 가 나중 쪽을 걸러 RETURNING 이 비므로 한 쪽만 선점한다.
    // DO UPDATE 의 SET·WHERE 에서 테이블 열은 기존 행, excluded 는 이번에 넣으려던 값이다.
    Condition engineChanged = this.engineVersion.isDistinctFrom(DSL.excluded(this.engineVersion));
    Condition transientAtCap =
        status.eq("FAILED").and(failureTransient.isTrue()).and(attempts.ge(maxAttempts));
    Condition claimable =
        status
            .eq("PENDING")
            .or(status.eq("CONVERTING").and(leasedUntil.lt(DSL.currentOffsetDateTime())))
            .or(status.eq("READY").and(engineChanged));
    if (allowFailedRetry) {
      // 폴링(allowFailedRetry=false)은 FAILED 를 다시 잡지 않는다 — 시도 상한을 폴링 몇 번에 소진하지 않게.
      claimable =
          claimable.or(
              status
                  .eq("FAILED")
                  .and(
                      engineChanged.or(
                          failureTransient
                              .isTrue()
                              .and(
                                  attempts
                                      .lt(maxAttempts)
                                      .or(
                                          updatedAt.lt(
                                              nowPlusMillis(-transientCooldown.toMillis())))))));
    }
    return dsl.insertInto(table())
        .set(keyValues(key, tenantId))
        .set(status, "CONVERTING")
        .set(attempts, 1)
        .set(this.engineVersion, engineVersion)
        .set(leasedUntil, nowPlusMillis(lease.toMillis()))
        .onConflict(conflictKeys())
        .doUpdate()
        .set(status, "CONVERTING")
        // 엔진이 바뀌었거나 일시 실패 상한 뒤 쿨다운으로 다시 잡으면 attempts 를 1 부터 다시 센다.
        .set(
            attempts,
            DSL.when(engineChanged.or(transientAtCap), DSL.val(1)).otherwise(attempts.plus(1)))
        .set(this.engineVersion, DSL.excluded(this.engineVersion))
        .set(leasedUntil, DSL.excluded(leasedUntil))
        .setNull(failureCode)
        .set(failureTransient, false)
        .set(updatedAt, DSL.currentOffsetDateTime())
        .where(claimable)
        .returningResult(leasedUntil)
        .fetchOptional(leasedUntil);
  }

  @Override
  public Optional<OffsetDateTime> refreshLease(K key, OffsetDateTime leaseToken, Duration lease) {
    return dsl.update(table())
        .set(leasedUntil, nowPlusMillis(lease.toMillis()))
        .set(updatedAt, DSL.currentOffsetDateTime())
        .where(holdsLease(key, leaseToken))
        .returningResult(leasedUntil)
        .fetchOptional(leasedUntil);
  }

  @Override
  public boolean isCurrentLease(K key, OffsetDateTime leaseToken) {
    return dsl.fetchExists(
        table(), holdsLease(key, leaseToken).and(leasedUntil.gt(DSL.currentOffsetDateTime())));
  }

  @Override
  public boolean markReady(K key, OffsetDateTime leaseToken, Integer pageCount) {
    return dsl.update(table())
            .set(readyExtras(key))
            .set(status, "READY")
            .set(this.pageCount, pageCount)
            .setNull(failureCode)
            .set(failureTransient, false)
            .setNull(leasedUntil)
            .set(updatedAt, DSL.currentOffsetDateTime())
            .where(holdsLease(key, leaseToken))
            .execute()
        == 1;
  }

  @Override
  public boolean markFailed(
      K key, OffsetDateTime leaseToken, String code, boolean transientFailure) {
    return dsl.update(table())
            .set(status, "FAILED")
            .set(failureCode, code)
            .set(failureTransient, transientFailure)
            .setNull(leasedUntil)
            .set(updatedAt, DSL.currentOffsetDateTime())
            .where(holdsLease(key, leaseToken))
            .execute()
        == 1;
  }

  @Override
  public boolean release(K key, OffsetDateTime leaseToken) {
    return dsl.update(table())
            .set(status, "PENDING")
            .set(attempts, attempts.minus(1))
            .setNull(leasedUntil)
            .set(updatedAt, DSL.currentOffsetDateTime())
            .where(holdsLease(key, leaseToken))
            .execute()
        == 1;
  }

  @Override
  public void resetReady(K key) {
    dsl.update(table())
        .set(status, "PENDING")
        .set(attempts, 0)
        .setNull(pageCount)
        .set(updatedAt, DSL.currentOffsetDateTime())
        .where(keyIs(key).and(status.eq("READY")))
        .execute();
  }

  @Override
  public void markTooLarge(K key, long tenantId, String engineVersion) {
    dsl.insertInto(table())
        .set(keyValues(key, tenantId))
        .set(status, "FAILED")
        .set(failureCode, "TOO_LARGE")
        .set(failureTransient, false)
        .set(this.engineVersion, engineVersion)
        .onConflict(conflictKeys())
        .doUpdate()
        .set(status, "FAILED")
        .set(failureCode, "TOO_LARGE")
        .set(failureTransient, false)
        .set(this.engineVersion, engineVersion)
        .setNull(pageCount)
        .setNull(leasedUntil)
        .set(updatedAt, DSL.currentOffsetDateTime())
        .execute();
  }

  /** 기록 CAS 조건 — 이 토큰으로 선점한 CONVERTING 행일 때만 참. */
  private Condition holdsLease(K key, OffsetDateTime leaseToken) {
    return keyIs(key).and(status.eq("CONVERTING")).and(leasedUntil.eq(leaseToken));
  }

  /** {@code now() + millis} — 리스 만료 시각·쿨다운 기준 시각(음수면 과거)을 DB 시계로 계산한다. */
  private static Field<OffsetDateTime> nowPlusMillis(long millis) {
    return DSL.field(
        "now() + ({0} * interval '1 millisecond')", OffsetDateTime.class, DSL.val(millis));
  }

  /** 테이블에서 공통 상태 열을 이름으로 찾는다. 없으면 대상 테이블 정의가 계약과 다른 것이라 즉시 실패한다. */
  private <T> Field<T> column(String name, Class<T> type) {
    return Objects.requireNonNull(
        table().field(name, type), () -> table().getName() + " 에 " + name + " 열이 없다");
  }
}
