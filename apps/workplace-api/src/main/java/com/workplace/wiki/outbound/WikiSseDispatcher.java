package com.workplace.wiki.outbound;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.util.AfterCommit;
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
 * 메운다. 대상은 {@code wiki_space_member} 전원(self-echo 허용 — 멀티기기 동기화 + 자기 캐시는 이미 낙관적 갱신했으므로 재조회만 유발해도
 * 무해). 프론트({@code useWikiStream})가 {@code wikiKeys.tree/page/spaces} 를 무효화한다.
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
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("spaceId", e.spaceId());
    p.put("pageId", e.pageId());
    p.put("parentId", e.parentId());
    p.put("title", e.title());
    p.put("actorId", e.actorId());
    Collection<Long> to = members.memberUserIds(e.spaceId());
    AfterCommit.run(() -> registry.fanOut(to, "wiki.page.created", p));
  }

  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onUpdated(WikiPageUpdatedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("spaceId", e.spaceId());
    p.put("pageId", e.pageId());
    p.put("title", e.title());
    p.put("actorId", e.actorId());
    Collection<Long> to = members.memberUserIds(e.spaceId());
    AfterCommit.run(() -> registry.fanOut(to, "wiki.page.updated", p));
  }

  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onDeleted(WikiPageDeletedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("spaceId", e.spaceId());
    p.put("pageId", e.pageId());
    p.put("actorId", e.actorId());
    Collection<Long> to = members.memberUserIds(e.spaceId());
    AfterCommit.run(() -> registry.fanOut(to, "wiki.page.deleted", p));
  }

  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onMoved(WikiPageMovedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("spaceId", e.spaceId());
    p.put("pageId", e.pageId());
    p.put("actorId", e.actorId());
    Collection<Long> to = members.memberUserIds(e.spaceId());
    AfterCommit.run(() -> registry.fanOut(to, "wiki.page.moved", p));
  }
}
