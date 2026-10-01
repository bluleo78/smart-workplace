package com.workplace.global.realtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.Collection;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
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
  private final ObjectMapper objectMapper;

  /** 유저의 새 SSE 연결 등록. 한도 초과 시 가장 오래된 연결을 complete. */
  public SseEmitter register(Long userId) {
    CopyOnWriteArrayList<SseEmitter> list =
        emitters.computeIfAbsent(userId, k -> new CopyOnWriteArrayList<>());
    if (list.size() >= MAX_EMITTERS_PER_USER && !list.isEmpty()) {
      SseEmitter oldest = list.get(0);
      list.remove(oldest);
      try {
        oldest.complete();
      } catch (Exception ignored) {
        // 퇴출 중 complete 오류는 무시
      }
    }
    SseEmitter emitter = new SseEmitter(EMITTER_TIMEOUT);
    emitter.onCompletion(() -> remove(userId, emitter));
    emitter.onTimeout(() -> remove(userId, emitter));
    emitter.onError(e -> remove(userId, emitter));
    list.add(emitter);
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

  private void remove(Long userId, SseEmitter emitter) {
    CopyOnWriteArrayList<SseEmitter> list = emitters.get(userId);
    if (list != null) {
      list.remove(emitter);
      emitters.computeIfPresent(userId, (k, v) -> v.isEmpty() ? null : v);
    }
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

  /** 30초 heartbeat 코멘트로 죽은 연결 감지·정리. */
  @Scheduled(fixedRate = 30_000)
  public void sendHeartbeat() {
    emitters.forEach(
        (userId, list) -> {
          for (SseEmitter emitter : list) {
            trySend(userId, emitter, SseEmitter.event().comment("ping"));
          }
        });
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
