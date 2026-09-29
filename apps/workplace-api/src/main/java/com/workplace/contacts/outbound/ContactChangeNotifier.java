package com.workplace.contacts.outbound;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.realtime.UserAudienceResolver;
import com.workplace.global.tenant.TenantContext;
import com.workplace.tenant.outbound.TenantAudienceResolver;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 외부 연락처·즐겨찾기 변경 → {@link ResourceChangedEvent} 발행 헬퍼 (WP-64). SHARED 연락처는 테넌트 전원의 목록에 보이므로 TENANT
 * 로, PERSONAL 은 소유자에게만 보낸다. 즐겨찾기는 호출자 본인 화면에만 영향이 있어 USER 로 보낸다. payload 에는 id 만 싣는다. 반드시 쓰기 트랜잭션
 * 안에서 호출해야 한다(AFTER_COMMIT).
 */
@Component
@RequiredArgsConstructor
public class ContactChangeNotifier {

  /** 리소스 이름 — 프론트 무효화 맵(resourceInvalidation RULES) 키와 계약 테스트로 일치를 고정한다. */
  public static final String RESOURCE_CONTACT = "contact";

  private final ApplicationEventPublisher publisher;

  /**
   * 연락처 자체의 생성·수정·삭제. sharedBeforeOrAfter — 변경 전이나 후 어느 한쪽이라도 SHARED 였는지(공유→개인 전환 시에도 다른 구성원의 목록에서
   * 사라져야 하므로 TENANT 로 보낸다). ownerId 는 연락처 소유자(ADMIN 이 대신 수정해도 소유자 기준).
   */
  public void contactChanged(
      String op, long contactId, long ownerId, boolean sharedBeforeOrAfter, Long actorId) {
    String scope = sharedBeforeOrAfter ? TenantAudienceResolver.SCOPE : UserAudienceResolver.SCOPE;
    long scopeId = sharedBeforeOrAfter ? TenantContext.require() : ownerId;
    publisher.publishEvent(
        ResourceChangedEvent.of(
            RESOURCE_CONTACT, op, scope, scopeId, List.of(contactId), Map.of(), actorId));
  }

  /** 즐겨찾기 추가·해제 — 호출자 본인의 목록(즐겨찾기 필터)에만 영향. */
  public void favoriteChanged(String op, long callerId) {
    publisher.publishEvent(
        ResourceChangedEvent.of(
            RESOURCE_CONTACT,
            op,
            UserAudienceResolver.SCOPE,
            callerId,
            List.of(),
            Map.of(),
            callerId));
  }
}
