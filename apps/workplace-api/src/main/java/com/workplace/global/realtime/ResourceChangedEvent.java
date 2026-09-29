package com.workplace.global.realtime;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 범용 리소스 변경 이벤트 (WP-36/WP-59) — 서버 측 C/U/D 를 브라우저 캐시 무효화 신호로 전파하기 위한 단일 계약.
 *
 * <p>AI Chat(MCP·ai-agent 도구·확인카드)이나 다른 탭/사용자의 변경은 브라우저 mutation 을 거치지 않으므로, 서비스가 쓰기 트랜잭션 안에서 이
 * 이벤트를 발행하고 {@link ResourceSseDispatcher} 가 커밋 후 scope 수신자에게 {@code resource.changed} 로 보낸다.
 *
 * @param resource 리소스 종류(예: "issue") — 프론트 무효화 맵의 키
 * @param op created/updated/deleted
 * @param scopeType 수신자 결정 단위(예: "PROJECT") — {@link AudienceResolver#scopeType()} 과 매칭
 * @param scopeId scope 식별자(예: projectId)
 * @param ids 변경된 엔티티 id 목록(일괄 작업은 한 이벤트에 여러 id)
 * @param attrs 프론트 쿼리 키 구성용 부가 값(예: projectKey, issueNumber) — payload 에 평탄화
 * @param actorId 변경 주체(없으면 null)
 * @param extraRecipients scope 조회로 잡히지 않는 추가 수신자(예: 방금 제거된 멤버)
 */
public record ResourceChangedEvent(
    String resource,
    String op,
    String scopeType,
    long scopeId,
    List<Long> ids,
    Map<String, Object> attrs,
    Long actorId,
    Set<Long> extraRecipients) {

  public static final String OP_CREATED = "created";
  public static final String OP_UPDATED = "updated";
  public static final String OP_DELETED = "deleted";
}
