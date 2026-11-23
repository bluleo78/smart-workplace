package com.workplace.global.realtime.relay;

import java.util.function.Consumer;

/**
 * SSE 파드 사이 중계 인터페이스(WP-1973) — 레지스트리(SseRegistry·RunnerSseRegistry) 는 이것만 알고 발행(파드 A)과 로컬 전달(수신
 * 파드)을 갈라 둔다(의존성 역전).
 *
 * <p>끄기 구현({@link NoopSseEventRelay})은 publish 를 곧바로 수신자에게 넘겨 지금과 같은 로컬 직행을 유지하고, 켜기 구현은 PostgreSQL
 * NOTIFY 로 모든 파드에 알린다. 두 구현 모두 발행·수신에 Hikari 풀을 쓰지 않는다(WP-751 재발 방지).
 */
public interface SseEventRelay {

  /** 메시지를 중계한다 — 어디서든 불러도 된다(트랜잭션 상관없음). 커밋 시점은 발행 구현이 정하고, 실패가 호출부를 멈추지 않도록 best-effort 로 처리한다. */
  void publish(RelayMessage message);

  /**
   * 도착 메시지를 받을 수신자 등록 — {@link RelayLocalDispatcher} 가 startup 에 딱 한 번 부른다. 등록 뒤에는 publish 한 메시지가 이
   * 수신자에게 전달된다.
   */
  void onMessage(Consumer<RelayMessage> receiver);
}
