package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailValidationException;
import org.junit.jupiter.api.Test;

/**
 * 대기열 실패 사유(send_error) 문구(WP-1786 최종 리뷰 T4-M2) — 화면(「보내지 못한 이유」)에 그대로 보이므로 사용자용 문구만 남고, 내부 문구(공급자
 * 응답 코드·라이브러리 메시지)는 기본 문구로 바뀌어야 한다.
 */
class MailQueuedSenderUserMessageTest {

  @Test
  void 입력_검증_문구는_그대로_남는다() {
    assertThat(MailQueuedSender.userMessage(new MailValidationException("올바르지 않은 이메일 주소: kim@")))
        .isEqualTo("올바르지 않은 이메일 주소: kim@");
  }

  @Test
  void 허용한_발송_실패_문구는_그대로_남는다() {
    assertThat(
            MailQueuedSender.userMessage(
                MailSendException.userFacing(GraphMailTransport.LARGE_SEND_FAILED)))
        .isEqualTo(GraphMailTransport.LARGE_SEND_FAILED);
    assertThat(
            MailQueuedSender.userMessage(
                MailSendException.userFacing(MailComposeService.ATTACHMENT_READ_FAILED_MESSAGE)))
        .isEqualTo(MailComposeService.ATTACHMENT_READ_FAILED_MESSAGE);
  }

  @Test
  void 계정이_없으면_계정_문구가_남는다() {
    assertThat(MailQueuedSender.userMessage(new EmailAccountNotFoundException(1L)))
        .isEqualTo("메일 계정을 찾을 수 없습니다");
  }

  @Test
  void 내부_발송_실패_문구는_기본_문구로_바뀐다() {
    assertThat(MailQueuedSender.userMessage(new MailSendException("Graph post 실패: 500")))
        .isEqualTo(MailQueuedSender.GENERIC_FAILURE);
    assertThat(MailQueuedSender.userMessage(new MailSendException("지원하지 않는 메일 공급자: IMAP")))
        .isEqualTo(MailQueuedSender.GENERIC_FAILURE);
    assertThat(MailQueuedSender.userMessage(new IllegalStateException("boom")))
        .isEqualTo(MailQueuedSender.GENERIC_FAILURE);
  }
}
