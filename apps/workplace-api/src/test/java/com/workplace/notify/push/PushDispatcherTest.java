package com.workplace.notify.push;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.notify.dto.NotificationType;
import java.util.List;
import org.junit.jupiter.api.Test;

/** PushDispatcher 인박스 경로 — 조립 결과를 수신자에게 전달, null(대상 삭제)이면 미발송, 예외는 삼킨다. */
class PushDispatcherTest {

  final PushContentService content = mock(PushContentService.class);
  final PushSender sender = mock(PushSender.class);
  final PushDispatcher dispatcher = new PushDispatcher(content, sender);

  final InboxPushRequestedEvent e =
      new InboxPushRequestedEvent(1L, NotificationType.CALENDAR_INVITED, List.of(5L), 2L, null, 9L);

  @Test
  void onInboxPush_sendsBuiltMessage() {
    PushMessage m =
        new PushMessage(
            1L,
            PushCategory.CALENDAR,
            "주간회의",
            "박민수님이 일정에 초대했습니다",
            "/calendar?eventId=9",
            "event-9",
            "normal",
            259200);
    when(content.forInbox(e)).thenReturn(m);
    dispatcher.onInboxPush(e);
    verify(sender).send(List.of(5L), m);
  }

  @Test
  void onInboxPush_nullContent_skips() {
    when(content.forInbox(e)).thenReturn(null);
    dispatcher.onInboxPush(e);
    verify(sender, never()).send(any(), any());
  }

  @Test
  void onInboxPush_exception_isSwallowed() {
    when(content.forInbox(e)).thenThrow(new RuntimeException("boom"));
    dispatcher.onInboxPush(e); // 예외 전파 없음
  }
}
