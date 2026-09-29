package com.workplace.global.realtime;

import java.util.Collection;

/**
 * scope 타입별 SSE 수신자 조회 SPI (WP-59). 각 도메인 모듈이 자기 scope(PROJECT·WIKI_SPACE·CHANNEL 등)를 구현해 빈으로 등록한다
 * — global 디스패처가 도메인 저장소를 직접 import 하지 않도록(모듈 경계) 뒤집은 의존.
 */
public interface AudienceResolver {

  /** 담당 scope 타입 이름 — {@link ResourceChangedEvent#scopeType()} 과 일치해야 선택된다. */
  String scopeType();

  /** scope 의 수신자 userId 목록. REQUIRES_NEW 트랜잭션 안에서 호출되므로 RLS 가 적용된 조회를 그대로 써도 된다. */
  Collection<Long> resolve(long scopeId);
}
