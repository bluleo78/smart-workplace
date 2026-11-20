package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.exception.MailAiUnavailableException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** WP-1812 메일 분석 회로 차단기 — 고정 시계로 열림·닫힘·메일별 건너뜀·표 상한을 검증한다. */
class MailAnalysisBreakerTest {

  private Instant now;
  private MailAnalysisBreaker breaker;

  @BeforeEach
  void setUp() {
    now = Instant.parse("2026-11-20T00:00:00Z");
    // 호출 시점마다 now 를 읽는 시계 — 테스트가 now 를 앞으로 돌린다
    Clock clock =
        new Clock() {
          @Override
          public java.time.ZoneId getZone() {
            return ZoneOffset.UTC;
          }

          @Override
          public Clock withZone(java.time.ZoneId zone) {
            return this;
          }

          @Override
          public Instant instant() {
            return now;
          }
        };
    breaker = new MailAnalysisBreaker(clock);
  }

  /** 회로가 열려 있는지 — 어떤 메일이든 입장 판정이 OPEN 이면 열린 것. */
  private boolean isOpen() {
    return breaker.admit(-1L) == MailAnalysisBreaker.Admission.OPEN;
  }

  /** 그 메일이 건너뜀 상태인지(회로는 닫혀 있다는 전제). */
  private boolean skips(long messageId) {
    return breaker.admit(messageId) == MailAnalysisBreaker.Admission.SKIP;
  }

  @Test
  void onError_countsOnlyModelFailures() {
    breaker.onError(1L, new RuntimeException("imap"));
    assertThat(skips(1L)).isFalse();
    breaker.onError(2L, new MailAiException("x", null));
    assertThat(skips(2L)).isTrue();
  }

  @Test
  void opensAfterFiveConsecutiveFailures() {
    for (int i = 1; i <= 4; i++) {
      breaker.recordFailure(i);
    }
    assertThat(isOpen()).isFalse();
    breaker.recordFailure(5);
    assertThat(isOpen()).isTrue();
  }

  @Test
  void closesAfterTenMinutes() {
    for (int i = 1; i <= 5; i++) {
      breaker.recordFailure(i);
    }
    now = now.plus(Duration.ofMinutes(10)).plusSeconds(1);
    assertThat(isOpen()).isFalse();
  }

  @Test
  void successResetsStreak() {
    for (int i = 1; i <= 4; i++) {
      breaker.recordFailure(i);
    }
    breaker.recordSuccess();
    for (int i = 5; i <= 8; i++) {
      breaker.recordFailure(i);
    }
    assertThat(isOpen()).isFalse();
  }

  @Test
  void skipsFailedMessageForThirtyMinutes() {
    breaker.recordFailure(42L);
    assertThat(skips(42L)).isTrue();
    assertThat(skips(43L)).isFalse();
    now = now.plus(Duration.ofMinutes(30)).plusSeconds(1);
    assertThat(skips(42L)).isFalse();
  }

  @Test
  void boundsTrackedMessages() {
    for (long i = 0; i <= MailAnalysisBreaker.MAX_TRACKED_MESSAGES; i++) {
      breaker.recordFailure(i);
    }
    assertThat(breaker.trackedMessageCount()).isLessThanOrEqualTo(10_000);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  void tenantAOpening_doesNotOpenTenantB() {
    TenantContext.runAs(
        1L,
        () -> {
          for (int i = 1; i <= 5; i++) {
            breaker.recordFailure(i);
          }
          assertThat(isOpen()).isTrue();
        });
    TenantContext.runAs(2L, () -> assertThat(isOpen()).isFalse());
  }

  @Test
  void tenantBSuccess_doesNotResetTenantAStreak() {
    TenantContext.runAs(
        1L,
        () -> {
          for (int i = 1; i <= 4; i++) {
            breaker.recordFailure(i);
          }
        });
    TenantContext.runAs(2L, breaker::recordSuccess);
    TenantContext.runAs(
        1L,
        () -> {
          breaker.recordFailure(5);
          assertThat(isOpen()).isTrue(); // A 의 연속 5회째 — B 의 성공이 수를 지우지 않았다
        });
  }

  @Test
  void messageSkipTable_isKeyedByTenantAndId() {
    TenantContext.runAs(1L, () -> breaker.recordFailure(42L));
    TenantContext.runAs(2L, () -> assertThat(skips(42L)).isFalse());
    TenantContext.runAs(1L, () -> assertThat(skips(42L)).isTrue());
  }

  @Test
  void countsAsModelFailure_transientUnavailableYes_permanentReasonNo() {
    assertThat(MailAnalysisBreaker.countsAsModelFailure(new MailAiException("x", null))).isTrue();
    assertThat(MailAnalysisBreaker.countsAsModelFailure(new MailAiUnavailableException("재기동 중")))
        .isTrue();
    assertThat(MailAnalysisBreaker.countsAsModelFailure(MailAiUnavailableException.aiDisabled()))
        .isFalse();
    assertThat(
            MailAnalysisBreaker.countsAsModelFailure(
                MailAiUnavailableException.assistantNotConfigured()))
        .isFalse();
    assertThat(MailAnalysisBreaker.countsAsModelFailure(new RuntimeException("imap"))).isFalse();
  }
}
