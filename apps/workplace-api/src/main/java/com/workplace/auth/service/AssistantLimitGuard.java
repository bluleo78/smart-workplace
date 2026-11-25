package com.workplace.auth.service;

import com.workplace.airun.context.AiRunContext;
import com.workplace.airun.service.AiRunRecorder;
import com.workplace.airun.service.AiRunSkips;
import com.workplace.global.outbound.ProviderLimitSignal;
import com.workplace.global.tenant.TenantContext;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * 자동 호출부가 비서 사용 한도(WP-2108)를 다루는 공용 도우미 — ① 대기 중이면 그 회차를 건너뛰며 SKIPPED(limit_wait)를 한 번만 남기고 ②
 * ai-agent 의 503 PROVIDER_LIMIT 를 알아보면 그 자격을 대기로 건다. 호출부마다 같은 분기를 베끼지 않게 한 곳에 둔다.
 */
@Component
public class AssistantLimitGuard {

  private static final Logger log = LoggerFactory.getLogger(AssistantLimitGuard.class);

  /** 건너뜀 기록 중복 방지 키 — 같은 대기(자격·종류·끝 시각)에는 한 번만 남긴다. */
  private record SkipKey(long tenantId, long credentialId, String kind, Instant until) {}

  private final AssistantLimitWaitService waitService;
  private final AiRunRecorder recorder;

  /** 이미 건너뜀을 남긴 (자격, 종류, until) — 이 프로세스 안에서만 중복을 막는다(재시작하면 한 번 더 남을 수 있다). */
  private final ConcurrentMap<SkipKey, Boolean> recorded = new ConcurrentHashMap<>();

  public AssistantLimitGuard(AssistantLimitWaitService waitService, AiRunRecorder recorder) {
    this.waitService = waitService;
    this.recorder = recorder;
  }

  /**
   * 해석 결과에서 부를 사양만 꺼낸다. ready 면 사양, none 이면 기록 없이 빈 값, waiting 이면 SKIPPED(limit_wait)를 (자격, 종류,
   * until) 당 이 프로세스에서 한 번만 남기고 빈 값 — 매 틱·매 건마다 같은 기록이 쌓이지 않게. 호출부는 「한도 대기면 건너뛰고 기록」 이라는 한 줄만 적는다.
   */
  public Optional<AssistantSpec> specOrSkip(
      AssistantResolution resolution, String kind, AiRunContext ctx) {
    if (!resolution.isWaiting()) return resolution.readySpec();
    if (resolution.credentialId() == null) return Optional.empty();
    SkipKey key =
        new SkipKey(
            currentTenantId(), resolution.credentialId(), kind, resolution.limitWaitUntil());
    // 새 키일 때만 기록하고, 그때 지난 대기의 키를 치워 맵이 자라지 않게 한다(이미 기록된 키면 정리도 건너뛴다).
    if (recorded.putIfAbsent(key, Boolean.TRUE) == null) {
      Instant now = Instant.now();
      recorded.keySet().removeIf(k -> !k.until().isAfter(now));
      AiRunSkips.record(recorder, kind, ctx, AiRunSkips.LIMIT_WAIT);
    }
    return Optional.empty();
  }

  /**
   * 비서 호출이 실패했을 때 사용 한도 때문이면 그 자격을 대기로 건다. 한도 실패면 true. 어떤 예외도 던지지 않는다 — 실패 처리 중에 또 실패해 본래 오류를 가리면
   * 안 된다.
   */
  public boolean onFailure(AssistantSpec spec, Throwable error) {
    try {
      Optional<ProviderLimitSignal.Hit> hit = ProviderLimitSignal.detect(error);
      if (hit.isEmpty()) return false;
      if (TenantContext.get() == null) {
        log.warn("사용 한도를 감지했으나 테넌트 맥락이 없어 대기를 걸지 못함: agent={}", spec.agentUserId());
        return false;
      }
      return markWaiting(spec, hit.get().resetsAt()).isPresent();
    } catch (RuntimeException e) {
      log.warn("사용 한도 대기 표시 중 오류(무시): agent={}", spec.agentUserId(), e);
      return false;
    }
  }

  /**
   * ai-agent 호출을 부르고, 실패하면 {@link #onFailure} 로 한도 여부를 보고 대기를 건 뒤 <b>같은 예외를 그대로 다시 던진다</b>. 기존
   * catch 가 없는 호출부가 try/catch 를 베끼지 않게 한 곳에 둔다 — 실패 처리 흐름은 바꾸지 않는다.
   */
  public <T> T call(AssistantSpec spec, Supplier<T> call) {
    try {
      return call.get();
    } catch (RuntimeException e) {
      onFailure(spec, e);
      throw e;
    }
  }

  /**
   * 채팅처럼 ai-agent 가 알려 준 resetsAt(ISO-8601 문자열)로 직접 대기를 건다. 저장된 until 을 돌려주고, 못 걸었으면 빈 값. 어떤 예외도
   * 던지지 않는다.
   */
  public Optional<Instant> markLimit(AssistantSpec spec, String resetsAtIso) {
    return markWaiting(spec, ProviderLimitSignal.parseInstant(resetsAtIso));
  }

  /**
   * 사양의 자격을 대기로 건다 — onFailure·markLimit 이 같은 가드(테넌트 맥락·자격 id 확인, 실패 삼킴)를 쓰게 한 곳에 모았다. 못 걸면 빈 값, 어떤
   * 예외도 던지지 않는다.
   */
  private Optional<Instant> markWaiting(AssistantSpec spec, Instant resetsAt) {
    try {
      if (TenantContext.get() == null) return Optional.empty();
      Long credentialId = credentialIdOf(spec);
      if (credentialId == null) return Optional.empty();
      return Optional.of(waitService.mark(credentialId, spec.agentUserId(), resetsAt));
    } catch (RuntimeException e) {
      log.warn("사용 한도 대기 표시 중 오류(무시): agent={}", spec.agentUserId(), e);
      return Optional.empty();
    }
  }

  /** 사양이 자격 id 를 모르면(예전 생성자) 활성 자격을 다시 찾는다. */
  private Long credentialIdOf(AssistantSpec spec) {
    if (spec.credentialId() != null) return spec.credentialId();
    return waitService.usableCredentialId(spec.agentUserId()).orElse(null);
  }

  private static long currentTenantId() {
    Long t = TenantContext.get();
    return t == null ? 0L : t;
  }
}
