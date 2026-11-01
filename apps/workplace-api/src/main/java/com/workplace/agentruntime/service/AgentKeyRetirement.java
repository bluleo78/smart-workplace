package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.Desired;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.tenant.TenantContext;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 「AI 의 Pod 가 사라지면 Works 가 자동 발급한 키를 정리 유예로 줄인다」를 한곳에서 정한다(WP-1264).
 *
 * <p>끄기·켜진 AI 의 위치 이동·실행 설정 삭제·「내부 · 기본」 전환·AI 삭제·사용 중지가 저마다 키 줄이기를 부르면, 새 전이가 생길 때 빠뜨리거나 줄이면 안 되는
 * 전이(설정만 바꿈·켜기)에서 줄이기 쉽다. 그래서 모든 전이는 바뀌기 전·후의 실행 설정 모양({@link Placement})만 넘기고, 줄일지는 {@link
 * #shouldRetire} 한 규칙이 정한다.
 *
 * <p>줄이는 이유: 지워지는 Pod 가 SIGTERM 유예 안에 마무리할 시간(5분)만 남기고 그 뒤에는 옛 키가 쓰이지 않게 하고, 새 Pod 의 첫 키 발급이 교체로
 * 보이지 않게 한다(RunnerDesiredStateService#issueAgentKey). 이 워크스페이스의 managed 키만 줄인다 — 같은 AI 를 다른
 * 워크스페이스에서 Works 가 띄우고 있어도 그쪽 Pod 의 키는 그대로다.
 *
 * <p>호출자는 실행 설정 행(또는 AI 행)을 잠근 뒤에 부른다 — 같은 AI 의 키 발급과 차례로 서게.
 */
@Component
@RequiredArgsConstructor
public class AgentKeyRetirement {

  private final AgentApiKeyService agentKeys;

  /**
   * 실행 설정 한 행의 키 판정용 모양. 행이 없으면(삭제·「내부 · 기본」 전환·AI 가 워크스페이스를 떠남) 모양 대신 null 을 쓴다.
   *
   * @param desired 원하는 상태
   * @param locationId 실제 위치(지정 위치 ?? 기본) — 켜진 채 위치가 바뀌었는지 볼 때만 쓰므로, 꺼진 행에는 지정 위치 그대로를 넘겨도 된다
   */
  public record Placement(Desired desired, Long locationId) {}

  /**
   * 전이 전·후를 보고 옛 Pod 가 사라지면 키를 줄인다.
   *
   * @param before 바뀌기 전 모양(행이 없었으면 null)
   * @param after 바뀐 뒤 모양(행이 없어지거나 AI 가 워크스페이스를 떠나면 null)
   */
  public void onTransition(long agentId, Placement before, Placement after) {
    if (shouldRetire(before, after)) {
      agentKeys.shortenManagedToGrace(agentId, TenantContext.require());
    }
  }

  /**
   * 옛 Pod 가 사라지는 전이인지(=키를 줄일지). 행이 있던 AI 가
   *
   * <ul>
   *   <li>행이 없어지면(설정 삭제·「내부 · 기본」 전환·AI 삭제·사용 중지) 줄인다 — 꺼져 있었어도 남은 키를 정리한다(끌 때 이미 줄었으면 늦추지 않으므로
   *       그대로다).
   *   <li>켜져 있다가 꺼지면 줄인다(runner 가 Pod 를 바로 지운다).
   *   <li>켜진 채 실제 위치가 바뀌면 줄인다(옛 위치의 runner 가 Pod 를 바로 지운다). 기본 위치를 직접 지정 ↔ 미지정처럼 실제 위치가 그대로면 줄이지
   *       않는다.
   * </ul>
   *
   * 그 밖(설정만 바꿈·다시 시작·켜기·꺼진 채 위치 변경·새 행)은 줄이지 않는다 — 지금 Pod 가 계속 그 키를 쓰거나 Pod 가 없다.
   */
  static boolean shouldRetire(Placement before, Placement after) {
    if (before == null) return false;
    if (after == null) return true;
    if (before.desired() != Desired.RUN) return false;
    return after.desired() != Desired.RUN
        || !Objects.equals(before.locationId(), after.locationId());
  }
}
