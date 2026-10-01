package com.workplace.auth.service;

import com.workplace.auth.repository.RefreshTokenRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Slf4j
@Service
@RequiredArgsConstructor
public class RefreshTokenCleanupService {

  private final RefreshTokenRepository refreshTokenRepository;

  /** Delete expired tokens and revoked tokens older than 7 days. Runs daily at 4 AM. */
  @Scheduled(cron = "0 0 4 * * *")
  @SchedulerLock(name = "RefreshTokenCleanupService.cleanupExpiredTokens")
  public void cleanupExpiredTokens() {
    int deleted = refreshTokenRepository.deleteExpiredTokens();
    log.info("Cleaned up {} expired/revoked refresh tokens", deleted);
  }
}
