package com.workplace.auth.service;

import com.workplace.auth.exception.AssistantLimitWaitingException;
import java.time.Instant;
import java.util.Optional;

/**
 * 비서 해석 결과(WP-2108) — 셋 중 하나다. ① none: 부를 수 있는 비서가 없다 ② ready: 바로 부를 수 있다(spec) ③ waiting: 고른 비서의
 * 자격이 사용 한도 대기 중이다(다음 후보로 넘어가지 않는다 — 개인 비서가 쉬는 동안 공통 비서로 몰래 바꿔 부르면 안 된다).
 *
 * @param spec ready 일 때만 있다
 * @param credentialId waiting 일 때 대기 중인 자격 id
 * @param limitWaitUntil waiting 일 때 대기가 풀리는 시각
 */
public record AssistantResolution(AssistantSpec spec, Long credentialId, Instant limitWaitUntil) {

  /** 부를 수 있는 비서가 없다. */
  public static AssistantResolution none() {
    return new AssistantResolution(null, null, null);
  }

  /** 바로 부를 수 있다. */
  public static AssistantResolution ready(AssistantSpec spec) {
    return new AssistantResolution(spec, spec.credentialId(), null);
  }

  /** 고른 비서의 자격이 {@code until} 까지 대기 중이다. */
  public static AssistantResolution waiting(long credentialId, Instant until) {
    return new AssistantResolution(null, credentialId, until);
  }

  public boolean isReady() {
    return spec != null;
  }

  /** 부를 수 있는 비서가 아예 없다(ready 도 waiting 도 아니다). */
  public boolean isNone() {
    return !isReady() && !isWaiting();
  }

  public boolean isWaiting() {
    return limitWaitUntil != null;
  }

  /**
   * 대기 중이면 {@link AssistantLimitWaitingException} — 직접 요청(버튼·API)이 「비서 없음」 이 아니라 한도 안내(503 즉답)로 답하게
   * 한다. 대기가 아니면 아무것도 하지 않는다.
   */
  public void throwIfWaiting() {
    if (isWaiting()) throw new AssistantLimitWaitingException(limitWaitUntil);
  }

  /** ready 일 때만 사양 — 없음·대기는 빈 값(옮기지 않은 자동 호출부도 대기 동안 안전하게 멈춘다). */
  public Optional<AssistantSpec> readySpec() {
    return Optional.ofNullable(spec);
  }
}
