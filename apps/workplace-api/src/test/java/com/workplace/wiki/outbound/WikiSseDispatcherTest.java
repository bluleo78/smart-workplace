package com.workplace.wiki.outbound;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageCreatedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageDeletedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageMovedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageUpdatedEvent;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

/** WikiSseDispatcher 단위 테스트 — 노트 생성·수정·삭제·이동 SSE 가 스페이스 멤버 전원에게 fan-out 되는지 검증 (#724). */
class WikiSseDispatcherTest {

  private SseRegistry registry;
  private WikiSpaceMemberRepository members;
  private WikiSseDispatcher dispatcher;

  @BeforeEach
  void setUp() {
    registry = Mockito.mock(SseRegistry.class);
    members = Mockito.mock(WikiSpaceMemberRepository.class);
    dispatcher = new WikiSseDispatcher(registry, members);
    when(members.memberUserIds(7L)).thenReturn(List.of(1L, 2L, 3L));
  }

  @Test
  void onCreated_fansOutToAllMembers_withSpaceAndPageId() {
    dispatcher.onCreated(new WikiPageCreatedEvent(7L, 42L, null, "새 노트", 1L, Instant.now()));

    verify(registry)
        .fanOut(
            eq(List.of(1L, 2L, 3L)),
            eq("wiki.page.created"),
            Mockito.argThat(
                payload -> {
                  @SuppressWarnings("unchecked")
                  var p = (java.util.Map<String, Object>) payload;
                  return Long.valueOf(7L).equals(p.get("spaceId"))
                      && Long.valueOf(42L).equals(p.get("pageId"))
                      && "새 노트".equals(p.get("title"));
                }));
  }

  @Test
  void onUpdated_fansOutToAllMembers() {
    dispatcher.onUpdated(new WikiPageUpdatedEvent(7L, 42L, "수정됨", 1L, Instant.now()));
    verify(registry).fanOut(eq(List.of(1L, 2L, 3L)), eq("wiki.page.updated"), any());
  }

  @Test
  void onDeleted_fansOutToAllMembers() {
    dispatcher.onDeleted(new WikiPageDeletedEvent(7L, 42L, 1L, Instant.now()));
    verify(registry).fanOut(eq(List.of(1L, 2L, 3L)), eq("wiki.page.deleted"), any());
  }

  @Test
  void onMoved_fansOutToAllMembers() {
    dispatcher.onMoved(new WikiPageMovedEvent(7L, 42L, 1L, Instant.now()));
    verify(registry).fanOut(eq(List.of(1L, 2L, 3L)), eq("wiki.page.moved"), any());
  }
}
