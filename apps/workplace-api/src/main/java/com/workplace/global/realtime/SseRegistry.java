package com.workplace.global.realtime;

import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
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

  /** 끊김 시각을 기억하는 기간 — 지나면 「언제 끊겼는지 모름」으로 돌아간다. */
  private static final Duration DISCONNECT_RETENTION = Duration.ofDays(1);

  /**
   * 사용자의 마지막 연결이 끊긴 시각(WP-1201 — AI 위임 작업 「AI별」 보기의 「연결 끊김 · n분째」). 연결이 하나라도 있으면 키가 없다. 서버가 다시 뜨면
   * 비어 있어 그 전 끊김 시각은 모른다(연결 없음 + 시각 없음). 단일 노드 in-memory 라 API 를 여러 대 띄우면 다른 노드의 연결은 보이지 않는다 — 그때는
   * 공용 저장소(예: DB·Redis)로 옮겨야 한다. 등록·마지막 연결 정리 콜백이 emitter 묶음의 compute 안에서 고쳐 같은 키의 순서가 섞이지 않는다.
   */
  private final ConcurrentHashMap<Long, Instant> disconnectedAt = new ConcurrentHashMap<>();

  /** AI 키로 연 emitter 가 어느 사용자·키에서 왔는지(WP-2008). 키 없는(JWT 등) 연결은 넣지 않는다. 연결이 빠지면 같이 지운다. */
  private final ConcurrentHashMap<SseEmitter, KeyRef> keyRefs = new ConcurrentHashMap<>();

  /** emitter 를 연 사용자와 AI 키 id. */
  private record KeyRef(long userId, long keyId) {}

  private final KeyedSseEmitters<Long> emitters;

  public SseRegistry(ObjectMapper objectMapper) {
    this.emitters =
        new KeyedSseEmitters<>(
            objectMapper,
            EMITTER_TIMEOUT,
            MAX_EMITTERS_PER_USER,
            // 다시 붙었으니 끊김 시각을 지운다.
            disconnectedAt::remove,
            userId -> disconnectedAt.put(userId, Instant.now()),
            // 끊기거나 닫힌 emitter 의 키 기억을 남기지 않는다.
            keyRefs::remove);
  }

  /** 유저의 새 SSE 연결 등록. 한도 초과 시 가장 오래된 연결을 complete. */
  public SseEmitter register(Long userId) {
    return register(userId, null);
  }

  /** 유저의 새 SSE 연결 등록 + 연 AI 키 id 기억(WP-2008). agentKeyId 가 null 이면(JWT 등) 키 기억 없이 등록한다. */
  public SseEmitter register(Long userId, Long agentKeyId) {
    SseEmitter emitter = emitters.register(userId);
    if (agentKeyId != null) {
      keyRefs.put(emitter, new KeyRef(userId, agentKeyId));
      // 등록 직후 이미 끊겨 정리 콜백이 먼저 지나갔다면 기억이 남을 수 있어, 연결이 빠졌는지 다시 확인해 지운다.
      if (!emitters.contains(userId, emitter)) keyRefs.remove(emitter);
    }
    return emitter;
  }

  /** 그 AI 키로 연 스트림만 닫는다(WP-2008 — 키 폐기·AI 삭제). 같은 사용자의 다른 연결은 그대로 둔다. */
  public void closeByKey(long agentKeyId) {
    keyRefs.forEach(
        (emitter, ref) -> {
          if (ref.keyId() == agentKeyId) emitters.close(ref.userId(), emitter);
        });
  }

  /** 지금 열려 있는 AI 키 스트림의 키 id 들(복사본). */
  public Set<Long> openAgentKeyIds() {
    Set<Long> ids = new HashSet<>();
    for (KeyRef ref : keyRefs.values()) ids.add(ref.keyId());
    return ids;
  }

  /**
   * 확인한 키(checkedKeyIds) 중 activeKeyIds 에 없는 키(폐기됐거나 못 쓰게 된 키)의 스트림을 닫는다(WP-2008 — 이벤트를 놓친 경우의
   * 안전망). 확인하는 동안 새로 열린 스트림의 키는 checkedKeyIds 에 없어 활성 여부를 모르므로 건드리지 않는다(다음 주기에 확인).
   *
   * @return 닫은 emitter 수
   */
  public int closeInactiveKeys(Set<Long> checkedKeyIds, Set<Long> activeKeyIds) {
    int closed = 0;
    for (Map.Entry<SseEmitter, KeyRef> entry : keyRefs.entrySet()) {
      KeyRef ref = entry.getValue();
      if (!checkedKeyIds.contains(ref.keyId()) || activeKeyIds.contains(ref.keyId())) continue;
      // 그 사이 끊겨 이미 빠진 emitter 는 세지 않는다(로그에 실제로 닫은 수만).
      if (emitters.close(ref.userId(), entry.getKey())) closed++;
    }
    return closed;
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
