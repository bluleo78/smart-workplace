package com.workplace.agentruntime.outbound;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.tenant.TenantContext;
import com.workplace.user.outbound.TenantAdminAudienceResolver;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * AI 실행 상태 변경 → {@link ResourceChangedEvent}({@code resource: "agent-runtime"}) 발행
 * 헬퍼(WP-1254·1255). 관리자 화면(AI 목록의 실행 상태·AI 별 실행 설정·실행 위치)이 새로 고치지 않아도 바뀐 것을 보이게 한다 — 웹은 이 리소스를 받으면
 * AI 실행 관련 조회를 모두 무효화한다.
 *
 * <p>수신자는 이 워크스페이스의 활성 ADMIN({@link TenantAdminAudienceResolver}) — 화면이 모두 {@code @RequireAdmin}
 * API 를 쓴다. 디스패처가 커밋 직전에 수신자를 고르고 커밋 뒤에 보낸다(롤백되면 보내지 않는다, 커넥션을 더 빌리지 않는다). 그래서 반드시 쓰기 트랜잭션 안에서, 그리고
 * 커밋 직전 콜백 밖에서 부른다(커밋 직전 콜백 안에서 낸 이벤트는 디스패처에 닿지 않는다).
 *
 * <p>호출자는 화면에 보이는 것이 실제로 바뀐 때만 부른다 — 바뀐 것이 없는 저장·같은 내용의 보고는 알리지 않는다.
 */
@Component
@RequiredArgsConstructor
public class AgentRuntimeChangeNotifier {

  /** 리소스 이름 — 프론트 무효화 맵(resource-contract.json) 키와 계약 테스트로 일치를 고정한다. */
  public static final String RESOURCE_AGENT_RUNTIME = "agent-runtime";

  private final ApplicationEventPublisher publisher;

  /**
   * AI 들의 실행 설정·상태가 바뀌었다 — ids 는 바뀐 AI id. 비어 있으면 아무것도 내지 않는다.
   *
   * @param op created/updated/deleted
   * @param actorId 바꾼 관리자(runner·AI 보고면 null)
   */
  public void agentsChanged(String op, Collection<Long> agentUserIds, Long actorId) {
    if (agentUserIds.isEmpty()) return;
    publish(op, agentUserIds, Map.of(), actorId);
  }

  /** AI 한 명의 실행 설정·상태가 바뀌었다. */
  public void agentChanged(String op, long agentUserId, Long actorId) {
    agentsChanged(op, List.of(agentUserId), actorId);
  }

  /**
   * 실행 위치가 바뀌었다(등록·수정·기본 이동·토큰 재발급·삭제) — ids 는 비우고 위치 id 를 {@code locationId} 로 싣는다. 위치 이름·기본 여부는
   * AI 목록의 실행 위치 표시에도 쓰이므로 같은 리소스로 알린다.
   */
  public void locationChanged(String op, long locationId, Long actorId) {
    publish(op, List.of(), Map.of("locationId", locationId), actorId);
  }

  private void publish(String op, Collection<Long> ids, Map<String, Object> attrs, Long actorId) {
    long tenantId = TenantContext.require();
    publisher.publishEvent(
        ResourceChangedEvent.of(
            RESOURCE_AGENT_RUNTIME,
            op,
            TenantAdminAudienceResolver.SCOPE,
            tenantId,
            ids,
            attrs,
            actorId));
  }
}
