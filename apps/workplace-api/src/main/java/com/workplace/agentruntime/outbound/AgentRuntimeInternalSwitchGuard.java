package com.workplace.agentruntime.outbound;

import com.workplace.agentruntime.dto.Desired;
import com.workplace.agentruntime.exception.AgentRuntimeSettingConflictException;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.user.dto.AgentRuntime;
import com.workplace.user.outbound.AgentRuntimeChanged;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * 관리자가 AI 의 실행 방식을 「내부(기본)」로 바꿀 때 실행 설정을 정리하는 리스너(WP-1247). 실행 방식 변경과 같은 트랜잭션에서 동기로 돈다.
 *
 * <ul>
 *   <li>Works 가 켜 둔 AI(desired RUN)면 409 를 던져 변경 전체를 롤백한다 — 그대로 두면 클러스터에 AI 가 남아 계속 돈다(먼저 끄기).
 *   <li>꺼져 있으면 실행 설정을 지운다 — 「기본」 템플릿 = 행 없음 + INTERNAL.
 * </ul>
 *
 * <p>가장 먼저 돌게 해(@Order) 다른 리스너(AI 작업 기록 정리 등)가 일을 벌인 뒤에 거절되는 일이 없게 한다.
 */
@Component
@RequiredArgsConstructor
public class AgentRuntimeInternalSwitchGuard {

  private final AgentRuntimeSettingRepository settings;

  @EventListener
  @Order(Ordered.HIGHEST_PRECEDENCE)
  public void onAgentRuntimeChanged(AgentRuntimeChanged e) {
    if (!AgentRuntime.INTERNAL.equals(e.runtime())) return;
    settings
        .findForUpdate(e.agentUserId())
        .ifPresent(
            row -> {
              if (row.desired() == Desired.RUN)
                throw AgentRuntimeSettingConflictException.running();
              settings.delete(e.agentUserId());
            });
  }
}
