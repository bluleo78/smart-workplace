package com.workplace.global.realtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicReference;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 유저당 SSE emitter 레지스트리. chat·messaging 등 도메인에 관계없이 공유되는 범용 레지스트리.
 *
 * <p>firehub-api 의 SseEmitterRegistry 패턴 재사용 — in-memory, 단일 노드 MVP. heartbeat(30s)로 죽은 연결을
 * 감지·정리하고, emitter timeout(1h)으로 장수명 연결을 주기적으로 재활용(만료 시 클라가 fresh 토큰으로 재연결 → 30분 access token 재인증
 * 경로).
 *
 * <p>키가 userId 하나뿐이라 한 유저의 chat·messaging emitter 가 같은 키 아래 모인다 → fanOut 은 eventName 으로 구분된 이벤트를 해당
 * 유저의 모든 스트림에 보낸다(클라가 event 이름으로 필터). 또 {@code MAX_EMITTERS_PER_USER} 한도는 도메인 합산 공유 예산이다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SseRegistry {

  private static final long EMITTER_TIMEOUT = 3_600_000L; // 1h
  private static final int MAX_EMITTERS_PER_USER = 5; // 탭/기기 다중 허용

  private final ConcurrentHashMap<Long, CopyOnWriteArrayList<SseEmitter>> emitters =
      new ConcurrentHashMap<>();

  /**
   * 사용자의 마지막 연결이 끊긴 시각(WP-1201 — AI 위임 작업 「AI별」 보기의 「연결 끊김 · n분째」). 연결이 하나라도 있으면 키가 없다. 서버가 다시 뜨면
   * 비어 있어 그 전 끊김 시각은 모른다(연결 없음 + 시각 없음). 단일 노드 in-memory 라 API 를 여러 대 띄우면 다른 노드의 연결은 보이지 않는다 — 그때는
   * 공용 저장소(예: DB·Redis)로 옮겨야 한다.
   */
  private final ConcurrentHashMap<Long, Instant> disconnectedAt = new ConcurrentHashMap<>();

  /** 끊김 시각을 기억하는 기간 — 지나면 「언제 끊겼는지 모름」으로 돌아간다. */
  private static final Duration DISCONNECT_RETENTION = Duration.ofDays(1);

  private final ObjectMapper objectMapper;

  /**
   * 유저의 새 SSE 연결 등록. 한도 초과 시 가장 오래된 연결을 complete.
   *
   * <p>WP-420: 목록 조회와 추가를 {@code compute} 한 번으로 묶는다 — computeIfAbsent 로 목록을 얻은 뒤 add 하면 그 사이 {@link
   * #closeAll}(멤버십 정지)이 목록을 떼어 내 닫을 때 새 emitter 가 맵에 없는 목록에 붙어 닫히지도, 이벤트를 받지도 않는 채 남았다. 퇴출 대상
   * complete 는 compute 밖에서 한다 — complete 콜백(remove)이 같은 키의 compute 를 다시 부르면 재귀 갱신 예외가 날 수 있다.
   */
  public SseEmitter register(Long userId) {
    SseEmitter emitter = new SseEmitter(EMITTER_TIMEOUT);
    emitter.onCompletion(() -> remove(userId, emitter));
    emitter.onTimeout(() -> remove(userId, emitter));
    emitter.onError(e -> remove(userId, emitter));
    // compute 람다 밖으로 퇴출 대상을 꺼내기 위한 holder.
    AtomicReference<SseEmitter> evicted = new AtomicReference<>();
    emitters.compute(
        userId,
        (k, list) -> {
          CopyOnWriteArrayList<SseEmitter> target =
              list != null ? list : new CopyOnWriteArrayList<>();
          if (target.size() >= MAX_EMITTERS_PER_USER) {
            evicted.set(target.remove(0));
          }
          target.add(emitter);
          // 다시 붙었으니 끊김 시각을 지운다 — compute 안이라 같은 키의 remove(빈 목록 → 끊김 기록)와 순서가 섞이지 않는다.
          disconnectedAt.remove(userId);
          return target;
        });
    if (evicted.get() != null) completeQuietly(evicted.get());
    // 연결 직후 초기 코멘트로 응답 헤더를 즉시 flush 한다 (WP-156). 서블릿 응답은 첫 전송 전까지 커밋되지 않아, 이게 없으면
    // 클라이언트 fetch 가 다음 heartbeat(최대 30s)까지 헤더를 받지 못해 "실시간 연결 중" 상태로 머문다.
    // 컨트롤러가 emitter 를 반환하기 전의 send 는 SseEmitter 가 버퍼링했다가 초기화 시 내보낸다.
    trySend(userId, emitter, SseEmitter.event().comment("connected"));
    return emitter;
  }

  /**
   * 이벤트 1건을 전송하고, 실패하면 죽은 연결로 보고 레지스트리에서 제거한다. best-effort.
   *
   * <p>목록이 CopyOnWriteArrayList 라 순회 중 제거해도 안전하다. SseEventBuilder 는 build 시 내용이 누적돼 재사용할 수 없으므로
   * 호출부가 emitter 마다 새로 만들어 넘긴다.
   */
  private void trySend(Long userId, SseEmitter emitter, SseEmitter.SseEventBuilder event) {
    try {
      emitter.send(event);
    } catch (IOException | IllegalStateException e) {
      remove(userId, emitter);
    }
  }

  /**
   * emitter 를 목록에서 빼고, 비면 키를 지운다. WP-420: 빼기와 빈 목록 정리를 한 번의 computeIfPresent 로 묶어 같은 키의
   * register(compute)와 직렬화한다 — 따로 하면 정리 직전에 붙은 새 emitter 의 목록이 맵에서 떨어져 나갈 수 있었다.
   */
  private void remove(Long userId, SseEmitter emitter) {
    emitters.computeIfPresent(
        userId,
        (k, v) -> {
          v.remove(emitter);
          if (!v.isEmpty()) return v;
          disconnectedAt.put(userId, Instant.now());
          return null;
        });
  }

  /** 지정 유저들의 연결된 emitter 로 이벤트 전송 (미연결 유저는 skip). best-effort. */
  public void fanOut(Collection<Long> userIds, String eventName, Object payload) {
    String json = toJson(payload);
    for (Long userId : userIds) {
      CopyOnWriteArrayList<SseEmitter> list = emitters.get(userId);
      if (list == null) continue;
      for (SseEmitter emitter : list) {
        trySend(
            userId,
            emitter,
            SseEmitter.event().name(eventName).data(json, MediaType.APPLICATION_JSON));
      }
    }
  }

  /**
   * 유저의 모든 SSE 연결을 서버 쪽에서 닫는다(WP-420 — 워크스페이스 멤버십 정지 시 열린 스트림이 계속 이벤트를 받지 않게).
   *
   * <p>키가 userId 뿐이라 테넌트를 가려 닫을 수 없어 그 유저의 모든 스트림을 닫는다. 클라이언트는 새(갱신된) 토큰으로 재연결하므로 다른 워크스페이스 세션은 잠깐
   * 끊겼다 다시 붙고, 정지된 워크스페이스 토큰은 인증 필터에서 401 이 나 재연결되지 않는다. 목록을 먼저 맵에서 떼어 낸 뒤 complete 한다 — complete
   * 콜백(remove)이나 같은 순간의 재연결이 새 목록을 만들어도 이번에 닫을 대상과 섞이지 않는다. register 는 목록 추가를 compute 안에서 하므로 떼어 내기
   * 전에 붙은 연결은 이번에 닫히고, 뒤에 붙은 연결은 맵의 새 목록에 남는다(떨어진 목록에 붙는 일은 없다).
   */
  public void closeAll(Long userId) {
    CopyOnWriteArrayList<SseEmitter> list = emitters.remove(userId);
    if (list == null) return;
    disconnectedAt.put(userId, Instant.now());
    list.forEach(SseRegistry::completeQuietly);
  }

  /** emitter 를 서버 쪽에서 닫는다. 이미 끊긴 연결의 complete 오류는 무시한다 — 호출부가 이미 목록에서 뺀 대상이다. */
  private static void completeQuietly(SseEmitter emitter) {
    try {
      emitter.complete();
    } catch (Exception ignored) {
      // best-effort
    }
  }

  /** 30초 heartbeat 코멘트로 죽은 연결 감지·정리. */
  @Scheduled(fixedRate = 30_000)
  public void sendHeartbeat() {
    // 끊김 시각은 하루가 지나면 버린다 — 다시 붙지 않는 사용자(대부분 사람)의 기록이 서버 수명 내내 쌓이지 않게.
    Instant cutoff = Instant.now().minus(DISCONNECT_RETENTION);
    disconnectedAt.values().removeIf(t -> t.isBefore(cutoff));
    emitters.forEach(
        (userId, list) -> {
          for (SseEmitter emitter : list) {
            trySend(userId, emitter, SseEmitter.event().comment("ping"));
          }
        });
  }

  /**
   * 사용자가 마지막으로 연결돼 있던 시각(WP-1201) — 지금 연결이 있으면 지금, 끊겼으면 끊긴 시각, 이 서버가 뜬 뒤 한 번도 안 붙었으면(또는 하루 넘게 끊겨
   * 정리됐으면) 비어 있다. 끊긴 지 얼마나 됐는지·연결로 볼지는 호출부가 정한다.
   */
  public Optional<Instant> lastSeen(long userId) {
    if (emitters.containsKey(userId)) return Optional.of(Instant.now());
    return Optional.ofNullable(disconnectedAt.get(userId));
  }

  /** 테스트/모니터링용 — 현재 연결된 유저 수. */
  public int connectedUserCount() {
    return emitters.size();
  }

  private String toJson(Object payload) {
    try {
      return objectMapper.writeValueAsString(payload);
    } catch (Exception e) {
      log.warn("SSE payload 직렬화 실패: {}", e.getMessage());
      return "{}";
    }
  }
}
