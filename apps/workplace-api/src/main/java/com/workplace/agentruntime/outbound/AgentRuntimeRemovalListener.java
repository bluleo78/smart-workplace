package com.workplace.agentruntime.outbound;

import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.user.outbound.AgentDeleted;
import com.workplace.user.outbound.WorkspaceMembershipSuspended;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * AI 가 지워지거나 이 작업 공간에서 사용 중지될 때 Works 가 켜 둔 실행을 끄는 리스너(WP-1247). 둘 다 user 모듈이 같은 트랜잭션에서 동기로 내는
 * 이벤트라, 삭제는 행이 FK CASCADE 로 사라지기 <b>전에</b>, 정지는 정지와 함께 커밋되게 처리된다.
 *
 * <p>관리자 삭제({@code AgentRemovalService})는 savepoint 안에서 지워 보고 기록이 남아 막히면 되돌린 뒤 사용 중지로 이어 간다 — 그때 삭제
 * 쪽에서 한 끄기도 함께 되돌려지므로 정지 이벤트에서 다시 끈다. 되돌려진 쪽이 낸 「다시 받아 가라」 신호는 runner 가 한 번 더 읽을 뿐이라 해가 없다.
 *
 * <p>테넌트는 이벤트에 담긴 값으로 세운다 — 발행한 쪽의 컨텍스트에 기대지 않는다.
 */
@Component
@RequiredArgsConstructor
public class AgentRuntimeRemovalListener {

  private final AgentRuntimeSettingService settingService;

  /** AI 삭제 — 행이 지워지기 전에 끄고 그 위치의 runner 에게 알린다. */
  @EventListener
  public void onAgentDeleted(AgentDeleted e) {
    TenantContext.runAs(e.tenantId(), () -> settingService.stopForRemoval(e.userId(), e.actorId()));
  }

  /** 이 작업 공간 멤버십 정지(AI 사용 중지 포함) — 켜져 있으면 끈다. 사람이거나 설정이 없으면 아무것도 하지 않는다. */
  @EventListener
  public void onWorkspaceMembershipSuspended(WorkspaceMembershipSuspended e) {
    TenantContext.runAs(e.tenantId(), () -> settingService.stopForRemoval(e.userId(), null));
  }
}
