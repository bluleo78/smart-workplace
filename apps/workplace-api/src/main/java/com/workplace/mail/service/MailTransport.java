package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.OutgoingMail;
import jakarta.mail.internet.MimeMessage;

/**
 * 공급자별 메일 전송 계층. 공통 작성(검증·Message-ID·답장 컨텍스트·MIME 조립)은 MailComposeService 가 수행하고, 실제 전송 경로만 공급자별로
 * 분기한다(IMAP→SMTP, M365_GRAPH→Graph sendMail). MailFetcher/MailBodyLoader 와 동일한 패턴.
 */
public interface MailTransport {

  /** 이 전송기가 담당하는 공급자. */
  MailProvider provider();

  /**
   * 조립된 MIME 메시지를 전송한다.
   *
   * @param userId 계정 소유자(자격증명 조회 스코프)
   * @param account 발신 계정
   * @param message MailMimeBuilder 로 조립된 전송본(스레딩 헤더 포함)
   * @param mail 봉투 수신자(SMTP Bcc 등) 산출용 원본
   * @return 실제로 나간 Message-ID(꺾쇠 제외) — 늘 값이 있다. 대개 MIME 에 넣은 값이고, Graph 초안 경로는 Exchange 가 붙인 값을
   *     확인하면 그 값(확인하지 못하면 MIME 값)이다. 로컬 SENT 행이 이 값으로 스레드를 묶는다(WP-574).
   */
  String transmit(
      long userId, EmailAccountResponse account, MimeMessage message, OutgoingMail mail);
}
