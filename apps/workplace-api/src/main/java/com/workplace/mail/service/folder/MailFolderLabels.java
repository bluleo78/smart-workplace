package com.workplace.mail.service.folder;

import com.workplace.mail.repository.EmailFolderRepository;

/**
 * 메일함 화면 표시 이름 규칙(WP-1742 — 통합 검색 WP-1359 의 규칙을 옮겨 한 곳에 둔다). 여러 메일함의 메일을 한 목록에 섞는 화면(통합 검색·별표 모아
 * 보기)이 메일마다 「원래 메일함」을 같은 이름으로 보이게 한다.
 */
public final class MailFolderLabels {

  /** 받은편지함 표시 이름. */
  public static final String INBOX_LABEL = "받은편지함";

  /** 보낸편지함(앱 발송 기록·서버 보낸편지함) 표시 이름. */
  public static final String SENT_LABEL = "보낸편지함";

  /** 보관 메일함 이름 — 웹 메일 사이드바(lib/mailFolders.ts ARCHIVE_LABEL)와 같다. */
  public static final String ARCHIVE_LABEL = "보관";

  /** 휴지통 이름 — 서버 이름과 무관하게 「휴지통」(FolderRole.TRASH). */
  public static final String TRASH_LABEL = "휴지통";

  private MailFolderLabels() {}

  /** 서버 보낸편지함이거나 앱 발송 기록(SENT) 메일함인지 — 보낸편지함을 먼저 본다(서버 보낸편지함이 기타로 새지 않게). */
  public static boolean isSent(String name, boolean serverSent) {
    return serverSent || EmailFolderRepository.LOCAL_SENT.equals(name);
  }

  /** 받은편지함 행인지 — 역할 없는 INBOX 행(서버 보낸편지함 아님). */
  public static boolean isInbox(String name, String role, boolean serverSent) {
    return !serverSent && role == null && "INBOX".equals(name);
  }

  /** 받은편지함 역할 값(WP-1742) — email_folder.role 에는 없고(null) 목록 행 folderRole 에만 쓰는 판정 값. */
  public static final String INBOX_ROLE = "INBOX";

  /** 보낸편지함 역할 값(WP-1742) — 앱 발송 기록·서버 보낸편지함 모두. email_folder.role 에는 없다. */
  public static final String SENT_ROLE = "SENT";

  /**
   * 목록 행의 메일함 역할(WP-1742) — 화면이 표시 이름 대신 이 값으로 「지금 메일함」을 판정한다. 받은·보낸편지함은 email_folder.role 이 비어 있어
   * {@link #INBOX_ROLE}·{@link #SENT_ROLE} 로 채우고, 그 밖은 저장된 역할(ARCHIVE·USER·TRASH) 그대로. 판정 순서는
   * {@link #label} 과 같다.
   */
  public static String role(String name, String role, boolean serverSent) {
    if (isSent(name, serverSent)) {
      return SENT_ROLE;
    }
    if (isInbox(name, role, serverSent)) {
      return INBOX_ROLE;
    }
    return role;
  }

  /**
   * 메일함 표시 이름 — 받은·보낸편지함은 고정 이름, 보관은 「보관」(서버 이름이 Archive 여도), 휴지통은 「휴지통」, 그 밖은 표시 이름(없으면 서버 이름).
   *
   * @param name email_folder.name(IMAP 전체 경로 / Graph 폴더 id / INBOX·SENT)
   * @param displayName email_folder.display_name(null 가능)
   * @param role email_folder.role(ARCHIVE·USER·TRASH, 받은·보낸편지함은 null)
   * @param serverSent 서버 보낸편지함을 동기화한 메일함인지
   */
  public static String label(String name, String displayName, String role, boolean serverSent) {
    if (isSent(name, serverSent)) {
      return SENT_LABEL;
    }
    if (isInbox(name, role, serverSent)) {
      return INBOX_LABEL;
    }
    if (FolderRole.ARCHIVE.matches(role)) {
      return ARCHIVE_LABEL;
    }
    if (FolderRole.TRASH.matches(role)) {
      return TRASH_LABEL;
    }
    return displayName == null || displayName.isBlank() ? name : displayName;
  }
}
