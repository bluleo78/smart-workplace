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

  // attemptFailed 는 REQUIRES_NEW 로 커밋되어 롤백되지 않으므로, 사용한 token_hash 를 추적해 @AfterEach 에서 회수.
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
    for (int i = 0; i < 4; i++) attemptService.attemptFailed(uniqueTokenHash);
    assertThat(attemptService.isBlocked(uniqueTokenHash)).isFalse();
  }

  @Test
  void isBlocked_returnsTrue_after5Attempts() {
    for (int i = 0; i < 5; i++) attemptService.attemptFailed(uniqueTokenHash);
    assertThat(attemptService.isBlocked(uniqueTokenHash)).isTrue();
  }

  @Test
  void attemptSucceeded_resetsCounter() {
    for (int i = 0; i < 5; i++) attemptService.attemptFailed(uniqueTokenHash);
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
    for (int i = 0; i < 5; i++) attemptService.attemptFailed(uniqueTokenHash);

    assertThat(attemptService.isBlocked(uniqueTokenHash)).isTrue();
    assertThat(attemptService.isBlocked(other)).isFalse();
  }

  @Test
  void getAttempts_returnsZero_whenExpired() {
    for (int i = 0; i < 5; i++) attemptService.attemptFailed(uniqueTokenHash);
    dsl.update(DRIVE_SHARE_LINK_ATTEMPTS)
        .set(DRIVE_SHARE_LINK_ATTEMPTS.EXPIRES_AT, LocalDateTime.now().minusMinutes(1))
        .where(DRIVE_SHARE_LINK_ATTEMPTS.TOKEN_HASH.eq(uniqueTokenHash))
        .execute();

    assertThat(attemptService.isBlocked(uniqueTokenHash)).isFalse();
  }

  @Test
  void incrementAttempts_isAtomic_underConcurrency()
      throws ExecutionException, InterruptedException {
    CompletableFuture<?>[] futures = new CompletableFuture[5];
    for (int i = 0; i < 5; i++) {
      futures[i] = CompletableFuture.runAsync(() -> attemptService.attemptFailed(uniqueTokenHash));
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

    attemptService.attemptFailed(expired1);
    attemptService.attemptFailed(expired2);
    attemptService.attemptFailed(fresh);

    LocalDateTime past = LocalDateTime.now().minusMinutes(1);
    dsl.update(DRIVE_SHARE_LINK_ATTEMPTS)
        .set(DRIVE_SHARE_LINK_ATTEMPTS.EXPIRES_AT, past)
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
