package com.workplace.global.realtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
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
    return emitter;
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
      if (list == null || list.isEmpty()) continue;
      List<SseEmitter> dead = new ArrayList<>();
      for (SseEmitter emitter : list) {
        try {
          emitter.send(SseEmitter.event().name(eventName).data(json, MediaType.APPLICATION_JSON));
        } catch (IOException | IllegalStateException e) {
          dead.add(emitter);
        }
      }
      dead.forEach(e -> remove(userId, e));
    }
  }

  /** 30초 heartbeat 코멘트로 죽은 연결 감지·정리. */
  @Scheduled(fixedRate = 30_000)
  public void sendHeartbeat() {
    emitters.forEach(
        (userId, list) -> {
          List<SseEmitter> dead = new ArrayList<>();
          for (SseEmitter emitter : list) {
            try {
              emitter.send(SseEmitter.event().comment("ping"));
            } catch (IOException | IllegalStateException e) {
              dead.add(emitter);
            }
          }
          dead.forEach(e -> remove(userId, e));
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
