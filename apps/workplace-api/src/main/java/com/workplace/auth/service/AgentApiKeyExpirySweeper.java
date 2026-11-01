package com.workplace.auth.service;

import com.workplace.auth.repository.AgentApiKeyRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 만료된 Works 자동 발급 키에 회수 시각을 남기는 정기 정리(WP-1253).
 *
 * <p>만료된 키는 활성 조건({@code expires_at > now})으로 이미 인증되지 않는다. 하지만 회수 시각이 비어 있으면 활성 managed 키 부분
 * 인덱스(revoked_at IS NULL)에 계속 남아, 30일마다 교체되는 키가 쌓일수록 인덱스가 커진다. 만료 뒤 하루가 지난 키만 고른다 — 막 만료된 키를 관리자
 * 목록에서 「만료됨」으로 잠시 볼 수 있게. 필요하면 {@code app.agent-api-key.expiry-sweep.enabled=false} 로 끌 수 있다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(
    name = "app.agent-api-key.expiry-sweep.enabled",
    havingValue = "true",
    matchIfMissing = true)
public class AgentApiKeyExpirySweeper {

  /** 만료 뒤 이만큼 지난 키에 회수 시각을 남긴다. */
  static final Duration SWEEP_AFTER_EXPIRY = Duration.ofDays(1);

  private final AgentApiKeyRepository repository;

  /** 시작 1분 뒤 첫 실행, 이후 1시간 간격. 파드가 겹쳐도 한 곳에서만 돌게 잠근다. */
  @Scheduled(initialDelay = 60_000, fixedDelay = 3_600_000)
  @SchedulerLock(name = "AgentApiKeyExpirySweeper.sweep")
  public void sweep() {
    int revoked = repository.revokeExpiredManaged(OffsetDateTime.now().minus(SWEEP_AFTER_EXPIRY));
    if (revoked > 0) log.info("만료된 Works 자동 발급 키 {}개에 회수 시각을 남겼습니다", revoked);
  }
}
