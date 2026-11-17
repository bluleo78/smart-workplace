package com.workplace.auth.oauth.service;

import com.workplace.auth.oauth.repository.OAuthClientRepository;
import com.workplace.auth.oauth.repository.OAuthCodeRepository;
import com.workplace.auth.oauth.repository.OAuthTokenRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * OAuth 인가 서버의 쓰레기 행 정리(WP-1685) — 1시간마다 돈다({@code LoginAttemptCleanupScheduler} 와 같은 관례).
 *
 * <ul>
 *   <li>만료된 지 24시간 지난 인가 code·토큰 행 삭제 — 조회는 만료를 이미 거르므로 정확성과 무관하고, 표·인덱스가 계속 커지는 것만 막는다. 하루 여유를 두어
 *       만료 직후의 재사용 시도(재사용 탐지)는 행이 남아 있을 때 판정된다.
 *   <li>연결이 한 번도 생기지 않은 DCR 클라이언트는 만든 지 7일 뒤 삭제 — 등록 엔드포인트가 공개라 승인으로 이어지지 않은 등록이 쌓인다. CIMD 는 문서 캐시라
 *       대상이 아니다.
 * </ul>
 *
 * <p>테스트 프로파일은 스케줄링 자체를 끄므로(빈은 남는다) 테스트가 {@link #cleanup()} 을 직접 부른다. 운영에서 끄려면 {@code
 * app.oauth.cleanup.enabled=false}.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(
    name = "app.oauth.cleanup.enabled",
    havingValue = "true",
    matchIfMissing = true)
public class OAuthCleanupScheduler {

  /** 만료 뒤 행을 남겨 두는 시간. */
  static final Duration EXPIRED_RETENTION = Duration.ofHours(24);

  /** 연결 없는 DCR 클라이언트를 남겨 두는 시간. */
  static final Duration UNUSED_DCR_RETENTION = Duration.ofDays(7);

  private final OAuthCodeRepository codes;
  private final OAuthTokenRepository tokens;
  private final OAuthClientRepository clients;

  /** 시작 60초 후 첫 실행, 이후 1시간 간격. 여러 파드 중 하나만 돈다(ShedLock). */
  @Scheduled(initialDelay = 60_000, fixedDelay = 3_600_000)
  @SchedulerLock(name = "OAuthCleanupScheduler.cleanup")
  public void cleanup() {
    OffsetDateTime now = OffsetDateTime.now();
    OffsetDateTime expiredCutoff = now.minus(EXPIRED_RETENTION);
    // 각 삭제는 독립적이라 한 트랜잭션으로 묶지 않는다 — 앞 삭제는 뒤 삭제가 실패해도 그대로 커밋된다(긴 잠금 없이 문장마다 끝난다).
    int deletedCodes = codes.deleteExpiredBefore(expiredCutoff);
    int deletedTokens = tokens.deleteExpiredBefore(expiredCutoff);
    int deletedClients = clients.deleteUnusedDcrOlderThan(now.minus(UNUSED_DCR_RETENTION));
    if (deletedCodes + deletedTokens + deletedClients > 0) {
      log.debug(
          "OAuth 정리 — code {}건, 토큰 {}건, 연결 없는 DCR 클라이언트 {}건 삭제",
          deletedCodes,
          deletedTokens,
          deletedClients);
    }
  }
}
