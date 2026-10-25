package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.repository.EmailFolderRepository.FolderTarget;

/** 공급자별 메일 동기화(신규 메시지 메타를 email_message 로 적재). 본문은 적재하지 않는다(on-demand). */
public interface MailFetcher {
  /** 이 구현이 담당하는 공급자. {@code MailSyncService} 가 account.provider() 로 디스패치한다. */
  MailProvider provider();

  /**
   * 받은편지함의 신규 메시지 메타를 적재하고, 이미 있는 메일의 서버 읽음 상태를 로컬 seen 에 반영한다(WP-148, 서버 기준). 읽음 반영 건수는 {@link
   * MailSyncResult#seenChanged()} 로 돌려주며 새 메일 수(saved)에 섞지 않는다. 네트워크 오류는 {@link
   * com.workplace.mail.exception.MailSyncException} 로 던진다.
   */
  MailSyncResult fetchNewMessages(long userId, long accountId, EmailAccountResponse account);

  /**
   * 서버 메일함(보관·사용자 폴더) 한 개를 동기화한다(WP-960). 첫 동기화는 최근 {@link #FOLDER_INITIAL_WINDOW_DAYS}일, 이후는 증분(읽음
   * 반영·서버 삭제 반영 포함). older=true 면 가져온 경계(synced_since) 바로 앞 {@link #FOLDER_INITIAL_WINDOW_DAYS}일만 더
   * 받아 경계를 뒤로 옮긴다 — IMAP 은 증분 커서를 건드리지 않고, Graph 는 delta 커서를 지워 다음 동기화가 새 경계로 delta 를 다시 시작한다. 아직 한
   * 번도 가져오지 않은 폴더면 older 를 무시하고 첫 동기화를 한다. 끝나면 folder_synced_at 을 기록한다.
   */
  MailSyncResult syncFolder(
      long userId,
      long accountId,
      EmailAccountResponse account,
      FolderTarget folder,
      boolean older);

  /** 메일함 첫 동기화·이전 메일 더 가져오기 한 번의 기간(일). 받은편지함은 각 구현의 기존 기간(IMAP 7일)을 그대로 쓴다. */
  int FOLDER_INITIAL_WINDOW_DAYS = 90;
}
