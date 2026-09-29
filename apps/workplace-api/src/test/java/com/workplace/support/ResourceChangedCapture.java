package com.workplace.support;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.global.realtime.SseRegistry;
import java.util.Collection;
import java.util.Map;
import java.util.function.Predicate;
import org.mockito.ArgumentCaptor;

/**
 * resource.changed 통합 테스트 공용 캡처 헬퍼 (WP-36). 목(mock) {@link SseRegistry} 의 fanOut 호출 중 조건에 맞는 첫 이벤트의
 * (수신자, payload) 를 돌려준다 — 도메인별 *ResourceChangedIntegrationTest 가 같은 ArgumentCaptor 루프를 반복하지 않게 한다.
 * 커밋 후 발화를 최대 2초 기다린다.
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
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
    verify(registry, timeout(2000).atLeastOnce())
        .fanOut(ids.capture(), eq("resource.changed"), payload.capture());
    for (int i = 0; i < payload.getAllValues().size(); i++) {
      var p = (Map<String, Object>) payload.getAllValues().get(i);
      if (match.test(p)) {
        return new Captured(ids.getAllValues().get(i), p);
      }
    }
    throw new AssertionError("resource.changed " + description + " 미수신");
  }
}
