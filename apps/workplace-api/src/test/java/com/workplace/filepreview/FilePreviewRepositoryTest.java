package com.workplace.filepreview;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_PREVIEW;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.filepreview.repository.FilePreviewRepository;
import com.workplace.filepreview.repository.FilePreviewRepository.Row;
import com.workplace.support.IntegrationTestBase;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 문서 미리보기 상태 저장소(WP-431) 통합 테스트 — CAS 선점(리스·재시도 상한·엔진 버전)·리스 토큰 기록·RLS·CASCADE.
 *
 * <p>클래스 레벨 {@code @Transactional} 을 두지 않고 기본 테넌트(1)와 다른 fixture 테넌트에 커밋한다 — 변환 작업은 비동기 실행기에서 돌아
 * 테스트 DB 기본 GUC=1 이 테넌트 GUC 결함을 가릴 수 있어서다(WP-417, {@code DriveFileTextTest} 패턴).
 */
class FilePreviewRepositoryTest extends IntegrationTestBase {

  private static final String FIXTURE_TENANT_SLUG = "file-preview-rls-fixture-tenant";
  private static final Duration LEASE = Duration.ofMinutes(3);
  private static final int MAX_ATTEMPTS = 3;
  private static final Duration COOLDOWN = Duration.ofMinutes(10);

  @Autowired DSLContext dsl;
  @Autowired FilePreviewRepository repo;
  @Autowired PlatformTransactionManager txManager;

  // @AfterEach 정리용 — 시드에서 채운다.
  private Long tid2;
  private Long userId;
  private Long fileId;

  @BeforeEach
  void seed() {
    inTenantTx(
        () -> {
          String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
          userId =
              dsl.insertInto(USER)
                  .set(USER.USERNAME, "pv_" + suffix)
                  .set(USER.PASSWORD, "pw")
                  .set(USER.NAME, "pv_" + suffix)
                  .set(USER.EMAIL, "pv_" + suffix + "@example.com")
                  .returning(USER.ID)
                  .fetchOne()
                  .getId();
          fileId =
              dsl.insertInto(FILE)
                  .set(FILE.ORIGINAL_NAME, "보고서.hwp")
                  .set(FILE.STORED_NAME, "stored_" + suffix)
                  .set(FILE.MIME_TYPE, "application/x-hwp")
                  .set(FILE.SIZE_BYTES, 100L)
                  .set(FILE.STORAGE_PATH, "wp431-preview/" + suffix + "/report.hwp")
                  .set(FILE.UPLOADED_BY, userId)
                  .returning(FILE.ID)
                  .fetchOne()
                  .getId();
          return null;
        });
  }

  @AfterEach
  void cleanup() {
    if (tid2 == null) {
      return;
    }
    inTenantTx(
        () -> {
          // FK 순서: FILE_PREVIEW(CASCADE 이지만 명시) → FILE → USER
          dsl.deleteFrom(FILE_PREVIEW).where(FILE_PREVIEW.FILE_ID.eq(fileId)).execute();
          dsl.deleteFrom(FILE).where(FILE.ID.eq(fileId)).execute();
          dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
          return null;
        });
    tid2 = null;
  }

  @Test
  void 행이_없으면_선점되고_attempts_는_1() {
    Optional<OffsetDateTime> token = claim("v1", true);

    assertThat(token).isPresent();
    Row row = find().orElseThrow();
    assertThat(row.status()).isEqualTo("CONVERTING");
    assertThat(row.attempts()).isEqualTo(1);
    assertThat(row.engineVersion()).isEqualTo("v1");
    assertThat(row.leasedUntil()).isEqualTo(token.get());
  }

  @Test
  void CONVERTING_중이면_다시_선점되지_않는다() {
    assertThat(claim("v1", true)).isPresent();

    assertThat(claim("v1", true)).isEmpty();
    assertThat(find().orElseThrow().attempts()).isEqualTo(1);
  }

  @Test
  void 리스_만료된_CONVERTING_은_다시_선점된다() {
    assertThat(claim("v1", true)).isPresent();
    expireLease();

    Optional<OffsetDateTime> again = claim("v1", true);

    assertThat(again).isPresent();
    Row row = find().orElseThrow();
    assertThat(row.status()).isEqualTo("CONVERTING");
    assertThat(row.attempts()).isEqualTo(2);
    assertThat(row.leasedUntil()).isAfter(OffsetDateTime.now());
  }

  @Test
  void 영구_FAILED_는_같은_엔진이면_선점되지_않고_엔진이_바뀌면_attempts_1_로_선점된다() {
    OffsetDateTime token = claim("v1", true).orElseThrow();
    assertThat(inTenantTx(() -> repo.markFailed(fileId, token, "CONVERT_FAILED", false))).isTrue();

    assertThat(claim("v1", true)).isEmpty();

    assertThat(claim("v2", true)).isPresent();
    Row row = find().orElseThrow();
    assertThat(row.status()).isEqualTo("CONVERTING");
    assertThat(row.attempts()).isEqualTo(1);
    assertThat(row.engineVersion()).isEqualTo("v2");
    assertThat(row.failureCode()).isNull();
    assertThat(row.failureTransient()).isFalse();
  }

  @Test
  void 일시_FAILED_는_attempts_3_미만이면_바로_선점된다() {
    OffsetDateTime token = claim("v1", true).orElseThrow();
    assertThat(inTenantTx(() -> repo.markFailed(fileId, token, "BUSY", true))).isTrue();
    setAttempts(2);

    OffsetDateTime third = claim("v1", true).orElseThrow();
    assertThat(find().orElseThrow().attempts()).isEqualTo(3);

    assertThat(inTenantTx(() -> repo.markFailed(fileId, third, "TIMEOUT", true))).isTrue();
    assertThat(claim("v1", true)).isEmpty();
    Row row = find().orElseThrow();
    assertThat(row.status()).isEqualTo("FAILED");
    assertThat(row.failureCode()).isEqualTo("TIMEOUT");
    assertThat(row.failureTransient()).isTrue();
  }

  @Test
  void 상한에_닿은_일시_FAILED_는_쿨다운이_지나면_attempts_1_로_다시_선점된다() {
    OffsetDateTime token = claim("v1", true).orElseThrow();
    setAttempts(MAX_ATTEMPTS);
    assertThat(inTenantTx(() -> repo.markFailed(fileId, token, "TIMEOUT", true))).isTrue();

    // 쿨다운 전 — 상한이라 선점되지 않는다.
    assertThat(claim("v1", true)).isEmpty();

    // 마지막 실패가 쿨다운(10분)보다 오래됨 — 폴링은 여전히 아니고, 시도의 첫 요청은 attempts 1 로 다시 잡는다.
    ageUpdatedAt(Duration.ofMinutes(11));
    assertThat(claim("v1", false)).isEmpty();
    assertThat(claim("v1", true)).isPresent();
    Row row = find().orElseThrow();
    assertThat(row.status()).isEqualTo("CONVERTING");
    assertThat(row.attempts()).isEqualTo(1);
    assertThat(row.failureCode()).isNull();
  }

  @Test
  void 영구_FAILED_는_쿨다운이_지나도_같은_엔진이면_선점되지_않는다() {
    OffsetDateTime token = claim("v1", true).orElseThrow();
    assertThat(inTenantTx(() -> repo.markFailed(fileId, token, "CONVERT_FAILED", false))).isTrue();
    ageUpdatedAt(Duration.ofMinutes(11));

    assertThat(claim("v1", true)).isEmpty();
  }

  @Test
  void 엔진_버전이_다른_READY_는_재시도_허용_없이도_attempts_1_로_다시_선점된다() {
    OffsetDateTime token = claim("v1", true).orElseThrow();
    assertThat(inTenantTx(() -> repo.markReady(fileId, token, 3))).isTrue();

    // 같은 엔진의 READY 는 선점되지 않는다.
    assertThat(claim("v1", false)).isEmpty();

    assertThat(claim("v2", false)).isPresent();
    Row row = find().orElseThrow();
    assertThat(row.status()).isEqualTo("CONVERTING");
    assertThat(row.attempts()).isEqualTo(1);
    assertThat(row.engineVersion()).isEqualTo("v2");
  }

  @Test
  void refreshLease_는_토큰이_맞으면_리스를_새로_잡고_새_토큰을_준다() {
    OffsetDateTime tokenA = claim("v1", true).orElseThrow();
    // 큐에서 오래 기다려 리스가 만료됐지만 아무도 다시 선점하지 않은 경우 — 여전히 주인이라 갱신된다.
    expireLease();
    OffsetDateTime expired = find().orElseThrow().leasedUntil();
    assertThat(inTenantTx(() -> repo.isCurrentLease(fileId, expired))).isFalse();

    Optional<OffsetDateTime> refreshed =
        inTenantTx(() -> repo.refreshLease(fileId, expired, LEASE));

    assertThat(refreshed).isPresent();
    assertThat(refreshed.get()).isAfter(OffsetDateTime.now().plusMinutes(2));
    assertThat(find().orElseThrow().leasedUntil()).isEqualTo(refreshed.get());
    assertThat(inTenantTx(() -> repo.isCurrentLease(fileId, refreshed.get()))).isTrue();
    // 옛 토큰들은 더 이상 쓸 수 없다.
    assertThat(inTenantTx(() -> repo.refreshLease(fileId, tokenA, LEASE))).isEmpty();
    assertThat(inTenantTx(() -> repo.markReady(fileId, expired, 1))).isFalse();
  }

  @Test
  void refreshLease_는_다른_쪽이_다시_선점했으면_실패한다() {
    OffsetDateTime tokenA = claim("v1", true).orElseThrow();
    expireLease();
    OffsetDateTime expiredA = find().orElseThrow().leasedUntil();
    OffsetDateTime tokenB = claim("v1", true).orElseThrow();

    assertThat(inTenantTx(() -> repo.refreshLease(fileId, expiredA, LEASE))).isEmpty();
    assertThat(inTenantTx(() -> repo.refreshLease(fileId, tokenA, LEASE))).isEmpty();
    assertThat(find().orElseThrow().leasedUntil()).isEqualTo(tokenB);
  }

  @Test
  void FAILED_는_재시도_허용_없이는_선점되지_않는다() {
    // 일시 FAILED·attempts 1 — 폴링(allowFailedRetry=false)은 다시 선점하지 않는다.
    OffsetDateTime token = claim("v1", true).orElseThrow();
    assertThat(inTenantTx(() -> repo.markFailed(fileId, token, "BUSY", true))).isTrue();
    assertThat(claim("v1", false)).isEmpty();

    // 엔진이 바뀐 영구 FAILED 도 마찬가지.
    OffsetDateTime token2 = claim("v1", true).orElseThrow();
    assertThat(inTenantTx(() -> repo.markFailed(fileId, token2, "CONVERT_FAILED", false))).isTrue();
    assertThat(claim("v2", false)).isEmpty();
    assertThat(find().orElseThrow().status()).isEqualTo("FAILED");

    // PENDING 은 재시도 허용 없이도 선점된다.
    OffsetDateTime token3 = claim("v2", true).orElseThrow();
    assertThat(inTenantTx(() -> repo.release(fileId, token3))).isTrue();
    assertThat(claim("v2", false)).isPresent();

    // 리스 만료 CONVERTING 도 재시도 허용 없이 선점된다.
    expireLease();
    assertThat(claim("v2", false)).isPresent();
  }

  @Test
  void 오래된_리스_토큰의_기록은_무시된다() {
    OffsetDateTime tokenA = claim("v1", true).orElseThrow();
    expireLease();
    OffsetDateTime tokenB = claim("v1", true).orElseThrow();
    assertThat(tokenB).isNotEqualTo(tokenA);

    assertThat(inTenantTx(() -> repo.isCurrentLease(fileId, tokenA))).isFalse();
    assertThat(inTenantTx(() -> repo.markReady(fileId, tokenA, 5))).isFalse();
    assertThat(inTenantTx(() -> repo.markFailed(fileId, tokenA, "BUSY", true))).isFalse();
    assertThat(inTenantTx(() -> repo.release(fileId, tokenA))).isFalse();
    Row row = find().orElseThrow();
    assertThat(row.status()).isEqualTo("CONVERTING");
    assertThat(row.leasedUntil()).isEqualTo(tokenB);

    // 현재 토큰으로는 기록된다 — READY 는 실패 필드·리스를 비운다.
    assertThat(inTenantTx(() -> repo.isCurrentLease(fileId, tokenB))).isTrue();
    assertThat(inTenantTx(() -> repo.markReady(fileId, tokenB, 7))).isTrue();
    Row ready = find().orElseThrow();
    assertThat(ready.status()).isEqualTo("READY");
    assertThat(ready.pageCount()).isEqualTo(7);
    assertThat(ready.failureCode()).isNull();
    assertThat(ready.leasedUntil()).isNull();
    assertThat(claim("v1", true)).isEmpty();
  }

  @Test
  void release_는_PENDING_으로_되돌리고_시도를_돌려준다() {
    OffsetDateTime token = claim("v1", true).orElseThrow();

    assertThat(inTenantTx(() -> repo.release(fileId, token))).isTrue();

    Row row = find().orElseThrow();
    assertThat(row.status()).isEqualTo("PENDING");
    assertThat(row.attempts()).isZero();
    assertThat(row.leasedUntil()).isNull();
  }

  @Test
  void resetReady_는_READY_를_PENDING_으로_되돌리고_attempts_를_비운다() {
    OffsetDateTime token = claim("v1", true).orElseThrow();
    assertThat(inTenantTx(() -> repo.markReady(fileId, token, 3))).isTrue();

    inTenantTx(
        () -> {
          repo.resetReady(fileId);
          return null;
        });

    Row row = find().orElseThrow();
    assertThat(row.status()).isEqualTo("PENDING");
    assertThat(row.attempts()).isZero();
    assertThat(claim("v1", false)).isPresent();
  }

  @Test
  void markTooLarge_는_영구_실패_TOO_LARGE_로_업서트한다() {
    inTenantTx(
        () -> {
          repo.markTooLarge(fileId, tid2, "v1");
          return null;
        });

    Row row = find().orElseThrow();
    assertThat(row.status()).isEqualTo("FAILED");
    assertThat(row.failureCode()).isEqualTo("TOO_LARGE");
    assertThat(row.failureTransient()).isFalse();
    assertThat(claim("v1", true)).isEmpty();
  }

  @Test
  void 다른_테넌트_GUC_로는_행이_보이지_않는다() {
    assertThat(claim("v1", true)).isPresent();

    Optional<Row> other =
        new TransactionTemplate(txManager)
            .execute(
                status -> {
                  setGuc(1L);
                  return repo.find(fileId);
                });

    assertThat(other).isEmpty();
    assertThat(find()).isPresent();
  }

  @Test
  void file_행을_지우면_미리보기_행도_지워진다() {
    assertThat(claim("v1", true)).isPresent();

    inTenantTx(() -> dsl.deleteFrom(FILE).where(FILE.ID.eq(fileId)).execute());

    assertThat(find()).isEmpty();
  }

  // ── helpers ──

  private Optional<OffsetDateTime> claim(String engineVersion, boolean allowFailedRetry) {
    return inTenantTx(
        () ->
            repo.claim(
                fileId, tid2, engineVersion, LEASE, MAX_ATTEMPTS, COOLDOWN, allowFailedRetry));
  }

  private Optional<Row> find() {
    return inTenantTx(() -> repo.find(fileId));
  }

  /** 리스를 1초 전으로 당겨 "변환 중 API 가 죽은" CONVERTING 을 만든다. */
  private void expireLease() {
    inTenantTx(
        () ->
            dsl.update(FILE_PREVIEW)
                .set(
                    FILE_PREVIEW.LEASED_UNTIL,
                    DSL.field("now() - interval '1 second'", OffsetDateTime.class))
                .where(FILE_PREVIEW.FILE_ID.eq(fileId))
                .execute());
  }

  /** 마지막 상태 변경 시각을 과거로 당긴다(일시 실패 쿨다운 경과 재현). */
  private void ageUpdatedAt(Duration age) {
    inTenantTx(
        () ->
            dsl.update(FILE_PREVIEW)
                .set(
                    FILE_PREVIEW.UPDATED_AT,
                    DSL.field(
                        "now() - ({0} * interval '1 second')",
                        OffsetDateTime.class, DSL.val(age.toSeconds())))
                .where(FILE_PREVIEW.FILE_ID.eq(fileId))
                .execute());
  }

  private void setAttempts(int attempts) {
    inTenantTx(
        () ->
            dsl.update(FILE_PREVIEW)
                .set(FILE_PREVIEW.ATTEMPTS, attempts)
                .where(FILE_PREVIEW.FILE_ID.eq(fileId))
                .execute());
  }

  /** fixture 테넌트 GUC 가 심긴 트랜잭션에서 실행·커밋한다(테넌트는 첫 호출에 find-or-create). */
  private <T> T inTenantTx(Supplier<T> body) {
    return new TransactionTemplate(txManager)
        .execute(
            status -> {
              if (tid2 == null) {
                tid2 = ensureFixtureTenant();
              }
              setGuc(tid2);
              return body.get();
            });
  }

  /** 고정 슬러그로 fixture 테넌트를 find-or-create(커밋) — tenant 행은 삭제 불가라 누적을 막는다. */
  private long ensureFixtureTenant() {
    Long existing =
        dsl.select(TENANT.ID)
            .from(TENANT)
            .where(TENANT.SLUG.eq(FIXTURE_TENANT_SLUG))
            .fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, FIXTURE_TENANT_SLUG)
        .set(TENANT.NAME, "File Preview RLS Fixture Tenant")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }
}
