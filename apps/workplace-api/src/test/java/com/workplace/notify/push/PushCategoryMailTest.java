package com.workplace.notify.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 메일 새 알림 푸시 — MAIL 카테고리, 미리 보기 가림(본문 「새 메일」 고정), dispatchMail best-effort 발송(WP-1739). */
class PushCategoryMailTest {

  final PushSender sender = mock(PushSender.class);
  final PushDispatcher dispatcher = new PushDispatcher(mock(PushContentService.class), sender);

  /** 미리 보기 끔 기준 메일 푸시 원문 — 제목은 보낸 사람, 본문은 미리 보기 내용. */
  final PushMessage mail =
      new PushMessage(
          1L,
          PushCategory.MAIL,
          "홍길동",
          "계약서 검토 부탁",
          "/mail/7?messageId=9",
          "mail-7",
          "high",
          86400);

  @Test
  void redacted_mail_bodyOnlyFixed() {
    // 미리 보기 끔: 본문만 「새 메일」 로 고정하고 제목·이동 정보(tag·urgency·ttl 포함)는 유지한다.
    PushMessage r = mail.redacted();

    assertThat(r.body()).isEqualTo("새 메일");
    assertThat(r.title()).isEqualTo("홍길동");
    assertThat(r.url()).isEqualTo("/mail/7?messageId=9");
    assertThat(r.tag()).isEqualTo("mail-7");
    assertThat(r.urgency()).isEqualTo("high");
    assertThat(r.ttlSeconds()).isEqualTo(86400);
    assertThat(r.category()).isEqualTo(PushCategory.MAIL);
    assertThat(r.tenantId()).isEqualTo(1L);
  }

  @Test
  void dispatchMail_sendsOnce() {
    // 발송 진입점 — 수신자 목록과 메시지를 그대로 sender 로 넘긴다.
    List<Long> userIds = List.of(3L, 8L);
    dispatcher.dispatchMail(userIds, mail);

    verify(sender).send(eq(userIds), eq(mail));
    verifyNoMoreInteractions(sender);
  }

  @Test
  void dispatchMail_exceptionSwallowed() {
    // 푸시는 best-effort — 발송 실패가 호출자(커밋 후 pushExecutor)까지 전파되면 안 된다.
    doThrow(new RuntimeException("boom")).when(sender).send(eq(List.of(3L)), eq(mail));

    assertThatCode(() -> dispatcher.dispatchMail(List.of(3L), mail)).doesNotThrowAnyException();
  }

  @Test
  void dispatchMail_passesMailCategoryThrough() {
    // 카테고리가 그대로 실려야 서비스워커가 MAIL 로 표시·가림 규칙을 적용한다.
    dispatcher.dispatchMail(List.of(3L), mail);

    ArgumentCaptor<PushMessage> m = ArgumentCaptor.forClass(PushMessage.class);
    verify(sender).send(eq(List.of(3L)), m.capture());
    assertThat(m.getValue().category()).isEqualTo(PushCategory.MAIL);
  }
}
