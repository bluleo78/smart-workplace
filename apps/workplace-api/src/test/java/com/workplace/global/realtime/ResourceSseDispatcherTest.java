package com.workplace.global.realtime;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** ResourceSseDispatcher 단위 테스트 — scope 리졸버 선택·추가 수신자 병합·payload 평탄화 검증 (WP-59). */
class ResourceSseDispatcherTest {

  private final SseRegistry registry = mock(SseRegistry.class);

  private static AudienceResolver resolver(String type, List<Long> ids) {
    return new AudienceResolver() {
      public String scopeType() {
        return type;
      }

      public Collection<Long> resolve(long scopeId) {
        return scopeId == 7L ? ids : List.of();
      }
    };
  }

  private ResourceSseDispatcher dispatcher() {
    return new ResourceSseDispatcher(registry, List.of(resolver("PROJECT", List.of(1L, 2L))));
  }

  @Test
  void fansOutToResolvedAudienceWithFlattenedPayload() {
    dispatcher()
        .onChanged(
            new ResourceChangedEvent(
                "issue",
                ResourceChangedEvent.OP_UPDATED,
                "PROJECT",
                7L,
                List.of(39L),
                Map.of("projectKey", "EX", "issueNumber", 21),
                1L,
                Set.of()));

    verify(registry)
        .fanOut(
            argThat((Collection<Long> c) -> Set.copyOf(c).equals(Set.of(1L, 2L))),
            eq("resource.changed"),
            argThat(
                (Object o) -> {
                  @SuppressWarnings("unchecked")
                  var p = (Map<String, Object>) o;
                  return "issue".equals(p.get("resource"))
                      && "updated".equals(p.get("op"))
                      && "EX".equals(p.get("projectKey"))
                      && Integer.valueOf(21).equals(p.get("issueNumber"))
                      && List.of(39L).equals(p.get("ids"));
                }));
  }

  /** 제거된 멤버처럼 scope 조회로는 안 잡히는 사용자도 받아야 한다 — extraRecipients 병합. */
  @Test
  void mergesExtraRecipients() {
    dispatcher()
        .onChanged(
            new ResourceChangedEvent(
                "project", "updated", "PROJECT", 7L, List.of(), Map.of(), 1L, Set.of(9L)));

    verify(registry)
        .fanOut(
            argThat((Collection<Long> c) -> Set.copyOf(c).equals(Set.of(1L, 2L, 9L))),
            eq("resource.changed"),
            any());
  }

  /** 알 수 없는 scope 타입·빈 멤버 — 예외 없이 extraRecipients 만(여기선 0명). */
  @Test
  void unknownScopeFansOutToNobodyWithoutThrowing() {
    dispatcher()
        .onChanged(
            new ResourceChangedEvent(
                "x", "updated", "NOPE", 7L, List.of(), Map.of(), 1L, Set.of()));

    verify(registry)
        .fanOut(argThat((Collection<Long> c) -> c.isEmpty()), eq("resource.changed"), any());
  }

  /** attrs 가 예약 키(op 등)를 담아도 고정 필드가 이겨야 한다. */
  @Test
  void attrsCannotOverwriteReservedPayloadKeys() {
    dispatcher()
        .onChanged(
            new ResourceChangedEvent(
                "issue",
                "updated",
                "PROJECT",
                7L,
                List.of(39L),
                Map.of("op", "hacked", "resource", "evil", "projectKey", "EX"),
                1L,
                Set.of()));

    verify(registry)
        .fanOut(
            any(),
            eq("resource.changed"),
            argThat(
                (Object o) -> {
                  @SuppressWarnings("unchecked")
                  var p = (Map<String, Object>) o;
                  return "updated".equals(p.get("op"))
                      && "issue".equals(p.get("resource"))
                      && "EX".equals(p.get("projectKey"));
                }));
  }
}
