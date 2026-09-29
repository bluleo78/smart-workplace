package com.workplace.notify.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.workplace.messaging.outbound.MessagingDomainEvents.MessagePushRequestedEvent;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 메시지 푸시 매핑 — DM/멘션 카테고리 분리, 중복 시 DM 우선, 제목·url·tag 규칙. */
class PushDispatcherMessageTest {

  final PushSender sender = mock(PushSender.class);
  final PushDispatcher dispatcher = new PushDispatcher(mock(PushContentService.class), sender);

  @Test
  void dm_sendsDmCategory_withAuthorTitle() {
    dispatcher.onMessagePush(
        new MessagePushRequestedEvent(
            1L, 42L, "DM", null, 1234L, null, 7L, "박민수", "안녕", List.of(8L), List.of(8L)));

    ArgumentCaptor<PushMessage> m = ArgumentCaptor.forClass(PushMessage.class);
    verify(sender).send(eq(List.of(8L)), m.capture());
    assertThat(m.getValue().category()).isEqualTo(PushCategory.DM);
    assertThat(m.getValue().title()).isEqualTo("박민수");
    assertThat(m.getValue().url()).isEqualTo("/chat/dms/42");
    assertThat(m.getValue().tag()).isEqualTo("ch-42");
    assertThat(m.getValue().urgency()).isEqualTo("high");
    assertThat(m.getValue().ttlSeconds()).isEqualTo(86400);
  }

  @Test
  void channelMention_threadReply_urlHasThread() {
    dispatcher.onMessagePush(
        new MessagePushRequestedEvent(
            1L, 5L, "CHANNEL", "backend", 10L, 3L, 7L, "박민수", "리뷰", List.of(), List.of(9L)));

    ArgumentCaptor<PushMessage> m = ArgumentCaptor.forClass(PushMessage.class);
    verify(sender).send(eq(List.of(9L)), m.capture());
    assertThat(m.getValue().category()).isEqualTo(PushCategory.MENTION);
    assertThat(m.getValue().title()).isEqualTo("#backend · 박민수");
    assertThat(m.getValue().url()).isEqualTo("/chat/channels/5?thread=3");
  }
}
