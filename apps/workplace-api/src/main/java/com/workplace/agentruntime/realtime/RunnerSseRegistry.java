package com.workplace.agentruntime.realtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.realtime.KeyedSseEmitters;
import java.util.List;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * runner 변경 스트림 레지스트리(WP-1249) — 키 (테넌트, 실행 위치). 사용자용 {@code SseRegistry}(키 userId)와 섞지 않으려고 따로 두고,
 * 등록·전송·정리 규칙은 {@link KeyedSseEmitters} 를 함께 쓴다.
 *
 * <p>인스턴스 메모리에 있어 API 를 여러 대 띄우면 다른 인스턴스에 붙은 runner 는 이벤트를 놓친다. 이벤트는 「빨리 알기」용이고 정합성은 runner 의 5분 주기
 * 조회가 맞춘다(계약 문서·docs/ops/multi-instance.md).
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

  public RunnerSseRegistry(ObjectMapper objectMapper) {
    this.emitters =
        new KeyedSseEmitters<>(objectMapper, EMITTER_TIMEOUT, MAX_EMITTERS_PER_LOCATION);
  }

  /** 새 연결을 만들어 등록하고 첫 코멘트 {@code connected} 로 응답 헤더를 바로 내보낸다. */
  public SseEmitter register(long tenantId, long locationId) {
    return emitters.register(new Key(tenantId, locationId));
  }

  /** 그 위치의 모든 연결에 이벤트를 보낸다(연결이 없으면 아무것도 하지 않음). 실패한 연결은 정리한다. best-effort. */
  public void send(long tenantId, long locationId, String eventName, Object payload) {
    emitters.send(List.of(new Key(tenantId, locationId)), eventName, payload);
  }

  /** 그 위치의 모든 연결을 서버 쪽에서 닫는다 — 토큰 재발급·위치 삭제 뒤 옛 토큰의 스트림이 남지 않게(이 인스턴스 것만). */
  public void closeAll(long tenantId, long locationId) {
    emitters.closeAll(new Key(tenantId, locationId));
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
