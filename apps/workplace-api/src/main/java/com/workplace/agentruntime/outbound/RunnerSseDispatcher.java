package com.workplace.agentruntime.outbound;

import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import com.workplace.global.util.AfterCommit;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 원하는 상태 변경({@link AgentRuntimeDesiredChanged})을 그 위치의 runner 변경 스트림으로 알린다(WP-1249) — 이벤트 {@value
 * #EVENT}, 데이터 {@code {"locationId":n}}. runner 는 받으면 desired 를 다시 조회한다.
 *
 * <p>커밋된 변경만 알리도록 전송을 {@link AfterCommit} 로 커밋 뒤에 한다(롤백되면 보내지 않는다 — 켜기가 자리 초과로 되돌려졌는데 runner 가 먼저
 * 다시 조회하는 일이 없게). DB 를 쓰지 않으므로 커밋 전 조회 단계가 필요 없다. 트랜잭션 밖에서 난 이벤트는 바로 보낸다.
 */
@Component
@RequiredArgsConstructor
public class RunnerSseDispatcher {

  /** runner 가 구독하는 이벤트 이름. */
  public static final String EVENT = "agent-runtime.changed";

  private final RunnerSseRegistry registry;

  @EventListener
  public void onDesiredChanged(AgentRuntimeDesiredChanged e) {
    AfterCommit.run(
        () ->
            registry.send(
                e.tenantId(), e.locationId(), EVENT, Map.of("locationId", e.locationId())));
  }
}
