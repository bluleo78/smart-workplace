package com.workplace.agentaccount.refresh;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * ChatGPT 로그인 서버 갱신 스케줄러(WP-1450). interval(기본 1시간)마다 {@link LoginRefreshService#refreshDue} 를 부른다.
 * 파드 간 동시 실행은 ShedLock 으로 막고, 그래도 겹치면 계정 단위 임대가 한쪽만 갱신하게 한다. {@code
 * workplace.agent-account.login-refresh.enabled=false} 면 빈 자체를 등록하지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(
    name = "workplace.agent-account.login-refresh.enabled",
    havingValue = "true",
    matchIfMissing = true)
public class LoginRefreshScheduler {

  private final LoginRefreshService service;

  /** 스케줄 진입점 — 이전 회차가 끝난 뒤 interval 마다. 기동 직후 초기화를 기다리려 1분 뒤 첫 실행. */
  @Scheduled(
      fixedDelayString = "${workplace.agent-account.login-refresh.interval:1h}",
      initialDelay = 60_000)
  @SchedulerLock(name = "LoginRefreshScheduler.refresh", lockAtMostFor = "PT30M")
  public void refresh() {
    int attempted = service.refreshDue();
    if (attempted > 0) log.info("ChatGPT 로그인 갱신 — {}건 시도", attempted);
  }
}
