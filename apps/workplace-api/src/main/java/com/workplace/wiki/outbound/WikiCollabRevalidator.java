package com.workplace.wiki.outbound;

import com.workplace.wiki.outbound.CollabClient.RevalidateRequest;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageAccessRevokedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiSpaceMembershipChangedEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 권한 변화 → 동기화 서버의 열린 연결 재검증(스펙 §4.1, WP-285). 커밋 후에만 알린다 — 롤백된 변경으로 연결을 끊지 않도록.
 *
 * <p>테넌트는 이벤트가 발행 시점에 담아 온 값을 쓴다. 비동기 워커 스레드에는 요청의 TenantContext 가 없기 때문이다. 실패는 로그만 남긴다 — 다음 재접속 때
 * 어차피 collab-access 로 다시 판정되므로 사용자 요청을 실패시키지 않는다.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class WikiCollabRevalidator {
  private final CollabClient collab;
  private final CollabProperties props;

  /** 스페이스 멤버 추가·역할 변경·제거 — 그 사용자의 그 스페이스 연결을 재판정(접근을 잃으면 권한 회수 4403). */
  @Async("wikiCollabRevalidateExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onMembership(WikiSpaceMembershipChangedEvent e) {
    send(new RevalidateRequest(e.tenantId(), e.spaceId(), null, e.userId()));
  }

  /** 페이지 삭제(서브트리) — 그 페이지들에 열린 모든 연결을 재판정한다. 삭제 사유를 실어 웹이 "삭제됨"으로 안내하게 한다. */
  @Async("wikiCollabRevalidateExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onPageAccessRevoked(WikiPageAccessRevokedEvent e) {
    send(
        new RevalidateRequest(
            e.tenantId(), e.spaceId(), e.pageIds(), null, RevalidateRequest.REASON_DELETED));
  }

  private void send(RevalidateRequest r) {
    if (!props.enabled()) {
      return;
    }
    try {
      collab.revalidate(r);
    } catch (RuntimeException ex) {
      log.warn(
          "collab revalidate 실패: tenant={} space={} pages={} user={} — {}",
          r.tenantId(),
          r.spaceId(),
          r.pageIds(),
          r.userId(),
          ex.getMessage());
    }
  }
}
