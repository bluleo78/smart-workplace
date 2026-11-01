package com.workplace.global.realtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.Collection;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 키별 SSE emitter 묶음 — 사용자용 {@link SseRegistry}(키 userId)와 runner 변경 스트림 레지스트리(키 테넌트·위치, WP-1249)가
 * 같은 등록·전송·정리 규칙을 나눠 쓴다. 빈이 아니라 각 레지스트리가 하나씩 만들어 들고, 하트비트 주기 작업({@code @Scheduled})은 레지스트리마다 따로 둔다.
 *
 * <p>WP-420: 목록 조회와 추가·빼기·떼어 내기를 {@code compute}/{@code computeIfPresent} 한 번으로 묶는다 — 따로 하면 같은 키의
 * 등록과 정리가 엇갈려 새 emitter 가 맵에서 떨어진 목록에 붙어 닫히지도, 이벤트를 받지도 않는 채 남는다. 첫 연결·마지막 연결 콜백도 그 안에서 불러 순서가 섞이지
 * 않게 한다(사용자 레지스트리의 끊김 시각 기록). 퇴출·닫기의 {@code complete} 는 compute 밖에서 한다 — 닫힘 콜백(remove)이 같은 키의
 * compute 를 다시 부르면 재귀 갱신 예외가 날 수 있다.
 *
 * @param <K> 연결을 묶는 키
 */
@Slf4j
public class KeyedSseEmitters<K> {

  private final ConcurrentHashMap<K, CopyOnWriteArrayList<SseEmitter>> emitters =
      new ConcurrentHashMap<>();

  private final ObjectMapper objectMapper;
  private final long timeoutMillis;
  private final int maxPerKey;
  private final Consumer<K> onAttach;
  private final Consumer<K> onLastDetach;

  /**
   * @param timeoutMillis emitter 수명 — 지나면 클라이언트가 다시 붙으며 인증을 다시 받는다
   * @param maxPerKey 키당 최대 연결 수 — 넘치면 가장 오래된 연결을 닫는다
   * @param onAttach 등록할 때마다(compute 안에서) — 연결이 없던 키든 이미 있던 키든
   * @param onLastDetach 키의 마지막 연결이 빠질 때(compute 안에서) — 끊김·서버 쪽 닫기 모두
   */
  public KeyedSseEmitters(
      ObjectMapper objectMapper,
      long timeoutMillis,
      int maxPerKey,
      Consumer<K> onAttach,
      Consumer<K> onLastDetach) {
    this.objectMapper = objectMapper;
    this.timeoutMillis = timeoutMillis;
    this.maxPerKey = maxPerKey;
    this.onAttach = onAttach;
    this.onLastDetach = onLastDetach;
  }

  /** 콜백 없는 묶음. */
  public KeyedSseEmitters(ObjectMapper objectMapper, long timeoutMillis, int maxPerKey) {
    this(objectMapper, timeoutMillis, maxPerKey, k -> {}, k -> {});
  }

  /**
   * 새 연결을 만들어 등록하고 첫 코멘트 {@code connected} 로 응답 헤더를 바로 내보낸다(WP-156 — 서블릿 응답은 첫 전송 전까지 커밋되지 않아, 이게
   * 없으면 클라이언트가 다음 하트비트까지 헤더를 받지 못한다). 한도를 넘으면 가장 오래된 연결을 닫는다.
   */
  public SseEmitter register(K key) {
    SseEmitter emitter = new SseEmitter(timeoutMillis);
    emitter.onCompletion(() -> remove(key, emitter));
    emitter.onTimeout(() -> remove(key, emitter));
    emitter.onError(e -> remove(key, emitter));
    // compute 람다 밖으로 퇴출 대상을 꺼내기 위한 holder.
    AtomicReference<SseEmitter> evicted = new AtomicReference<>();
    emitters.compute(
        key,
        (k, list) -> {
          CopyOnWriteArrayList<SseEmitter> target =
              list != null ? list : new CopyOnWriteArrayList<>();
          if (target.size() >= maxPerKey) evicted.set(target.remove(0));
          target.add(emitter);
          onAttach.accept(k);
          return target;
        });
    if (evicted.get() != null) completeQuietly(evicted.get());
    trySend(key, emitter, SseEmitter.event().comment("connected"));
    return emitter;
  }

  /** 지정 키들의 연결에 이벤트를 보낸다(연결 없는 키는 건너뜀). 실패한 연결은 정리한다. best-effort. */
  public void send(Collection<K> keys, String eventName, Object payload) {
    String json = toJson(payload);
    for (K key : keys) {
      CopyOnWriteArrayList<SseEmitter> list = emitters.get(key);
      if (list == null) continue;
      // SseEventBuilder 는 build 시 내용이 누적돼 재사용할 수 없어 emitter 마다 새로 만든다.
      for (SseEmitter emitter : list) {
        trySend(
            key,
            emitter,
            SseEmitter.event().name(eventName).data(json, MediaType.APPLICATION_JSON));
      }
    }
  }

  /**
   * 키의 모든 연결을 서버 쪽에서 닫는다. 목록을 먼저 맵에서 떼어 낸 뒤 complete 한다 — complete 콜백(remove)이나 같은 순간의 재연결이 새 목록을
   * 만들어도 이번에 닫을 대상과 섞이지 않는다.
   */
  public void closeAll(K key) {
    AtomicReference<CopyOnWriteArrayList<SseEmitter>> detached = new AtomicReference<>();
    emitters.computeIfPresent(
        key,
        (k, list) -> {
          detached.set(list);
          onLastDetach.accept(k);
          return null;
        });
    if (detached.get() != null) detached.get().forEach(KeyedSseEmitters::completeQuietly);
  }

  /** 모든 연결에 하트비트 코멘트를 보낸다 — 죽은 연결을 찾아 정리하고 중간 프록시가 idle 로 끊지 않게. */
  public void heartbeat() {
    emitters.forEach(
        (key, list) -> {
          for (SseEmitter emitter : list) trySend(key, emitter, SseEmitter.event().comment("ping"));
        });
  }

  /** 키에 연결이 하나라도 있는지. */
  public boolean isConnected(K key) {
    return emitters.containsKey(key);
  }

  /** 키의 연결 수. */
  public int connectionCount(K key) {
    CopyOnWriteArrayList<SseEmitter> list = emitters.get(key);
    return list == null ? 0 : list.size();
  }

  /** 연결이 있는 키 수. */
  public int keyCount() {
    return emitters.size();
  }

  /** 이벤트 1건을 전송하고, 실패하면 죽은 연결로 보고 정리한다. 목록이 CopyOnWriteArrayList 라 순회 중 제거해도 안전하다. */
  private void trySend(K key, SseEmitter emitter, SseEmitter.SseEventBuilder event) {
    try {
      emitter.send(event);
    } catch (IOException | IllegalStateException e) {
      remove(key, emitter);
    }
  }

  /** emitter 를 빼고, 목록이 비면 키를 지우고 마지막 연결 콜백을 부른다 — 같은 키의 등록과 직렬화되게 computeIfPresent 한 번으로. */
  private void remove(K key, SseEmitter emitter) {
    emitters.computeIfPresent(
        key,
        (k, v) -> {
          v.remove(emitter);
          if (!v.isEmpty()) return v;
          onLastDetach.accept(k);
          return null;
        });
  }

  /** emitter 를 서버 쪽에서 닫는다. 이미 끊긴 연결의 complete 오류는 무시한다. */
  private static void completeQuietly(SseEmitter emitter) {
    try {
      emitter.complete();
    } catch (Exception ignored) {
      // best-effort — 이미 끊긴 연결
    }
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
