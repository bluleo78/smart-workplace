package com.workplace.user.service;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.user.outbound.WorkspaceMembershipSuspended;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 멤버십 정지 → 그 사용자의 SSE 스트림 종료(WP-420). JWT 필터는 새 요청만 막으므로, 이미 열린 장수명 스트림(최대 1h)은 서버가 직접 닫아야 정지된
 * 워크스페이스 이벤트를 더 받지 않는다. 커밋 후에만 닫는다 — 롤백된 정지로 연결을 끊지 않도록. 닫힘 신호는 파드 사이 중계(WP-1973)를 거쳐 — 중계를 켠 상태에서는
 * 모든 파드의 그 유저 연결을 닫고, 끈 상태(Noop)에서는 지금처럼 로컬 연결만 바로 닫는다.
 */
@Component
@RequiredArgsConstructor
public class SuspendedMemberStreamCloser {
  private final SseRegistry sseRegistry;

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onSuspended(WorkspaceMembershipSuspended e) {
    sseRegistry.closeAll(e.userId());
  }
}
