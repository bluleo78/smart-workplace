package com.workplace.mail.service.folder;

/**
 * 서버 목록에서 저장 대상으로 고른 메일함 한 개(WP-960) — 공급자 중립 표현. 공급자별 목록기({@link MailFolderLister})가 만들고 {@link
 * MailFolderService} 가 email_folder 에 반영한다.
 *
 * @param key 계정 안 유니크 키(email_folder.name). IMAP 은 서버 전체 경로, Graph 는 폴더 id
 * @param remoteId 서버 식별자(IMAP 전체 경로 / Graph 폴더 id)
 * @param displayName 표시 이름(IMAP 마지막 경로 조각 / Graph displayName)
 * @param parentKey 보이는 부모 폴더의 key — 부모가 받은편지함·시스템 폴더거나 없으면 null(최상위)
 * @param role ARCHIVE 또는 USER
 * @param selectable 메일을 담을 수 있는지(IMAP \Noselect 면 false)
 * @param unread 서버 안 읽은 수 — 모르면 null(이전 값 유지)
 * @param total 서버 전체 메일 수 — 모르면 null(이전 값 유지)
 */
public record ServerFolder(
    String key,
    String remoteId,
    String displayName,
    String parentKey,
    FolderRole role,
    boolean selectable,
    Integer unread,
    Integer total) {

  /** 안 읽은 수·전체 수만 바꾼 사본(IMAP STATUS 결과 반영용). */
  public ServerFolder withCounts(Integer unread, Integer total) {
    return new ServerFolder(key, remoteId, displayName, parentKey, role, selectable, unread, total);
  }
}
