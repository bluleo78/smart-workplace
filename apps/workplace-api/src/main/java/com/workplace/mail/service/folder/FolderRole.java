package com.workplace.mail.service.folder;

/**
 * 저장·표시하는 서버 메일함 역할(WP-960). 받은편지함·보낸편지함·임시보관함·스팸 같은 시스템 폴더는 저장하지 않으므로 역할도 없다 — 사용자에게 보이는 것은
 * 「보관」·「휴지통」과 사용자가 직접 만든 메일함이다.
 */
public enum FolderRole {
  /** 서버의 「보관」 폴더(IMAP \Archive 또는 이름, Graph well-known archive). */
  ARCHIVE,
  /** 사용자가 직접 만든 메일함. */
  USER,
  /**
   * 서버의 휴지통(WP-1681) — 앱의 「삭제」가 옮기는 바로 그 폴더(IMAP {@link ImapFolderClassifier#findTrash}, Graph
   * well-known deleteditems). 계정당 하나이고 하위 폴더는 보이지 않는다. 화면 이름은 서버 이름과 무관하게 「휴지통」.
   */
  TRASH;

  /**
   * 저장된 역할 문자열(email_folder.role, null 가능)이 이 역할인지(WP-1681) — 곳곳의 {@code X.name().equals(role)} 비교를
   * 한 곳으로 모은다.
   */
  public boolean matches(String role) {
    return name().equals(role);
  }
}
