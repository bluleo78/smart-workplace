package com.workplace.global.realtime;

import com.workplace.global.json.JsonMappers;
import com.workplace.global.realtime.relay.RelayMessage;
import com.workplace.global.realtime.relay.SseEventRelay;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import tools.jackson.databind.ObjectMapper;

/**
 * 유저당 SSE emitter 레지스트리. chat·messaging 등 도메인에 관계없이 공유되는 범용 레지스트리.
 *
 * <p>firehub-api 의 SseEmitterRegistry 패턴 재사용 — in-memory. heartbeat(30s)로 죽은 연결을 감지·정리하고, emitter
 * timeout(1h)으로 장수명 연결을 주기적으로 재활용(만료 시 클라가 fresh 토큰으로 재연결 → 30분 access token 재인증 경로). 등록·전송·정리 규칙은
 * {@link KeyedSseEmitters} 가 맡는다(runner 변경 스트림과 공유).
 *
 * <p>이벤트 발행(fanOut·closeAll)은 파드 사이 중계({@link SseEventRelay}, WP-1973)로만 내고 로컬로 직접 보내지 않는다 — 도착한
 * 메시지는 {@code RelayLocalDispatcher} 가 {@link #deliverLocal}·{@link #closeLocal} 로 자기 파드의 연결에 전달해 전달
 * 경로가 한 곳이다. 중계를 끈 상태(Noop)에서는 발행이 곧바로 그 경로로 돌아 지금과 같은 로컬 직행이 된다.
 *
 * <p>키가 userId 하나뿐이라 한 유저의 chat·messaging emitter 가 같은 키 아래 모인다 → fanOut 은 eventName 으로 구분된 이벤트를 해당
 * 유저의 모든 스트림에 보낸다(클라가 event 이름으로 필터). 또 {@code MAX_EMITTERS_PER_USER} 한도는 도메인 합산 공유 예산이다.
 */
@Slf4j
@Component
public class SseRegistry {

  private static final long EMITTER_TIMEOUT = 3_600_000L; // 1h
  private static final int MAX_EMITTERS_PER_USER = 5; // 탭/기기 다중 허용

  /** payload 직렬화 전용 공유 매퍼 — 중계 메시지와 로컬 전달이 같은 문자열을 쓰게 한 곳에서 만든다(WP-1609). */
  private static final ObjectMapper JSON = JsonMappers.JACKSON2;

  /** 끊김 시각을 기억하는 기간 — 지나면 「언제 끊겼는지 모름」으로 돌아간다. */
  private static final Duration DISCONNECT_RETENTION = Duration.ofDays(1);

  /**
   * 사용자의 마지막 연결이 끊긴 시각(WP-1201 — AI 위임 작업 「AI별」 보기의 「연결 끊김 · n분째」). 연결이 하나라도 있으면 키가 없다. 서버가 다시 뜨면
   * 비어 있어 그 전 끊김 시각은 모른다(연결 없음 + 시각 없음). 파드마다 따로 있는 in-memory 기록이라 여러 대를 띄워도 lastSeen 은 자기 파드 연결만
   * 본다(중계가 바꾸지 않는 한계). 등록·마지막 연결 정리 콜백이 emitter 묶음의 compute 안에서 고쳐 같은 키의 순서가 섞이지 않는다.
   */
  private final ConcurrentHashMap<Long, Instant> disconnectedAt = new ConcurrentHashMap<>();

  private final KeyedSseEmitters<Long> emitters;

  /** 파드 사이 중계 — fanOut·closeAll 은 이것만 통해 발행하고 로컬 전달은 수신 경로가 맡는다. */
  private final SseEventRelay relay;

  public SseRegistry(SseEventRelay relay) {
    this.relay = relay;
    this.emitters =
        new KeyedSseEmitters<>(
            EMITTER_TIMEOUT,
            MAX_EMITTERS_PER_USER,
            // 다시 붙었으니 끊김 시각을 지운다.
            disconnectedAt::remove,
            userId -> disconnectedAt.put(userId, Instant.now()));
  }

  /** 유저의 새 SSE 연결 등록. 한도 초과 시 가장 오래된 연결을 complete. */
  public SseEmitter register(Long userId) {
    return emitters.register(userId);
  }

  /**
   * 지정 유저들의 연결에 이벤트 발행(미연결 유저는 수신에서 skip). 로컬로 직접 보내지 않고 중계로만 내고, 전달은 도착 메시지의 {@link #deliverLocal}
   * 한 곳에서 한다(WP-1973 — 경로 하나). best-effort.
   */
  public void fanOut(Collection<Long> userIds, String eventName, Object payload) {
    if (userIds == null || userIds.isEmpty()) {
      // 받을 연결이 없으면 빈 대상 NOTIFY 를 쏘지 않는다(WP-1973 리뷰 — 채널 트래픽만 늘고 아무도 받지 않는다).
      return;
    }
    relay.publish(
        new RelayMessage(RelayMessage.TARGET_USER, eventName, toJson(payload), toJson(userIds)));
  }

  /**
   * 유저의 모든 SSE 연결을 닫는다(WP-420 — 워크스페이스 멤버십 정지 시 열린 스트림이 계속 이벤트를 받지 않게) — 발행 파드의 로컬은 곧바로 닫고(아래), 다른
   * 파드는 중계로 닫는다.
   *
   * <p>키가 userId 뿐이라 테넌트를 가려 닫을 수 없어 그 유저의 모든 스트림을 닫는다. 중계라 모든 파드의 그 유저 연결이 닫히고(중계 끄기 상태에서는 발행이 곧바로
   * {@link #closeLocal} 로 돌아와 지금과 같다), 클라이언트는 새(갱신된) 토큰으로 재연결하므로 다른 워크스페이스 세션은 잠깐 끊겼다 다시 붙고, 정지된
   * 워크스페이스 토큰은 인증 필터에서 401 이 나 재연결되지 않는다.
   */
  public void closeAll(Long userId) {
    // 발행 파드는 곧바로 로컬을 닫는다(멱등) — 중계로만 닫으면 발행 커넥션 끊김·발행 큐 넘침·이 파드 LISTEN 재연결
    // 백오프 중에 열려 있던 로컬 emitter 가 어느 파드에서도 닫히지 않는다(파드 1대여도 — WP-1973 리뷰).
    closeLocal(userId);
    // 중계는 다른 파드용이다 — 발행 파드는 위에서 이미 로컬을 닫았고, 되돌아온 유선 닫힘은 NOTIFY 왕복 중 재연결한 스트림을
    // 다시 닫으므로 중계가 자기가 보낸 것을 제외한다(pub — WP-1973 리뷰 3차 선택). 이벤트에는 pub 를 싣지 않는다.
    relay.publish(RelayMessage.closeUser(userId));
  }

  /**
   * 중계 수신·중계 끄기(Noop) 공통 로컬 전달 — 도착한 이벤트를 자기 파드에 연결된 emitter 로만 이미 만든 JSON 문자열 그대로 보낸다(중계 메시지의
   * payload 를 emitter 마다 다시 직렬화하지 않는다).
   */
  public void deliverLocal(String event, String payloadJson, long[] userIds) {
    List<Long> ids = new ArrayList<>(userIds.length);
    for (long userId : userIds) {
      ids.add(userId);
    }
    emitters.sendJson(ids, event, payloadJson);
  }

  /** 중계로 온 닫힘 신호 — emitters.closeAll 을 그대로 부른다(마지막 연결 콜백·끊김 시각 기록 포함). */
  public void closeLocal(long userId) {
    emitters.closeAll(userId);
  }

  /**
   * payload 를 한 번만 JSON 문자열로 만든다 — 중계 메시지의 payloadJson·keysJson 이 되어 로컬 전달까지 같은 문자열을 쓴다(emitter 마다
   * 다시 직렬화하지 않는다). runner 레지스트리도 같이 쓰는 공용 정적 헬퍼.
   */
  public static String toJson(Object payload) {
    try {
      return JSON.writeValueAsString(payload);
    } catch (Exception e) {
      log.warn("SSE payload 직렬화 실패: {}", e.getMessage());
      return "{}";
    }
  }

  /** 30초 heartbeat 코멘트로 죽은 연결 감지·정리. */
  @Scheduled(fixedRate = 30_000)
  public void sendHeartbeat() {
    // 끊김 시각은 하루가 지나면 버린다 — 다시 붙지 않는 사용자(대부분 사람)의 기록이 서버 수명 내내 쌓이지 않게.
    Instant cutoff = Instant.now().minus(DISCONNECT_RETENTION);
    disconnectedAt.values().removeIf(t -> t.isBefore(cutoff));
    emitters.heartbeat();
  }

  /**
   * 사용자가 마지막으로 연결돼 있던 시각(WP-1201) — 지금 연결이 있으면 지금, 끊겼으면 끊긴 시각, 이 서버가 뜬 뒤 한 번도 안 붙었으면(또는 하루 넘게 끊겨
   * 정리됐으면) 비어 있다. 끊긴 지 얼마나 됐는지·연결로 볼지는 호출부가 정한다.
   */
  public Optional<Instant> lastSeen(long userId) {
    if (emitters.isConnected(userId)) return Optional.of(Instant.now());
    return Optional.ofNullable(disconnectedAt.get(userId));
  }

  /** 테스트/모니터링용 — 현재 연결된 유저 수. */
  public int connectedUserCount() {
    return emitters.keyCount();
  }
}
