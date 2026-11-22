package com.workplace.global.realtime;

import java.util.Collection;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import tools.jackson.databind.ObjectMapper;

/**
 * 유저당 SSE emitter 레지스트리. chat·messaging 등 도메인에 관계없이 공유되는 범용 레지스트리.
 *
 * <p>firehub-api 의 SseEmitterRegistry 패턴 재사용 — in-memory, 단일 노드 MVP. heartbeat(30s)로 죽은 연결을
 * 감지·정리하고, emitter timeout(1h)으로 장수명 연결을 주기적으로 재활용(만료 시 클라가 fresh 토큰으로 재연결 → 30분 access token 재인증
 * 경로). 등록·전송·정리 규칙은 {@link KeyedSseEmitters} 가 맡는다(runner 변경 스트림과 공유).
 *
 * <p>키가 userId 하나뿐이라 한 유저의 chat·messaging emitter 가 같은 키 아래 모인다 → fanOut 은 eventName 으로 구분된 이벤트를 해당
 * 유저의 모든 스트림에 보낸다(클라가 event 이름으로 필터). 또 {@code MAX_EMITTERS_PER_USER} 한도는 도메인 합산 공유 예산이다.
 */
@Component
public class SseRegistry {

  private static final long EMITTER_TIMEOUT = 3_600_000L; // 1h
  private static final int MAX_EMITTERS_PER_USER = 5; // 탭/기기 다중 허용

  private final KeyedSseEmitters<Long> emitters;

  public SseRegistry(ObjectMapper objectMapper) {
    this.emitters = new KeyedSseEmitters<>(objectMapper, EMITTER_TIMEOUT, MAX_EMITTERS_PER_USER);
  }

  /** 유저의 새 SSE 연결 등록. 한도 초과 시 가장 오래된 연결을 complete. */
  public SseEmitter register(Long userId) {
    return emitters.register(userId);
  }

  /** 지정 유저들의 연결된 emitter 로 이벤트 전송 (미연결 유저는 skip). best-effort. */
  public void fanOut(Collection<Long> userIds, String eventName, Object payload) {
    emitters.send(userIds, eventName, payload);
  }

  /**
   * 유저의 모든 SSE 연결을 서버 쪽에서 닫는다(WP-420 — 워크스페이스 멤버십 정지 시 열린 스트림이 계속 이벤트를 받지 않게).
   *
   * <p>키가 userId 뿐이라 테넌트를 가려 닫을 수 없어 그 유저의 모든 스트림을 닫는다. 클라이언트는 새(갱신된) 토큰으로 재연결하므로 다른 워크스페이스 세션은 잠깐
   * 끊겼다 다시 붙고, 정지된 워크스페이스 토큰은 인증 필터에서 401 이 나 재연결되지 않는다.
   */
  public void closeAll(Long userId) {
    emitters.closeAll(userId);
  }

  /** 30초 heartbeat 코멘트로 죽은 연결 감지·정리. */
  @Scheduled(fixedRate = 30_000)
  public void sendHeartbeat() {
    emitters.heartbeat();
  }

  /**
   * 이 파드에 유저의 SSE 연결이 하나라도 있는지 — 연결 시각 기록기(WP-1975)가 끊김을 가린다. 「외부 AI 연결됨」 판정은 이 값이 아니라
   * DB(agent_connection)를 읽는다.
   */
  public boolean isConnected(long userId) {
    return emitters.isConnected(userId);
  }

  /** 테스트/모니터링용 — 현재 연결된 유저 수. */
  public int connectedUserCount() {
    return emitters.keyCount();
  }
}
