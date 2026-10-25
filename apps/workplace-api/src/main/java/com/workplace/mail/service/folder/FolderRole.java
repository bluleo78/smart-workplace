package com.workplace.mail.service.folder;

/**
 * 저장·표시하는 서버 메일함 역할(WP-960). 받은편지함·보낸편지함·임시보관함·휴지통·스팸 같은 시스템 폴더는 저장하지 않으므로 역할도 없다 — 사용자에게 보이는 것은
 * 「보관」과 사용자가 직접 만든 메일함 두 가지뿐이다.
 */
public enum FolderRole {
  /** 서버의 「보관」 폴더(IMAP \Archive 또는 이름, Graph well-known archive). */
  ARCHIVE,
  /** 사용자가 직접 만든 메일함. */
  USER
}
