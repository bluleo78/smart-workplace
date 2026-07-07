package com.workplace.wiki.outbound;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageCreatedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageDeletedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageMovedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageUpdatedEvent;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 노트(위키) 도메인 이벤트를 브라우저 SSE(/api/v1/events)로 스페이스 멤버에게 fan-out 한다 (#724).
 *
 * <p>{@code IssueSseDispatcher} 와 동일 패턴 — AI 비서/타 세션의 노트 생성·수정·삭제·이동이 열려 있는 노트 화면에 실시간 반영되지 않던 갭을
 * 메운다. 대상은 {@code wiki_space_member} 전원(self-echo 허용 — 멀티기기 동기화 + 자기 캐시는 이미 낙관적 갱신했으므로 재조회만 유발해도
 * 무해). 프론트({@code useWikiStream})가 {@code wikiKeys.tree/page/spaces} 를 무효화한다.
 *
 * <p>{@code @Transactional(REQUIRES_NEW)} 필수 — AFTER_COMMIT 리스너는 원 트랜잭션 커밋 후 실행되어 트랜잭션-로컬 GUC 가
 * 소멸한다. REQUIRES_NEW 로 새 트랜잭션을 열면 TenantAwareTransactionManager.doBegin 이 요청 스레드에 남은 TenantContext
 * 로 GUC 를 재주입하므로 {@code memberUserIds} 가 RLS fail-closed 로 빈 목록이 되지 않는다(IssueSseDispatcher 와 동일).
 */
@Component
@RequiredArgsConstructor
public class WikiSseDispatcher {

  private final SseRegistry registry;
  private final WikiSpaceMemberRepository members;

  // AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입.
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCreated(WikiPageCreatedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("spaceId", e.spaceId());
    p.put("pageId", e.pageId());
    p.put("parentId", e.parentId());
    p.put("title", e.title());
    p.put("actorId", e.actorId());
    registry.fanOut(members.memberUserIds(e.spaceId()), "wiki.page.created", p);
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onUpdated(WikiPageUpdatedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("spaceId", e.spaceId());
    p.put("pageId", e.pageId());
    p.put("title", e.title());
    p.put("actorId", e.actorId());
    registry.fanOut(members.memberUserIds(e.spaceId()), "wiki.page.updated", p);
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onDeleted(WikiPageDeletedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("spaceId", e.spaceId());
    p.put("pageId", e.pageId());
    p.put("actorId", e.actorId());
    registry.fanOut(members.memberUserIds(e.spaceId()), "wiki.page.deleted", p);
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onMoved(WikiPageMovedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("spaceId", e.spaceId());
    p.put("pageId", e.pageId());
    p.put("actorId", e.actorId());
    registry.fanOut(members.memberUserIds(e.spaceId()), "wiki.page.moved", p);
  }
}
