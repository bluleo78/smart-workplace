package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.repository.EmailFolderRepository.FolderTarget;
import java.time.Instant;

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

  /**
   * 받은편지함·서버 보낸편지함의 이전 메일 더 가져오기(WP-965) — 경계 {@code folder.syncedSince()} 바로 앞 {@link
   * #FOLDER_INITIAL_WINDOW_DAYS}일 수신분만 받아 넣고 경계를 그 시작으로 옮긴다. IMAP 증분 커서(last_seen_uid)는 건드리지 않는다.
   * Graph 받은편지함 delta 도 그대로 둔다(기간 필터가 없어 지우면 받은편지함 전체를 다시 받는다) — 서버 보낸편지함 delta 는 기간 필터가 있어 지우고 다음
   * 동기화가 새 경계부터 다시 시작한다(옛 메일의 읽음·삭제도 받게, 메일함과 같다). 넣은 뒤 새 경계 앞에 서버 메일이 더 있는지(hasMore)도 확인한다.
   *
   * @param folder 호출자(MailFolderService)가 정한 경계를 syncedSince 에 담은 대상. Graph 는 remoteId 가 없으면 폴더
   *     이름으로 연다(INBOX → well-known {@code inbox})
   * @return 아직 첫 동기화 전(IMAP UIDVALIDITY 없음)이거나 UIDVALIDITY 가 바뀌었으면 아무것도 받지 않고 ready=false — 정기 동기화가
   *     커서를 맞춘 뒤 다시 부르면 된다
   */
  OlderFetch fetchOlderBefore(
      long userId, long accountId, EmailAccountResponse account, FolderTarget folder);

  /**
   * 받은편지함 첫 동기화가 서버 받은편지함 전체를 받는지(WP-965 — 이전 메일 경계 정하기). 그렇다면 가장 오래된 로컬 메일이 곧 가져온 범위의 시작이다. 아니면(첫
   * 동기화가 최근 {@link ImapMailFetcher#INITIAL_WINDOW_DAYS}일만) 로컬에 옛 메일이 한 통 섞여 있어도(다른 앱에서 받은편지함으로 되돌린
   * 메일 등) 그 사이 메일을 건너뛰지 않게 폴더를 만든 시각 − 첫 동기화 기간을 경계로 쓴다.
   */
  default boolean firstSyncTakesWholeInbox() {
    return false;
  }

  /**
   * 이전 메일 더 가져오기 결과(WP-965).
   *
   * @param result 받은·넣은 수
   * @param syncedSince 옮긴 경계(받지 않았으면 null)
   * @param hasMore 새 경계 앞에 서버 메일이 더 있는지
   * @param ready 지금 가져올 수 있었는지 — false 면 첫 동기화 전·UIDVALIDITY 변경으로 받지 않았다(잠시 뒤 다시)
   */
  record OlderFetch(MailSyncResult result, Instant syncedSince, boolean hasMore, boolean ready) {

    /** 아직 가져올 수 없어 받지 않은 결과 — 정기 동기화가 커서를 맞춘 뒤 다시 부르면 된다. */
    static OlderFetch notReady() {
      return new OlderFetch(new MailSyncResult(0, 0, 0, 0), null, true, false);
    }
  }

  /** 메일함 첫 동기화·이전 메일 더 가져오기 한 번의 기간(일). 받은편지함은 각 구현의 기존 기간(IMAP 7일)을 그대로 쓴다. */
  int FOLDER_INITIAL_WINDOW_DAYS = 90;
}
