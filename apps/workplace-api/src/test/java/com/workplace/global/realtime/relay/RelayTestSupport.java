package com.workplace.global.realtime.relay;

import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import com.workplace.global.realtime.DefaultStreamingGenerationRegistry;
import com.workplace.global.realtime.SseRegistry;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitterCapture;

/**
 * 두 파드 시뮬레이션 헬퍼(WP-1973 Task 3) — 한 JVM 안에 파드 B 를 새로 만들어, 파드 A(컨텍스트)의 발행이 실제로 LISTEN 경로로 넘어오는지
 * emitter 까지 보고 확인한다.
 *
 * <p>파드마다 레지스트리·전용 중계(발행·수신 커넥션)·로컬 배선({@link RelayLocalDispatcher})을 새로 만든다. 수동으로 만든 레지스트리·중계는
 * Spring 빈이 아니므로 쓰고 나서 {@link #close(Pod)} 로 리스너 스레드·커넥션을 닫아야 한다(테스트 커넥션 누수 방지).
 */
public final class RelayTestSupport {

  private RelayTestSupport() {}

  /** 두 파드 시뮬레이션 한 대 — 자기 레지스트리(유저·runner), 자기 전용 중계, 보낸 값을 그대로 받는 목록. */
  public record Pod(
      SseRegistry registry,
      RunnerSseRegistry runner,
      SseEventRelay relay,
      List<ServerSentEvent<String>> received) {}

  /**
   * 새 파드(주로 파드 B) — 전용 중계와 로컬 배선을 새로 만든다. {@code relay.onMessage} 는 더 이상 호출부를 막지 않으므로(운영 배선이 기동 중
   * 멈추지 않게), 여기서 첫 LISTEN 시도가 끝날 때까지 기다려 등록과 수신 시작 사이의 빈틈을 없앤다 — 이 메서드가 반환한 시점부터 수신이 켜져 있다.
   *
   * @param url JDBC URL({@code spring.datasource.url})
   * @param user 접속 유저
   * @param pass 접속 비밀번호
   */
  public static Pod newPod(String url, String user, String pass) {
    PostgresSseEventRelay relay = new PostgresSseEventRelay(url, user, pass);
    SseRegistry registry = new SseRegistry(relay);
    RunnerSseRegistry runner = new RunnerSseRegistry(relay);
    // 배선은 곧바로 수신자 등록까지 이어진다 — 등록이 끝나면 첫 LISTEN 을 기다렸다가 돌아온다.
    new RelayLocalDispatcher(registry, runner, new DefaultStreamingGenerationRegistry(), relay)
        .register();
    relay.awaitFirstListen();
    return new Pod(registry, runner, relay, new CopyOnWriteArrayList<>());
  }

  /** emitter 등록 + 캡처(모든 테스트 공통) — 그 파드의 received 목록에 보낸 SSE 프레임을 그대로 모은다. */
  public static SseEmitter registerCaptured(Pod pod, long userId) {
    return registerCaptured(pod.registry(), pod.received(), userId);
  }

  /** 같은 캡처 — 파드 A 처럼 Pod 없는 레지스트리(컨텍스트 빈)에도 쓴다. */
  public static SseEmitter registerCaptured(
      SseRegistry registry, List<ServerSentEvent<String>> received, long userId) {
    SseEmitter emitter = registry.register(userId);
    SseEmitterCapture.attach(emitter, received::add);
    return emitter;
  }

  /**
   * runner 연결 등록 + 캡처 — (테넌트, 위치) 연결이 받은 SSE 프레임을 그 파드의 received 목록에 모은다(유저 캡처와 같은 목록 — 이벤트 이름으로
   * 가르면 한 테스트 안에서 섞여도 구분된다).
   */
  public static SseEmitter registerRunnerCaptured(Pod pod, long tenantId, long locationId) {
    SseEmitter emitter = pod.runner().register(tenantId, locationId);
    SseEmitterCapture.attach(emitter, pod.received()::add);
    return emitter;
  }

  /** 파드 정리 — 수동으로 만든 중계의 리스너 스레드·전용 커넥션을 닫는다(Spring 빈이 아니라 {@code @PreDestroy} 가 붙지 않는다). */
  public static void close(Pod pod) {
    if (pod.relay() instanceof PostgresSseEventRelay postgres) postgres.close();
  }
}
