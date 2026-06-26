package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.ReadSyncLocator;

/**
 * 로컬 읽음표시를 원본 서버(Graph/IMAP)에 역동기화하는 공급자별 인터페이스.
 *
 * <p>best-effort: 구현체가 예외를 흡수하거나, 호출 측 이벤트 리스너가 흡수한다.
 */
public interface MailReadSyncer {

  /** 이 구현체가 처리하는 메일 공급자. */
  MailProvider provider();

  /**
   * 원본 서버에 메시지 읽음 처리를 요청한다.
   *
   * @param userId 현재 사용자 id (Graph 토큰 조회 등에 사용)
   * @param account 메일 계정 응답 DTO (IMAP 접속 정보 등 — Graph 구현은 무시 가능)
   * @param loc 서버측 메시지 식별자 (providerMessageId 또는 imapUid+folderName)
   */
  void markReadOnServer(long userId, EmailAccountResponse account, ReadSyncLocator loc);
}
