package com.workplace.chat.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.chat.dto.ChatMessageAttachmentResponse;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageCreatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageDeletedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageOptionsEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatMessageUpdatedEvent;
import com.workplace.chat.outbound.ChatDomainEvents.ChatThreadTypingEvent;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.realtime.SseRegistry;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
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
            null,
            "본문",
            HUMAN,
            "hi",
            List.of(),
            List.of(),
            List.of(),
            true,
            ChatMessageOrigin.REPORT_QUESTION,
            Instant.now(),
            null,
            null,
            null,
            List.of("A안", "B안"),
            List.of()));
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
    verify(registry).fanOut(eq(List.of(1L, 2L)), eq("chat.message.created"), payload.capture());
    // 질문 표시가 이벤트 값 그대로 SSE 페이로드에 실린다.
    assertThat(payload.getValue()).containsEntry("question", true);
    // 작성자 username 도 실려야 프론트가 멘션·표시에 쓸 수 있다.
    assertThat(payload.getValue()).containsEntry("authorUsername", "alice");
    // WP-1569: 보고와 함께 저장한 답 선택지도 그대로 실린다.
    assertThat(payload.getValue()).containsEntry("options", List.of("A안", "B안"));
  }

  /**
   * WP-1569: 서버 보완 추출 선택지는 chat.message.options 로 {threadId, messageId, options} 만 스레드 멤버에게 보낸다.
   */
  @Test
  void options_fansOutOnlyOptionsToAllMembers() {
    dispatcher.onOptions(new ChatMessageOptionsEvent(5L, 10L, List.of("예", "아니오")));
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
    verify(registry).fanOut(eq(List.of(1L, 2L)), eq("chat.message.options"), payload.capture());
    assertThat(payload.getValue())
        .containsExactly(
            Map.entry("threadId", 5L),
            Map.entry("messageId", 10L),
            Map.entry("options", List.of("예", "아니오")));
  }

  /** WP-1680: 수정 SSE 는 수정 뒤 첨부 전체 목록을 늘 싣는다 — 다른 사람 화면이 뺀 첨부를 바로 지우게. 첨부가 없으면 빈 목록(키는 늘 있다). */
  @Test
  void updated_carriesAttachmentsKey() {
    var att =
        new ChatMessageAttachmentResponse(
            7L, 10L, "a.txt", "text/plain", 3L, 1L, "Alice", Instant.now(), null);
    dispatcher.onUpdated(
        new ChatMessageUpdatedEvent(5L, 10L, "본문", List.of(), Instant.now(), List.of(att)));
    dispatcher.onUpdated(
        new ChatMessageUpdatedEvent(5L, 11L, "본문", List.of(), Instant.now(), List.of()));
    @SuppressWarnings("unchecked")
    ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
    verify(registry, Mockito.times(2))
        .fanOut(eq(List.of(1L, 2L)), eq("chat.message.updated"), payload.capture());
    assertThat(payload.getAllValues().get(0)).containsEntry("attachments", List.of(att));
    assertThat(payload.getAllValues().get(1)).containsEntry("attachments", List.of());
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
