package com.workplace.global.realtime.relay;

import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import com.workplace.global.json.JsonMappers;
import com.workplace.global.realtime.SseRegistry;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 도착한 중계 메시지를 자기 파드 레지스트리로 보내는 배선(WP-1973) — 발행 파드도 같은 중계 경로를 지나므로 로컬 우회가 없고, target 마다 어디로 보낼지 가르는
 * 규칙은 여기 한 곳에 모아 둔다.
 *
 * <p>테스트 프로파일은 lazy-initialization 이라 아무도 이 빈을 주입받지 않으면 startup 에 만들어지지 않는다 — 수신 등록은 startup 에 반드시
 * 일어나야 해 {@code @Lazy(false)} 로 끊지 않고, 레지스트리·중계 빈도 이 빈이 주입받아 함께 만들어진다.
 */
@Slf4j
@Component
@Lazy(false)
public class RelayLocalDispatcher {

  /** keysJson 파싱 전용 공유 매퍼(WP-1609 — 직접 만드는 매퍼는 JsonMappers 에서만). */
  private static final ObjectMapper MAPPER = JsonMappers.JACKSON2;

  private final SseRegistry sseRegistry;
  private final RunnerSseRegistry runnerSseRegistry;
  private final SseEventRelay relay;

  public RelayLocalDispatcher(
      SseRegistry sseRegistry, RunnerSseRegistry runnerSseRegistry, SseEventRelay relay) {
    this.sseRegistry = sseRegistry;
    this.runnerSseRegistry = runnerSseRegistry;
    this.relay = relay;
  }

  /**
   * 중계 수신 등록 — {@literal @}PostConstruct 로 startup 에 딱 한 번 부른다(테스트에서는 직접 호출). 등록 전에 온 메시지는 없으므로 등록
   * 시점만 맞으면 전달이 끊기지 않는다.
   */
  @PostConstruct
  public void register() {
    relay.onMessage(this::dispatch);
  }

  /**
   * 도착 메시지를 target 마다 자기 파드 레지스트리의 로컬 전달·닫기로 보낸다 — 배선의 실패(레지스트리 예외·깨진 키)는 경고로 끝내고 예외를 밀어내지 않는다(중계는
   * best-effort 계약). Noop 의 동기 발행 경로까지 예외가 올라가면 발행자가 죽으므로 수신 실패는 여기서 모두 받아 끊는다.
   */
  public void dispatch(RelayMessage message) {
    try {
      switch (message.target()) {
        case RelayMessage.TARGET_USER -> {
          sseRegistry.deliverLocal(
              message.event(), message.payloadJson(), parseKeys(message.keysJson()));
        }
        case RelayMessage.TARGET_USER_CLOSE -> {
          for (long userId : parseKeys(message.keysJson())) sseRegistry.closeLocal(userId);
        }
        case RelayMessage.TARGET_RUNNER -> {
          long[] keys = parseKeys(message.keysJson());
          if (keys.length < 2) {
            log.warn("중계 runner 메시지에 키가 두 개가 아니다({}) — 건너뛴다", message.keysJson());
            return;
          }
          runnerSseRegistry.deliverLocal(message.event(), message.payloadJson(), keys[0], keys[1]);
        }
        case RelayMessage.TARGET_RUNNER_CLOSE -> {
          long[] keys = parseKeys(message.keysJson());
          if (keys.length < 2) {
            log.warn("중계 runner 닫힘 메시지에 키가 두 개가 아니다({}) — 건너뛴다", message.keysJson());
            return;
          }
          runnerSseRegistry.closeLocal(keys[0], keys[1]);
        }
        // 아는 target 만 전달한다 — 새 버전 파드가 보낸 모르는 target 은 건너뛴다(앞으로의 호환).
        default -> log.warn("알 수 없는 중계 target({}) — 건너뛴다", message.target());
      }
    } catch (Exception e) {
      log.warn("중계 메시지 로컬 전달 실패 — 건너뛴다(target {}): {}", message.target(), e.getMessage());
    }
  }

  /** keysJson( {@code [7]}·{@code [1,2]} ) → 키 배열 — 유저는 userId 목록, runner 는 (테넌트, 위치). */
  private static long[] parseKeys(String keysJson) {
    JsonNode array = MAPPER.readTree(keysJson);
    long[] keys = new long[array.size()];
    for (int i = 0; i < keys.length; i++) {
      keys[i] = array.get(i).asLong();
    }
    return keys;
  }
}
