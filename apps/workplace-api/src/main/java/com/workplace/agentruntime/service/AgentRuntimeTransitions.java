package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.Desired;
import com.workplace.agentruntime.outbound.AgentRuntimeChangeNotifier;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.repository.AgentLocationRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.agentruntime.service.AgentKeyRetirement.Placement;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.tenant.TenantContext;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.function.Supplier;
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
 *
 * <p>호출자는 행에 적힌 <b>지정 위치</b>(기본을 따르면 null)만 넘긴다 — 실제 위치(지정 위치 ?? 기본) 해석은 여기서 한다(WP-1287). 호출자마다 해석
 * 여부가 다르면 규칙을 바꿀 때 기본 위치를 따르는 AI 만 알림에서 소리 없이 빠질 수 있다. 실행 설정 밖에서 runner 입력이 바뀌는 경우(키 교체 —
 * generation 이 오르는 전이, 저장소 토큰, 기본 위치 이동)도 이 클래스를 거쳐 알린다.
 */
@Component
@RequiredArgsConstructor
public class AgentRuntimeTransitions {

  private final AgentKeyRetirement keyRetirement;
  private final AgentRuntimeChangeNotifier changeNotifier;
  private final ApplicationEventPublisher events;
  private final AgentLocationRepository locations;

  /**
   * 실행 설정 한 행의 전이 모양.
   *
   * @param desired 원하는 상태
   * @param assignedLocationId 행에 적힌 지정 위치(기본을 따르면 null) — 실제 위치는 {@link #applyTransition} 이 정한다
   * @param generation 원하는 상태의 generation — 전·후가 다르면 원하는 상태가 바뀐 것이다
   * @param departing 행은 남지만 AI 가 이 워크스페이스를 떠나는 중(사용 중지) — 키 규칙에는 「행이 없어짐」으로 넘긴다
   */
  public record State(
      Desired desired, Long assignedLocationId, long generation, boolean departing) {

    /** 저장 행의 모양. */
    public static State of(Row row) {
      return new State(row.desired(), row.locationId(), row.generation(), false);
    }

    /** AI 가 이 워크스페이스를 떠나는 전이의 「후」 — 행은 남는다(사용 중지). */
    public static State departing(Row row) {
      return new State(row.desired(), row.locationId(), row.generation(), true);
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
    Long beforeAt = before == null ? null : locations.effectiveId(before.assignedLocationId());
    // 지정 위치가 같으면(대개 그렇다) 기본 위치를 한 번만 읽는다.
    Long afterAt =
        after == null
            ? null
            : before != null
                    && Objects.equals(before.assignedLocationId(), after.assignedLocationId())
                ? beforeAt
                : locations.effectiveId(after.assignedLocationId());

    Placement keyBefore = before == null ? null : new Placement(before.desired(), beforeAt);
    Placement keyAfter =
        after == null || after.departing() ? null : new Placement(after.desired(), afterAt);
    keyRetirement.onTransition(agentId, keyBefore, keyAfter);

    boolean generationChanged =
        before != null && after != null && before.generation() != after.generation();
    if (after == null) {
      if (before != null && before.desired() == Desired.RUN) publish(beforeAt);
    } else if (generationChanged) {
      publish(beforeAt, afterAt);
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
   * @param setting 그 AI 의 실행 설정(없으면 null — 화면 알림만)
   * @param actorId 바꾼 관리자
   */
  public void inputsChanged(long agentId, State setting, Long actorId) {
    if (setting != null && setting.desired() == Desired.RUN) {
      publish(locations.effectiveId(setting.assignedLocationId()));
    }
    changeNotifier.agentChanged(ResourceChangedEvent.OP_UPDATED, agentId, actorId);
  }

  /**
   * 기본 위치가 옮겨 갔다 — 설정 행·generation 은 그대로이고, 위치를 지정하지 않은 AI 의 실제 위치만 옛 기본 → 새 기본으로 바뀐다. 켜져 있으면 옛 위치의
   * runner 가 Pod 를 바로 지우므로 키 규칙에 실제 위치 변화로 넘긴다(켜진 AI 만 줄어든다, WP-1264). 옛 기본이 없었으면 미지정 AI 는 띄워질 곳이
   * 없어 지워질 Pod 도 없다 — 키를 정리하지 않는다. runner 알림은 AI 마다가 아니라 두 위치에 한 번씩 낸다(같은 위치에 AI 수만큼 쌓이지 않게).
   *
   * @param oldDefault 옛 기본 위치(없었으면 null)
   * @param newDefault 새 기본 위치
   * @param unassigned 위치를 지정하지 않은 실행 설정들 — 옛 기본이 있을 때만 읽는다
   */
  public void defaultLocationMoved(
      Long oldDefault, long newDefault, Supplier<List<Row>> unassigned) {
    if (oldDefault != null) {
      for (Row setting : unassigned.get()) {
        keyRetirement.onTransition(
            setting.agentUserId(),
            new Placement(setting.desired(), oldDefault),
            new Placement(setting.desired(), newDefault));
      }
    }
    publish(oldDefault, newDefault);
  }

  /**
   * 키 교체로 generation 이 올랐다(WP-1253) — 원하는 상태·위치는 그대로라 키 규칙은 아무것도 줄이지 않고, 지금 Pod 를 든 runner(요청을 보낸
   * 위치)에게 다시 받아 가라고 알리고 관리자 화면에 「적용 대기」를 알린다(WP-1254). 그사이 기본 위치가 옮겨 가도 행이 아니라 요청한 runner 의 위치로
   * 알린다.
   */
  public void keyRotated(long agentId, long runnerLocationId) {
    publish(runnerLocationId);
    changeNotifier.agentChanged(ResourceChangedEvent.OP_UPDATED, agentId, null);
  }

  /** 실제 위치마다(겹침·null 제외) 원하는 상태 변경 이벤트를 낸다 — 그 위치의 runner 가 다시 받아 간다. */
  private void publish(Long... locationIds) {
    long tenantId = TenantContext.require();
    Set<Long> distinct = new LinkedHashSet<>();
    for (Long id : locationIds) if (id != null) distinct.add(id);
    distinct.forEach(id -> events.publishEvent(new AgentRuntimeDesiredChanged(tenantId, id)));
  }
}
