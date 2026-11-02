package com.workplace.wiki.outbound;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.util.AfterCommit;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiHtmlLockChangedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageCreatedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageDeletedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageMovedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageUpdatedEvent;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 노트(위키) 도메인 이벤트를 브라우저 SSE(/api/v1/events)로 스페이스 멤버에게 fan-out 한다 (#724).
 *
 * <p>{@code IssueSseDispatcher} 와 동일 패턴 — AI 비서/타 세션의 노트 생성·수정·삭제·이동이 열려 있는 노트 화면에 실시간 반영되지 않던 갭을
 * 메운다. 대상은 스페이스 실효 멤버 전원(직접 멤버 + 멤버로 둔 조직도 부서 구성원, WP-1052 — self-echo 허용 — 멀티기기 동기화 + 자기 캐시는 이미
 * 낙관적 갱신했으므로 재조회만 유발해도 무해). 프론트({@code useWikiStream})가 {@code wikiKeys.tree/page/spaces} 를 무효화한다.
 *
 * <p>수신자는 커밋 직전(BEFORE_COMMIT)에 요청 트랜잭션 안에서 조회하고(커넥션·GUC 를 그대로 써 RLS 가 맞게 걸린다), 전송만 {@link
 * AfterCommit} 로 커밋 뒤로 미뤄 커밋된 변경만 알린다(롤백되면 보내지 않는다). 예전처럼 커밋 뒤 REQUIRES_NEW 로 다시 조회하면 요청 커넥션을 쥔 채 두
 * 번째 커넥션을 빌려, 동시 쓰기가 풀 크기를 넘으면 모두가 서로를 기다리며 멈췄다(WP-751).
 */
@Component
@RequiredArgsConstructor
public class WikiSseDispatcher {

  private final SseRegistry registry;
  private final WikiSpaceMemberRepository members;

  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onCreated(WikiPageCreatedEvent e) {
    Map<String, Object> p = page(e.spaceId(), e.pageId());
    p.put("parentId", e.parentId());
    p.put("title", e.title());
    p.put("actorId", e.actorId());
    send(e.spaceId(), "wiki.page.created", p);
  }

  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onUpdated(WikiPageUpdatedEvent e) {
    Map<String, Object> p = page(e.spaceId(), e.pageId());
    p.put("title", e.title());
    p.put("actorId", e.actorId());
    send(e.spaceId(), "wiki.page.updated", p);
  }

  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onDeleted(WikiPageDeletedEvent e) {
    Map<String, Object> p = page(e.spaceId(), e.pageId());
    p.put("actorId", e.actorId());
    send(e.spaceId(), "wiki.page.deleted", p);
  }

  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onMoved(WikiPageMovedEvent e) {
    Map<String, Object> p = page(e.spaceId(), e.pageId());
    p.put("actorId", e.actorId());
    send(e.spaceId(), "wiki.page.moved", p);
  }

  /**
   * 「HTML 문서」 편집 잠금 변경(WP-1308) — 바뀐 뒤의 잠금(쥔 사람 id·이름·시작·자동 풀림 시각, 풀렸으면 locked=false)을 실어 화면({@code
   * useWikiStream})이 다시 받지 않고 잠금 캐시를 바로 바꾼다. 내 잠금인지·강제로 풀 수 있는지는 화면이 내 id·스페이스 역할로 가린다. 편집 세션
   * 표지(token)는 싣지 않는다.
   */
  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onHtmlLockChanged(WikiHtmlLockChangedEvent e) {
    Map<String, Object> p = page(e.spaceId(), e.pageId());
    p.put("actorId", e.actorId());
    p.put("locked", e.holderId() != null);
    p.put("holderId", e.holderId());
    p.put("holderName", e.holderName());
    p.put("acquiredAt", e.acquiredAt() != null ? e.acquiredAt().toString() : null);
    p.put("expiresAt", e.expiresAt() != null ? e.expiresAt().toString() : null);
    send(e.spaceId(), "wiki.page.lock", p);
  }

  /** 모든 이벤트에 공통인 spaceId·pageId 로 시작하는 payload(순서 유지). */
  private static Map<String, Object> page(long spaceId, long pageId) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("spaceId", spaceId);
    p.put("pageId", pageId);
    return p;
  }

  /** 수신자(스페이스 실효 멤버)는 지금(트랜잭션 안) 조회하고, 전송만 커밋 뒤로 미룬다 — 클래스 주석의 WP-751 참고. */
  private void send(long spaceId, String eventName, Map<String, Object> payload) {
    Collection<Long> to = members.memberUserIds(spaceId);
    AfterCommit.run(() -> registry.fanOut(to, eventName, payload));
  }
}
