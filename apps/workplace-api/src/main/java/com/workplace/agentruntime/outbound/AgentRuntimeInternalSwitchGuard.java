package com.workplace.agentruntime.outbound;

import com.workplace.agentruntime.dto.Desired;
import com.workplace.agentruntime.exception.AgentRuntimeSettingConflictException;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.service.AgentAccountFit;
import com.workplace.agentruntime.service.AgentKeyRetirement;
import com.workplace.agentruntime.service.AgentRuntimeTransitions;
import com.workplace.auth.service.AiAgentCredentialService;
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
 *   <li>꺼져 있으면 실행 설정을 지우고 Works 가 자동 발급한 키를 정리 유예로 줄인다(WP-1253 — 판정은 {@link AgentKeyRetirement} 한
 *       규칙, WP-1264) — 「기본」 템플릿 = 행 없음 + INTERNAL. 관리자 화면에 지워졌다고 알린다(WP-1254). 둘 다 {@link
 *       AgentRuntimeTransitions} 가 한다(WP-1274).
 *   <li>활성 AI 계정이 기본 방식에서 쓸 수 없는 종류(로그인 정보 genia·chatgpt 등)면 끊는다(WP-1296·1297).
 * </ul>
 *
 * <p>가장 먼저 돌게 해(@Order) 다른 리스너(AI 작업 기록 정리 등)가 일을 벌인 뒤에 거절되는 일이 없게 한다.
 */
@Component
@RequiredArgsConstructor
public class AgentRuntimeInternalSwitchGuard {

  private final AgentRuntimeSettingRepository settings;
  private final AgentRuntimeTransitions transitions;
  private final AiAgentCredentialService credentials;

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
              // 꺼진 채 지워진다 — 키 정리·관리자 알림(지워짐)은 전이 한곳이 한다(WP-1274).
              transitions.applyTransition(
                  e.agentUserId(), AgentRuntimeTransitions.State.of(row), null, null);
            });
    // WP-1296·1297: 기본 방식에 맞지 않는 계정(로그인 정보 등)은 방식 변경과 함께 끊는다 — 등록 검사와 같은 판정. 켜져 있어 거절(409)되는
    // 변경은 위에서 이미 던졌으므로 아무것도 끊지 않는다. 실행 설정 행이 없던 「내 컴퓨터」 AI 도 여기서 끊긴다.
    AgentAccountFit.revokeUnfit(
        credentials,
        e.callerId(),
        e.agentUserId(),
        null,
        credentials.findActiveProvider(e.agentUserId()));
  }
}
