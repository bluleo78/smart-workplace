package com.workplace.chat.outbound;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageDeletedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadTypingEvent;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.realtime.SseRegistry;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class ChatSseDispatcherTest {

  private SseRegistry registry;
  private ChatThreadMemberRepository memberRepo;
  private ChatSseDispatcher dispatcher;

  private static final UserSummary HUMAN = new UserSummary(1L, "alice", "Alice", "HUMAN");

  @BeforeEach
  void setUp() {
    registry = Mockito.mock(SseRegistry.class);
    memberRepo = Mockito.mock(ChatThreadMemberRepository.class);
    dispatcher = new ChatSseDispatcher(registry, memberRepo);
    when(memberRepo.findMemberIds(5L)).thenReturn(List.of(1L, 2L));
  }

  @Test
  void created_fansOutToAllMembers() {
    dispatcher.onCreated(
        new ChatMessageCreatedEvent(
            5L,
            10L,
            100L,
            "WP",
            "WP-1",
            "제목",
            "TODO",
            "본문",
            HUMAN,
            "hi",
            List.of(),
            List.of(),
            List.of(),
            Instant.now()));
    verify(registry).fanOut(eq(List.of(1L, 2L)), eq("chat.message.created"), any());
  }

  @Test
  void deleted_fansOutToAllMembers() {
    dispatcher.onDeleted(new ChatMessageDeletedEvent(5L, 10L));
    verify(registry).fanOut(eq(List.of(1L, 2L)), eq("chat.message.deleted"), any());
  }

  @Test
  void typing_fansOutToAllMembers() {
    dispatcher.onTyping(new ChatThreadTypingEvent(5L, HUMAN));
    verify(registry).fanOut(eq(List.of(1L, 2L)), eq("chat.thread.typing"), any());
  }
}
