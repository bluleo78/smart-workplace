package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSyncResult;

/** 공급자별 받은편지함 동기화(신규 메시지 메타를 email_message 로 적재). 본문은 적재하지 않는다(on-demand). */
public interface MailFetcher {
  /** 이 구현이 담당하는 공급자. {@code MailSyncService} 가 account.provider() 로 디스패치한다. */
  MailProvider provider();

  /** 신규/변경 메시지 메타를 동기화한다. 네트워크 오류는 {@link com.workplace.mail.exception.MailSyncException} 로 던진다. */
  MailSyncResult fetchNewMessages(long userId, long accountId, EmailAccountResponse account);
}
