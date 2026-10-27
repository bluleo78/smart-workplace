package com.workplace.wiki.outbound;

import com.workplace.user.outbound.AgentDeleted;
import com.workplace.user.outbound.WorkspaceMembershipSuspended;
import com.workplace.wiki.outbound.CollabClient.RevalidateRequest;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageAccessRevokedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageSpaceChangedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiShareAccessChangedEvent;
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

  /**
   * 워크스페이스 멤버십 정지(WP-420) — 그 테넌트의 그 사용자 연결 전부(스페이스 무관)를 재판정한다. 동기화 서버는 연결에 보관한 사용자 토큰으로
   * collab-access 를 다시 부르고, 정지된 멤버십의 토큰은 이제 401 이라 4401(토큰 만료와 같은 경로)로 닫힌다 — 웹은 토큰을 갱신하려다 정지된
   * 워크스페이스에서 빠진다.
   */
  @Async("wikiCollabRevalidateExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onWorkspaceMembershipSuspended(WorkspaceMembershipSuspended e) {
    send(new RevalidateRequest(e.tenantId(), null, null, e.userId()));
  }

  /**
   * AGENT 삭제 — 그 사용자가 지정 대상·요청자였던 공유로 열린 연결을 사용자 단위로 재검증한다(정지와 같은 요청). 삭제된 사용자의 토큰은 이제 쓸 수 없어 연결이
   * 닫힌다. 그 에이전트가 만든 공유는 해제 경로가 낸 {@code WikiShareAccessChangedEvent} 가 페이지 단위로 재검증한다.
   */
  @Async("wikiCollabRevalidateExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onAgentDeleted(AgentDeleted e) {
    send(new RevalidateRequest(e.tenantId(), null, null, e.userId()));
  }

  /** 페이지 삭제(서브트리) — 그 페이지들에 열린 모든 연결을 재판정한다. 삭제 사유를 실어 웹이 "삭제됨"으로 안내하게 한다. */
  @Async("wikiCollabRevalidateExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onPageAccessRevoked(WikiPageAccessRevokedEvent e) {
    send(
        new RevalidateRequest(
            e.tenantId(), e.spaceId(), e.pageIds(), null, RevalidateRequest.REASON_DELETED));
  }

  /**
   * 노트 공유 범위 축소·해제·재발급(WP-579) — 그 페이지들에 <b>공유 링크로 붙은</b> 연결만 재판정한다. 멤버로 붙은 연결(공유 토큰 없음)은 판정이 스페이스
   * 멤버 역할만 보므로 공유 변경으로 권한이 바뀌지 않는다 — 다시 판정해도 API 호출만 늘 뿐이다. 스페이스로 좁히지 않는다: 공유로 붙은 연결도 페이지로만 찾으면 되고,
   * 사유는 없음(접근을 잃은 연결은 권한 회수 4403).
   */
  @Async("wikiCollabRevalidateExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onShareAccessChanged(WikiShareAccessChangedEvent e) {
    send(RevalidateRequest.sharedConnections(e.tenantId(), e.pageIds()));
  }

  /**
   * 페이지(서브트리)가 다른 스페이스로 옮겨 갔다(WP-988) — 그 페이지들의 열린 연결을 모두 다시 판정한다. 멤버로 붙은 연결도 대상이다: 옛 스페이스에만 있던 사람은
   * 접근을 잃고, 새 스페이스 멤버는 새 판정으로 이어진다. 사유는 없음(접근을 잃은 연결은 권한 회수 4403 — 삭제가 아니다).
   */
  @Async("wikiCollabRevalidateExecutor")
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onPageSpaceChanged(WikiPageSpaceChangedEvent e) {
    send(new RevalidateRequest(e.tenantId(), null, e.pageIds(), null));
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
