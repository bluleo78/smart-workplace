package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.ReadSyncLocator;

/**
 * 로컬 읽음표시를 원본 서버(Graph/IMAP)에 역동기화하는 공급자별 인터페이스.
 *
 * <p>계약: 서버 반영이 실패하면(재시도에 의미가 있는 경우) 예외를 던지고, 다시 해도 안 되는 경우(uid·비밀번호 없음, 서버에 메일 없음 등)는 정상
 * 반환(건너뜀)한다. 예외는 호출 측 이벤트 리스너가 흡수(best-effort)하며, 예외로 끝난 메일만 "서버 반영 대기" 표시가 남는다.
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
   * @throws Exception 서버 반영 실패(네트워크·인증·429 등) — 호출 측이 대기 표시를 유지한다
   */
  void markReadOnServer(long userId, EmailAccountResponse account, ReadSyncLocator loc)
      throws Exception;
}
