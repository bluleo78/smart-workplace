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

  private ResourceChangedCapture() {}

  /** resource/op 조합의 첫 resource.changed 를 캡처한다. 없으면 AssertionError. */
  public static Captured capture(SseRegistry registry, String resource, String op) {
    return capture(
        registry,
        p -> resource.equals(p.get("resource")) && op.equals(p.get("op")),
        resource + "/" + op);
  }

  /** payload 조건(match)에 맞는 첫 resource.changed 를 캡처한다. description 은 실패 메시지용. */
  @SuppressWarnings("unchecked")
  public static Captured capture(
      SseRegistry registry, Predicate<Map<String, Object>> match, String description) {
    try {
      // 맞는 payload 의 호출이 올 때까지 기다린다 — 다른 이벤트로는 깨어나지 않는다.
      verify(registry, timeout(2000).atLeastOnce())
          .fanOut(
              any(),
              eq("resource.changed"),
              argThat(p -> p instanceof Map && safeTest(match, (Map<String, Object>) p)));
    } catch (AssertionError e) {
      // Mockito 의 WantedButNotInvoked 등 타임아웃 실패를 미수신 메시지로 바꾼다.
      throw new AssertionError("resource.changed " + description + " 미수신", e);
    }
    // 맞는 호출이 확인됐으니 기록된 호출에서 첫 번째를 꺼낸다(호출 순서 유지).
    for (Invocation inv : mockingDetails(registry).getInvocations()) {
      if (!"fanOut".equals(inv.getMethod().getName())
          || !"resource.changed".equals(inv.getArgument(1))) {
        continue;
      }
      Object p = inv.getArgument(2);
      if (p instanceof Map && safeTest(match, (Map<String, Object>) p)) {
        return new Captured(inv.getArgument(0), (Map<String, Object>) p);
      }
    }
    throw new AssertionError("resource.changed " + description + " 미수신");
  }

  /**
   * 조건을 시험하되 예외는 「맞지 않음」으로 본다 (WP-2117). 조건은 다른 테스트의 payload 에도 불리므로, 기대한 키가 없는 payload 에서 조건이 예외를
   * 내면 verify 밖으로 새어 이 테스트의 이벤트를 기다리지 못한다.
   */
  private static boolean safeTest(Predicate<Map<String, Object>> match, Map<String, Object> p) {
    try {
      return match.test(p);
    } catch (RuntimeException e) {
      return false;
    }
  }
}
