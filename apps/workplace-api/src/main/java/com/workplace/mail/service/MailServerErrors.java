package com.workplace.mail.service;

/**
 * 메일 서버 작업(옮기기·완전히 삭제) 결과에 담아 화면에 그대로 보이는 메일별 실패 문구(WP-1682). 옮기기({@code ImapMailMover}·{@code
 * GraphMailMover})와 완전 삭제({@code ImapMailEraser}·{@code GraphMailEraser})가 같은 상황에 같은 글자를 보이도록 한 곳에
 * 둔다 — 여러 곳에 따로 적으면 한쪽만 고쳐져 갈라진다. 구현들이 다른 패키지(service.move·service.trash)에 있어 공개로 둔다.
 */
public final class MailServerErrors {

  private MailServerErrors() {}

  /** 로컬 행이 가리키는 메일이 서버 메일함에 없다(또는 서버 위치를 모른다). */
  public static final String NOT_FOUND = "메일 서버에서 메일을 찾을 수 없습니다";

  /** 로컬에 기록된 메일함 UIDVALIDITY 가 없거나 서버와 달라 저장된 UID 를 믿을 수 없다. */
  public static final String MAILBOX_CHANGED = "메일함이 바뀌었습니다 — 동기화 후 다시 시도해 주세요";

  /** 서버에 지우기 명령(플래그·UID EXPUNGE)을 보냈지만 실패했다. */
  public static final String ERASE_FAILED = "메일 서버에서 지우지 못했습니다";

  /** 메일 서버 접속·로그인·LIST 가 실패했다(아무것도 바꾸지 않았다). */
  public static final String CONNECT_FAILED = "메일 서버에 연결하지 못했습니다";
}
