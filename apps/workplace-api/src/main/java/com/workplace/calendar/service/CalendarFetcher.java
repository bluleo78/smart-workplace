package com.workplace.calendar.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;

/** 공급자별 캘린더 동기화 seam. provider() 를 키로 CalendarSyncService 가 디스패치한다. */
public interface CalendarFetcher {

  /** 이 구현이 담당하는 공급자. */
  MailProvider provider();

  /**
   * 외부 캘린더를 동기화해 external_calendar / calendar_event 에 upsert/prune 한다.
   *
   * @param userId 계정 소유자
   * @param accountId email_account.id
   * @param account 계정 응답 DTO
   * @return upsert 된 이벤트 수
   */
  int sync(long userId, long accountId, EmailAccountResponse account);
}
