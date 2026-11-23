package com.workplace.global.realtime.relay;

import java.util.function.Consumer;

/**
 * 중계를 끈 상태의 발행 구현(WP-1973) — publish 를 등록된 수신자에게 곧바로(동기) 넘겨, 파드가 하나뿐일 때·테스트 프로파일({@code
 * app.realtime.relay.enabled=false})에서 지금과 완전히 같은 로컬 직행 동작을 유지한다. 기존 통합 테스트가 새 커넥션 없이 그대로 통과하는 것이 이
 * 클래스의 몫이다.
 *
 * <p><b>운영(켜짐)과 다른 점(의도)</b> — 운영({@link PostgresSseEventRelay})은 트랜잭션의 커밋까지 기다렸다가 커밋된 발행만 내고 롤백은
 * 버리지만, Noop 은 트랜잭션 안에서도 바로 보낸다. 테스트 프로파일이 지금과 같은 동기·직행을 유지해야 기존 통합 테스트가 그대로 통과하기 때문이다. 이 차이 때문에
 * 커밋까지 미루고 롤백 시 버리는 운영 계약은 {@code app.realtime.relay.enabled=true} 검증 테스트({@code
 * SseEventRelayTransportTest})로만 고정한다(WP-1973 리뷰 6).
 */
public class NoopSseEventRelay implements SseEventRelay {

  /**
   * 등록된 수신자 — 수신 등록(RelayLocalDispatcher startup) 전에는 null 이므로, 그 전에 온 발행은 조용히 버린다(보낼 로컬 연결이 아직
   * 없음).
   */
  private volatile Consumer<RelayMessage> receiver;

  @Override
  public void publish(RelayMessage message) {
    Consumer<RelayMessage> current = receiver;
    if (current != null) current.accept(message); // 동기 — publish 안에서 전달이 끝난다
  }

  @Override
  public void onMessage(Consumer<RelayMessage> receiver) {
    this.receiver = receiver;
  }
}
