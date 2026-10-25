package com.workplace.mail.service;

import jakarta.mail.Folder;
import jakarta.mail.MessagingException;
import jakarta.mail.Store;
import java.util.Arrays;
import org.eclipse.angus.mail.imap.IMAPFolder;

/**
 * IMAP 서버의 보낸편지함 폴더 찾기(WP-950). 발송본 APPEND({@link MailSentAppender})와 보낸편지함 동기화({@link
 * ImapMailFetcher})가 같은 폴더를 보게 한곳에 둔다.
 *
 * <p>먼저 SPECIAL-USE({@code \Sent}, RFC 6154) 표시가 붙은 폴더를 찾고 — 「보낸 편지함」처럼 이름이 제각각인 서버도 맞힌다 — 표시를 지원하지
 * 않는 서버는 흔한 이름 후보로 찾는다.
 */
final class ImapSentFolderLocator {

  /** SPECIAL-USE 를 지원하지 않는 서버용 흔한 Sent 폴더 이름(서버마다 명칭 상이). 존재하는 첫 폴더. */
  static final String[] SENT_CANDIDATES = {
    "Sent", "Sent Items", "[Gmail]/Sent Mail", "Sent Messages", "INBOX.Sent"
  };

  /** SPECIAL-USE 보낸편지함 표시(RFC 6154). */
  private static final String SENT_ATTRIBUTE = "\\Sent";

  private ImapSentFolderLocator() {}

  /**
   * 보낸편지함 폴더(없으면 null). known(지난번에 찾은 이름)이 아직 있으면 그것을 쓴다 — 동기화마다 전체 폴더 목록(LIST)을 받지 않게. 폴더 목록 실패는
   * 이름 후보 탐색으로 넘어간다.
   */
  static Folder find(Store store, String known) throws MessagingException {
    if (known != null) {
      Folder f = store.getFolder(known);
      if (f.exists()) {
        return f;
      }
    }
    try {
      for (Folder f : store.getDefaultFolder().list("*")) {
        if (f instanceof IMAPFolder imap
            && Arrays.stream(imap.getAttributes()).anyMatch(SENT_ATTRIBUTE::equalsIgnoreCase)) {
          return f;
        }
      }
    } catch (MessagingException e) {
      // LIST 를 막은 서버 — 이름 후보로 계속 찾는다
    }
    for (String name : SENT_CANDIDATES) {
      Folder f = store.getFolder(name);
      if (f.exists()) {
        return f;
      }
    }
    return null;
  }
}
