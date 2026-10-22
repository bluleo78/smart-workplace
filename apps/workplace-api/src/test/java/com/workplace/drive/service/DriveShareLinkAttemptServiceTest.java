package com.workplace.drive.service;

import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK_ATTEMPTS;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.repository.DriveShareLinkAttemptRepository;
import com.workplace.support.IntegrationTestBase;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import org.jooq.DSLContext;
import org.jooq.DatePart;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * DriveShareLinkAttemptService 통합 테스트(#700).
 *
 * <p>{@code LoginAttemptServiceTest}(#144)와 동일 패턴 — 실제 PostgreSQL을 사용해 영속 잠금 로직을 검증한다. 각 테스트는 UUID
 * 기반 token_hash로 격리되어 병렬 실행이나 잔여 데이터에 영향받지 않는다.
 */
class DriveShareLinkAttemptServiceTest extends IntegrationTestBase {

  @Autowired private DriveShareLinkAttemptService attemptService;
  @Autowired private DriveShareLinkAttemptRepository attemptRepository;
  @Autowired private DSLContext dsl;

  private String uniqueTokenHash;

  /**
   * DB 시계 기준 1분 전(WP-434). 만료 판정이 DB 시계 기준이므로 강제 만료도 같은 시계로 넣는다 — JVM 시계로 넣으면 DB 컨테이너 시계와 어긋날 때 아직
   * 만료되지 않은 값이 된다.
   */
  private static final Field<LocalDateTime> ONE_MINUTE_AGO_DB =
      DSL.localDateTimeSub(DSL.currentLocalDateTime(), 1, DatePart.MINUTE);

  // tryReserve 는 REQUIRES_NEW 로 커밋되어 롤백되지 않으므로, 사용한 token_hash 를 추적해 @AfterEach 에서 회수.
  private final List<String> createdHashes = new ArrayList<>();

  @BeforeEach
  void setUp() {
    uniqueTokenHash = "hash-" + UUID.randomUUID();
    createdHashes.add(uniqueTokenHash);
  }

  @AfterEach
  void cleanup() {
    dsl.deleteFrom(DRIVE_SHARE_LINK_ATTEMPTS)
        .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.in(createdHashes))
        .execute();
    createdHashes.clear();
  }

  @Test
  void isBlocked_returnsFalse_whenNoAttempts() {
    assertThat(attemptService.isBlocked(uniqueTokenHash)).isFalse();
  }

  @Test
  void isBlocked_returnsFalse_after4Attempts() {
    for (int i = 0; i < 4; i++) attemptService.tryReserve(uniqueTokenHash);
    assertThat(attemptService.isBlocked(uniqueTokenHash)).isFalse();
  }

  @Test
  void isBlocked_returnsTrue_after5Attempts() {
    for (int i = 0; i < 5; i++) attemptService.tryReserve(uniqueTokenHash);
    assertThat(attemptService.isBlocked(uniqueTokenHash)).isTrue();
  }

  @Test
  void attemptSucceeded_resetsCounter() {
    for (int i = 0; i < 5; i++) attemptService.tryReserve(uniqueTokenHash);
    assertThat(attemptService.isBlocked(uniqueTokenHash)).isTrue();

    attemptService.attemptSucceeded(uniqueTokenHash);
    assertThat(attemptService.isBlocked(uniqueTokenHash)).isFalse();

    int rows =
        dsl.fetchCount(
            dsl.selectOne()
                .from(DRIVE_SHARE_LINK_ATTEMPTS)
                .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.eq(uniqueTokenHash)));
    assertThat(rows).isZero();
  }

  @Test
  void isBlocked_isolatesTokenHashes() {
    String other = "other-" + UUID.randomUUID();
    for (int i = 0; i < 5; i++) attemptService.tryReserve(uniqueTokenHash);

    assertThat(attemptService.isBlocked(uniqueTokenHash)).isTrue();
    assertThat(attemptService.isBlocked(other)).isFalse();
  }

  @Test
  void getAttempts_returnsZero_whenExpired() {
    for (int i = 0; i < 5; i++) attemptService.tryReserve(uniqueTokenHash);
    dsl.update(DRIVE_SHARE_LINK_ATTEMPTS)
        .set(DRIVE_SHARE_LINK_ATTEMPTS.EXPIRES_AT, ONE_MINUTE_AGO_DB)
        .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.eq(uniqueTokenHash))
        .execute();

    assertThat(attemptService.isBlocked(uniqueTokenHash)).isFalse();
  }

  /** WP-783: 상한(5)에 닿으면 다음 칸은 잡히지 않는다(0) — 카운터도 5 에서 멈춘다. */
  @Test
  void tryReserve_returnsZero_onceLimitReached() {
    for (int i = 1; i <= 5; i++)
      assertThat(attemptService.tryReserve(uniqueTokenHash)).isEqualTo(i);
    assertThat(attemptService.tryReserve(uniqueTokenHash)).isZero();
    assertThat(attemptService.tryReserve(uniqueTokenHash)).isZero();
    assertThat(
            dsl.select(DRIVE_SHARE_LINK_ATTEMPTS.ATTEMPTS)
                .from(DRIVE_SHARE_LINK_ATTEMPTS)
                .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.eq(uniqueTokenHash))
                .fetchOne(DRIVE_SHARE_LINK_ATTEMPTS.ATTEMPTS))
        .isEqualTo(5);
  }

  /** WP-783: 잠금이 만료된 행(정리 전)은 1 부터 다시 센다 — 전에는 6 으로 이어져 만료 직후 첫 실패에 다시 잠겼다. */
  @Test
  void tryReserve_restartsFromOne_afterExpiry() {
    for (int i = 0; i < 5; i++) attemptService.tryReserve(uniqueTokenHash);
    dsl.update(DRIVE_SHARE_LINK_ATTEMPTS)
        .set(DRIVE_SHARE_LINK_ATTEMPTS.EXPIRES_AT, ONE_MINUTE_AGO_DB)
        .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.eq(uniqueTokenHash))
        .execute();

    assertThat(attemptService.tryReserve(uniqueTokenHash)).isEqualTo(1);
    assertThat(attemptService.isBlocked(uniqueTokenHash)).isFalse();
  }

  @Test
  void incrementAttempts_isAtomic_underConcurrency()
      throws ExecutionException, InterruptedException {
    CompletableFuture<?>[] futures = new CompletableFuture[5];
    for (int i = 0; i < 5; i++) {
      futures[i] = CompletableFuture.runAsync(() -> attemptService.tryReserve(uniqueTokenHash));
    }
    CompletableFuture.allOf(futures).get();

    int attempts =
        dsl.select(DRIVE_SHARE_LINK_ATTEMPTS.ATTEMPTS)
            .from(DRIVE_SHARE_LINK_ATTEMPTS)
            .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.eq(uniqueTokenHash))
            .fetchOne(DRIVE_SHARE_LINK_ATTEMPTS.ATTEMPTS);
    assertThat(attempts).isEqualTo(5);
    assertThat(attemptService.isBlocked(uniqueTokenHash)).isTrue();
  }

  @Test
  void deleteExpired_removesOnlyExpiredRows() {
    String expired1 = "exp1-" + UUID.randomUUID();
    String expired2 = "exp2-" + UUID.randomUUID();
    String fresh = "fresh-" + UUID.randomUUID();
    createdHashes.addAll(List.of(expired1, expired2, fresh));

    attemptService.tryReserve(expired1);
    attemptService.tryReserve(expired2);
    attemptService.tryReserve(fresh);

    dsl.update(DRIVE_SHARE_LINK_ATTEMPTS)
        .set(DRIVE_SHARE_LINK_ATTEMPTS.EXPIRES_AT, ONE_MINUTE_AGO_DB)
        .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.in(expired1, expired2))
        .execute();

    int deleted = attemptRepository.deleteExpired();

    assertThat(deleted).isGreaterThanOrEqualTo(2);
    int freshRow =
        dsl.fetchCount(
            dsl.selectOne()
                .from(DRIVE_SHARE_LINK_ATTEMPTS)
                .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.eq(fresh)));
    assertThat(freshRow).isEqualTo(1);
  }
}
