package com.workplace.support;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.global.realtime.SseRegistry;
import java.util.Collection;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Predicate;
import org.mockito.invocation.Invocation;

/**
 * resource.changed 통합 테스트 공용 캡처 헬퍼 (WP-36). 목(mock) {@link SseRegistry} 의 fanOut 호출 중 조건에 맞는 첫 이벤트의
 * (수신자, payload) 를 돌려준다 — 도메인별 *ResourceChangedIntegrationTest 가 같은 ArgumentCaptor 루프를 반복하지 않게 한다.
 * 커밋 후 발화를 최대 2초 기다린다.
 *
 * <p>WP-2117: 레지스트리 mock 은 컨텍스트가 공유돼 다른 테스트의 늦은 이벤트가 섞인다. 「아무 이벤트나 오면 깨어난 뒤 찾기」는 그 이벤트에 먼저 깨어나 이
 * 테스트 이벤트를 기다리지 않고 미수신으로 실패했다 — 그래서 payload 조건에 맞는 호출이 올 때까지 기다린다.
 */
public final class ResourceChangedCapture {

  /** 캡처 결과 — 수신자 id 목록과 평탄화된 payload. */
  public record Captured(Collection<Long> recipients, Map<String, Object> payload) {}

  /** 커밋 후 발화를 기다리는 기본 상한(ms). */
  private static final long DEFAULT_TIMEOUT_MS = 2000;

  private ResourceChangedCapture() {}

  /** resource/op 조합의 첫 resource.changed 를 캡처한다. 없으면 AssertionError. */
  public static Captured capture(SseRegistry registry, String resource, String op) {
    return capture(
        registry,
        p -> resource.equals(p.get("resource")) && op.equals(p.get("op")),
        resource + "/" + op);
  }

  /** payload 조건(match)에 맞는 첫 resource.changed 를 캡처한다. description 은 실패 메시지용. */
  public static Captured capture(
      SseRegistry registry, Predicate<Map<String, Object>> match, String description) {
    return capture(registry, match, description, DEFAULT_TIMEOUT_MS);
  }

  /** 기다림 상한(timeoutMs)을 정해 캡처한다 — 미수신 경로를 보는 단위 테스트가 2초를 다 기다리지 않게 한다. */
  @SuppressWarnings("unchecked")
  static Captured capture(
      SseRegistry registry,
      Predicate<Map<String, Object>> match,
      String description,
      long timeoutMs) {
    // 조건이 낸 첫 예외 — 「맞지 않음」으로 삼키되 미수신 오류에 붙여, 조건을 잘못 쓴 실패가 그냥 미수신으로 보이지 않게 한다(WP-2117 리뷰 후속).
    AtomicReference<Throwable> swallowed = new AtomicReference<>();
    try {
      // 맞는 payload 의 호출이 올 때까지 기다린다 — 다른 이벤트로는 깨어나지 않는다.
      verify(registry, timeout(timeoutMs).atLeastOnce())
          .fanOut(
              any(),
              eq("resource.changed"),
              argThat(
                  p -> p instanceof Map && safeTest(match, (Map<String, Object>) p, swallowed)));
    } catch (AssertionError e) {
      // Mockito 의 WantedButNotInvoked 등 타임아웃 실패를 미수신 메시지로 바꾼다.
      throw missing(description, e, swallowed);
    }
    // 맞는 호출이 확인됐으니 기록된 호출에서 첫 번째를 꺼낸다(호출 순서 유지).
    for (Invocation inv : mockingDetails(registry).getInvocations()) {
      if (!"fanOut".equals(inv.getMethod().getName())
          || !"resource.changed".equals(inv.getArgument(1))) {
        continue;
      }
      Object p = inv.getArgument(2);
      if (p instanceof Map && safeTest(match, (Map<String, Object>) p, swallowed)) {
        return new Captured(inv.getArgument(0), (Map<String, Object>) p);
      }
    }
    throw missing(description, null, swallowed);
  }

  /**
   * 미수신 오류를 만든다 — 조건이 예외를 냈으면 그 예외를 suppressed 로 붙인다. 그 예외는 다른 테스트의 payload 에서 났을 수도 있어(공유 mock)
   * 메시지에 그렇게 밝힌다.
   */
  private static AssertionError missing(
      String description, Throwable cause, AtomicReference<Throwable> swallowed) {
    Throwable first = swallowed.get();
    if (first == null) {
      return new AssertionError("resource.changed " + description + " 미수신", cause);
    }
    AssertionError error =
        new AssertionError(
            "resource.changed "
                + description
                + " 미수신 (조건이 어떤 payload 에서 예외를 냄 — suppressed 참고, 다른 테스트의 payload 일 수 있음)",
            cause);
    error.addSuppressed(first);
    return error;
  }

  /**
   * 조건을 시험하되 예외는 「맞지 않음」으로 본다 (WP-2117). 조건은 다른 테스트의 payload 에도 불리므로, 기대한 키가 없는 payload 에서 조건이 예외를
   * 내면(단언 실패 포함) verify 밖으로 새어 이 테스트의 이벤트를 기다리지 못한다. 삼킨 예외는 swallowed 에 남겨 미수신 오류에 붙인다.
   */
  private static boolean safeTest(
      Predicate<Map<String, Object>> match,
      Map<String, Object> p,
      AtomicReference<Throwable> swallowed) {
    try {
      return match.test(p);
    } catch (RuntimeException | AssertionError e) {
      // 조건 안의 단언(assertThat 등) 실패도 「맞지 않음」이다 — 새어 나가면 verify 의 기다림이 바로 끊긴다.
      // 첫 예외만 남긴다 — 기다리는 동안 같은 payload 에 매번 다시 불려 마지막 값은 덮어쓰기일 뿐이다.
      swallowed.compareAndSet(null, e);
      return false;
    }
  }
}
