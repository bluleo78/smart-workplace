package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.Desired;
import com.workplace.agentruntime.outbound.AgentRuntimeChangeNotifier;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.agentruntime.service.AgentKeyRetirement.Placement;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.tenant.TenantContext;
import java.util.LinkedHashSet;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * AI 실행 설정이 바뀔 때 따라붙는 처리를 한곳에서 한다(WP-1274) — 자동 발급 키 정리, runner 에게 「다시 받아 가라」, 관리자 화면 실시간 알림.
 *
 * <p>저장·켜기·끄기·다시 시작·삭제·「내부 · 기본」 전환·AI 삭제·사용 중지가 저마다 셋을 부르면 새 전이를 더할 때 하나를 빠뜨리기 쉽다. 그래서 전이는 바뀌기 전·후
 * 모양({@link State})만 넘기고, 무엇을 할지는 {@link #applyTransition} 의 규칙이 정한다. 키 정리 여부는 그 안에서 {@link
 * AgentKeyRetirement} 의 규칙에 맡긴다.
 *
 * <p>호출자는 실행 설정 행(또는 AI 행)을 잠근 쓰기 트랜잭션 안에서, 행을 쓴(또는 지운) 뒤에 부른다. runner 알림·관리자 알림은 커밋 뒤에 나간다.
 */
@Component
@RequiredArgsConstructor
public class AgentRuntimeTransitions {

  private final AgentKeyRetirement keyRetirement;
  private final AgentRuntimeChangeNotifier changeNotifier;
  private final ApplicationEventPublisher events;

  /**
   * 실행 설정 한 행의 전이 모양.
   *
   * @param desired 원하는 상태
   * @param locationId 실제 위치(지정 위치 ?? 기본). runner 알림과 「켜진 채 위치 이동」 판정에만 쓰므로, 꺼진 채 지워지는 행처럼 그 둘에 쓰이지
   *     않는 자리에는 지정 위치를 그대로 넘겨도 된다({@link Placement} 와 같은 규칙)
   * @param generation 원하는 상태의 generation — 전·후가 다르면 원하는 상태가 바뀐 것이다
   * @param departing 행은 남지만 AI 가 이 워크스페이스를 떠나는 중(사용 중지) — 키 규칙에는 「행이 없어짐」으로 넘긴다
   */
  public record State(Desired desired, Long locationId, long generation, boolean departing) {

    /** 저장 행의 모양 — 실제 위치는 호출자가 정한 값. */
    public static State of(Row row, Long locationId) {
      return new State(row.desired(), locationId, row.generation(), false);
    }

    /** AI 가 이 워크스페이스를 떠나는 전이의 「후」 — 행은 남는다(사용 중지). */
    public static State departing(Row row, Long locationId) {
      return new State(row.desired(), locationId, row.generation(), true);
    }

    private Placement placement() {
      return new Placement(desired, locationId);
    }
  }

  /**
   * 전이 하나의 부수 처리를 한 번씩 한다.
   *
   * <ul>
   *   <li><b>키 정리</b> — {@link AgentKeyRetirement#onTransition}(행이 없어지거나 떠나면 「후」는 null).
   *   <li><b>runner 알림</b> — 행이 없어지면 켜져 있던 때만 그 위치에. 그 밖에는 generation 이 바뀌었을 때만 전·후 실제 위치(겹치면 한
   *       번)에. 새 행은 꺼진 채 만들어져 runner 가 할 일이 없으니 알리지 않는다.
   *   <li><b>관리자 알림</b> — 새 행은 created, 행이 없어지면 deleted, generation 이 바뀌었으면 updated, 그 밖(바뀐 것 없음·꺼진
   *       채 떠남)은 알리지 않는다.
   * </ul>
   *
   * @param before 바뀌기 전(행이 없었으면 null)
   * @param after 바뀐 뒤(행이 없어지면 null)
   * @param actorId 바꾼 관리자(모르면 null)
   */
  public void applyTransition(long agentId, State before, State after, Long actorId) {
    Placement keyAfter = after == null || after.departing() ? null : after.placement();
    keyRetirement.onTransition(agentId, before == null ? null : before.placement(), keyAfter);

    boolean generationChanged =
        before != null && after != null && before.generation() != after.generation();
    if (after == null) {
      if (before != null && before.desired() == Desired.RUN) publish(before.locationId());
    } else if (generationChanged) {
      publish(before.locationId(), after.locationId());
    }

    String op =
        before == null
            ? ResourceChangedEvent.OP_CREATED
            : after == null
                ? ResourceChangedEvent.OP_DELETED
                : generationChanged ? ResourceChangedEvent.OP_UPDATED : null;
    if (op != null) changeNotifier.agentChanged(op, agentId, actorId);
  }

  /**
   * 실행 설정은 그대로인데 runner 가 받아 가는 입력(저장소 토큰 등)만 바뀐 경우의 알림 — 켜져 있는 AI 면 실제 위치의 runner 에게 desired 를 다시
   * 받아 가게 알리고, 관리자 화면에는 「바뀜」을 알린다. 꺼져 있으면 runner 가 할 일이 없어 화면 알림만 낸다.
   *
   * @param desired 그 AI 의 원하는 상태
   * @param effectiveLocationId 실제 위치(지정 위치 ?? 기본, 없으면 null)
   * @param actorId 바꾼 관리자
   */
  public void inputsChanged(long agentId, Desired desired, Long effectiveLocationId, Long actorId) {
    if (desired == Desired.RUN) publish(effectiveLocationId);
    changeNotifier.agentChanged(ResourceChangedEvent.OP_UPDATED, agentId, actorId);
  }

  /** 실제 위치마다(겹침·null 제외) 원하는 상태 변경 이벤트를 낸다 — 그 위치의 runner 가 다시 받아 간다. */
  private void publish(Long... locationIds) {
    long tenantId = TenantContext.require();
    Set<Long> distinct = new LinkedHashSet<>();
    for (Long id : locationIds) if (id != null) distinct.add(id);
    distinct.forEach(id -> events.publishEvent(new AgentRuntimeDesiredChanged(tenantId, id)));
  }
}
