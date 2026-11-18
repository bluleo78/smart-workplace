package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.RuntimeVersion;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.global.tenant.TenantScopedRunner;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 릴리스 버전 비교(WP-1706) — API 가 뜨고 나서 켜진 Pod AI 가 마지막으로 띄운 이미지·플러그인 버전과 지금 템플릿의 버전을 비교해, 다르면
 * generation 을 쉴 때 적용으로 올린다. 올리면 AI 가 쉴 때 runner 가 새 버전으로 다시 띄운다.
 *
 * <p>기동 직후가 아니라 {@code delay} 뒤에 돈다 — 롤링 배포 중에는 옛 API 파드가 아직 살아 있어 옛 이미지로 새 generation 을 띄울 수 있다.
 * 여러 파드가 동시에 돌아도 올리는 UPDATE 가 한 번만 성공하므로(WHERE 의 기록 ≠ 지금) 알림도 한 번만 나간다.
 */
@Component
@Slf4j
public class AgentRuntimeVersionRollout {

  private final TenantScopedRunner tenantRunner;
  private final AgentRuntimeSettingRepository settings;
  private final AgentRuntimeVersions versions;
  private final AgentRuntimeTransitions transitions;

  /** 기동 때 돌지 — 테스트 프로파일은 끈다(캐시된 테스트 컨텍스트마다 다른 테스트의 AI 를 올리지 않게). */
  private final boolean onStartup;

  private final Duration delay;

  public AgentRuntimeVersionRollout(
      TenantScopedRunner tenantRunner,
      AgentRuntimeSettingRepository settings,
      AgentRuntimeVersions versions,
      AgentRuntimeTransitions transitions,
      @Value("${workplace.agent-version-rollout.on-startup:true}") boolean onStartup,
      @Value("${workplace.agent-version-rollout.delay:2m}") Duration delay) {
    this.tenantRunner = tenantRunner;
    this.settings = settings;
    this.versions = versions;
    this.transitions = transitions;
    this.onStartup = onStartup;
    this.delay = delay;
  }

  /** 기동 뒤 진입점 — 켜져 있으면 delay 뒤 한 번 모든 활성 테넌트를 비교한다. 실패는 경고만(기동을 막지 않는다). */
  @EventListener(ApplicationReadyEvent.class)
  public void onApplicationReady() {
    if (!onStartup) return;
    if (delay.isZero() || delay.isNegative()) {
      // 지연이 없으면 같은 스레드에서 바로 돈다(라이브 검증용 — WP-1706).
      rolloutAllTenants();
      return;
    }
    CompletableFuture.runAsync(
        this::rolloutAllTenants,
        CompletableFuture.delayedExecutor(delay.toMillis(), TimeUnit.MILLISECONDS));
  }

  /** 모든 활성 테넌트 — TenantScopedRunner 가 테넌트마다 트랜잭션·GUC 를 건다. 한 테넌트의 실패는 거기서 경고 후 다음으로. */
  public void rolloutAllTenants() {
    try {
      tenantRunner.forEachActiveTenant(this::rolloutTenant);
    } catch (RuntimeException e) {
      log.warn("릴리스 버전 비교 실패 — 건너뛴다(WP-1706)", e);
    }
  }

  /**
   * 테넌트 하나(호출자 트랜잭션·TenantContext 안) — 템플릿마다 올리기 → 올리지 않을 행의 기록 맞추기 → 알림.
   *
   * @return 올린 AI id
   */
  public List<Long> rolloutTenant(long tenantId) {
    List<Row> bumped = new ArrayList<>();
    for (Map.Entry<String, RuntimeVersion> e : versions.currentAll().entrySet()) {
      List<Row> rows = settings.bumpForRuntimeVersion(e.getKey(), e.getValue());
      settings.recordRuntimeVersion(e.getKey(), e.getValue());
      if (!rows.isEmpty()) {
        log.info(
            "테넌트 {} 템플릿 {} — 버전이 바뀐 AI {}명의 generation 을 올린다({})",
            tenantId,
            e.getKey(),
            rows.size(),
            e.getValue().label());
        bumped.addAll(rows);
      }
    }
    transitions.runtimeVersionChanged(bumped);
    return bumped.stream().map(Row::agentUserId).toList();
  }
}
