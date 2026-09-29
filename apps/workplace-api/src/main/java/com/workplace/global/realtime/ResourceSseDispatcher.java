package com.workplace.global.realtime;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * {@link ResourceChangedEvent} → 브라우저 SSE {@code resource.changed} 단일 디스패처 (WP-59).
 *
 * <p>커밋된 변경만 알린다(AFTER_COMMIT — 롤백된 쓰기는 발화 안 함). {@code REQUIRES_NEW} 는 커밋 후 사라진 트랜잭션-로컬 GUC 를
 * TenantAwareTransactionManager 가 재주입하게 해 리졸버의 RLS 조회가 빈 목록이 되지 않게 한다(IssueSseDispatcher 와 동일 패턴).
 */
@Slf4j
@Component
public class ResourceSseDispatcher {

  public static final String EVENT_NAME = "resource.changed";

  private final SseRegistry registry;
  private final Map<String, AudienceResolver> resolvers;

  public ResourceSseDispatcher(SseRegistry registry, List<AudienceResolver> resolvers) {
    this.registry = registry;
    this.resolvers =
        resolvers.stream()
            .collect(Collectors.toMap(AudienceResolver::scopeType, Function.identity()));
  }

  // AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입.
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onChanged(ResourceChangedEvent e) {
    Set<Long> recipients = new LinkedHashSet<>();
    AudienceResolver resolver = resolvers.get(e.scopeType());
    if (resolver != null) {
      recipients.addAll(resolver.resolve(e.scopeId()));
    } else {
      // 리졸버 누락은 개발 실수 — 커밋 후 흐름을 깨지 않도록 예외 대신 경고만 남긴다.
      log.warn("AudienceResolver 없음: scopeType={} resource={}", e.scopeType(), e.resource());
    }
    if (e.extraRecipients() != null) recipients.addAll(e.extraRecipients());

    Map<String, Object> p = new LinkedHashMap<>();
    // attrs 를 먼저 깔고 고정 필드를 나중에 넣는다 — attrs 가 resource/op/... 예약 키를 덮어쓰지 못하게 한다.
    if (e.attrs() != null) p.putAll(e.attrs());
    p.put("resource", e.resource());
    p.put("op", e.op());
    p.put("scopeType", e.scopeType());
    p.put("scopeId", e.scopeId());
    p.put("ids", e.ids() == null ? List.of() : e.ids());
    p.put("actorId", e.actorId());
    registry.fanOut((Collection<Long>) recipients, EVENT_NAME, p);
  }
}
