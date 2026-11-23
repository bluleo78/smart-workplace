package com.workplace.agentruntime.realtime;

import com.workplace.global.realtime.KeyedSseEmitters;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.realtime.relay.RelayMessage;
import com.workplace.global.realtime.relay.SseEventRelay;
import java.util.List;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * runner 변경 스트림 레지스트리(WP-1249) — 키 (테넌트, 실행 위치). 사용자용 {@code SseRegistry}(키 userId)와 섞지 않으려고 따로 두고,
 * 등록·전송·정리 규칙은 {@link KeyedSseEmitters} 를 함께 쓴다.
 *
 * <p>발행(send·closeAll)은 파드 사이 중계({@link SseEventRelay}, WP-1973)로만 내고, 전달은 도착 메시지의 {@link
 * #deliverLocal}·{@link #closeLocal} 로 자기 파드의 연결에만 한다 — 사용자 스트림과 처리가 달라 메시지 target 을 {@code runner}
 * 로 구분한다. 중계를 끈 상태에서는 발행이 곧바로 그 경로로 돌아 지금과 같다.
 */
@Component
public class RunnerSseRegistry {

  /** 연결 수명 — 지나면 runner 가 다시 붙으며 토큰을 다시 검증받는다(재발급된 옛 토큰의 스트림이 오래 남지 않게). */
  private static final long EMITTER_TIMEOUT = 30 * 60_000L;

  /** 위치당 최대 연결 수 — runner 재시작·중복 기동으로 연결이 쌓이지 않게. 넘치면 가장 오래된 것을 닫는다. */
  static final int MAX_EMITTERS_PER_LOCATION = 3;

  /** 레지스트리 키 — 위치 id 는 전역 유일하지만 테넌트까지 묶어 다른 워크스페이스로 새지 않게 한다. */
  public record Key(long tenantId, long locationId) {}

  private final KeyedSseEmitters<Key> emitters;

  /** 파드 사이 중계 — send·closeAll 은 이것만 통해 발행하고 로컬 전달은 수신 경로가 맡는다. */
  private final SseEventRelay relay;

  public RunnerSseRegistry(SseEventRelay relay) {
    this.relay = relay;
    this.emitters = new KeyedSseEmitters<>(EMITTER_TIMEOUT, MAX_EMITTERS_PER_LOCATION);
  }

  /** 새 연결을 만들어 등록하고 첫 코멘트 {@code connected} 로 응답 헤더를 바로 내보낸다. */
  public SseEmitter register(long tenantId, long locationId) {
    return emitters.register(new Key(tenantId, locationId));
  }

  /**
   * 그 위치의 모든 연결에 이벤트 발행(연결이 없으면 수신에서 아무것도 하지 않음). 로컬로 직접 보내지 않고 중계로만 내며, 전달은 도착 메시지의 {@link
   * #deliverLocal} 한 곳에서 한다(WP-1973). best-effort.
   */
  public void send(long tenantId, long locationId, String eventName, Object payload) {
    relay.publish(
        new RelayMessage(
            RelayMessage.TARGET_RUNNER,
            eventName,
            SseRegistry.toJson(payload),
            keysJson(tenantId, locationId)));
  }

  /**
   * 그 위치의 모든 연결을 닫는다 — 토큰 재발급·위치 삭제 뒤 옛 토큰의 스트림이 남지 않게. 발행 파드의 로컬은 곧바로 닫고(아래), 다른 파드는 중계로 닫는다(중계 끄기
   * 상태에서는 발행이 곧바로 {@link #closeLocal} 로 돌아와 지금과 같다).
   */
  public void closeAll(long tenantId, long locationId) {
    // 발행 파드는 곧바로 로컬을 닫는다(멱등) — 중계로만 닫으면 발행이 도착하지 않는 동안 로컬 emitter 가 살아남는다
    // (WP-1973 리뷰 — SseRegistry.closeAll 과 같은 까닭).
    closeLocal(tenantId, locationId);
    // 중계는 다른 파드용이다 — 발행 파드는 위에서 이미 로컬을 닫았고, 되돌아온 유선 닫힘은 NOTIFY 왕복 중 재연결한 스트림을
    // 다시 닫으므로 중계가 자기가 보낸 것을 제외한다(pub — WP-1973 리뷰 3차 선택, SseRegistry.closeAll 과 같다).
    relay.publish(RelayMessage.closeRunner(tenantId, locationId));
  }

  /** 중계 수신·중계 끄기(Noop) 공통 로컬 전달 — 도착한 이벤트를 자기 파드의 그 위치 연결로만 이미 만든 JSON 문자열 그대로 보낸다. */
  public void deliverLocal(String event, String payloadJson, long tenantId, long locationId) {
    emitters.sendJson(List.of(new Key(tenantId, locationId)), event, payloadJson);
  }

  /** 중계로 온 닫힘 신호 — emitters.closeAll 을 그대로 부른다. */
  public void closeLocal(long tenantId, long locationId) {
    emitters.closeAll(new Key(tenantId, locationId));
  }

  /** runner 키 JSON {@code [tenantId, locationId]} — 유저 userId 배열과 섞이지 않게 runner 타깃 전용 형태. */
  private static String keysJson(long tenantId, long locationId) {
    return "[" + tenantId + "," + locationId + "]";
  }

  /** 테스트·모니터링용 — 그 위치의 연결 수. */
  public int connectionCount(long tenantId, long locationId) {
    return emitters.connectionCount(new Key(tenantId, locationId));
  }

  /** 30초 하트비트 — 죽은 연결을 찾아 정리하고, 중간 프록시가 idle 로 끊지 않게 한다. 파드마다 돌아야 해 분산 잠금을 걸지 않는다. */
  @Scheduled(fixedRate = 30_000)
  public void sendHeartbeat() {
    emitters.heartbeat();
  }
}
