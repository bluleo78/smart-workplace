package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_FOLDER;

import java.time.OffsetDateTime;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * email_folder jOOQ 리포지토리. v1 은 INBOX 한 폴더만 다루며, IMAP 증분 동기화 커서(UIDVALIDITY · last_seen_uid)를 보관한다.
 */
@Repository
@RequiredArgsConstructor
public class EmailFolderRepository {

  private final DSLContext dsl;

  /** 폴더의 동기화 상태(증분 커서). uidValidity 는 아직 동기화 전이면 null. */
  public record FolderSyncState(long id, Long uidValidity, long lastSeenUid) {}

  /**
   * 계정의 폴더를 보장(없으면 생성)하고 현재 동기화 상태를 반환. INBOX 등 표준 폴더를 동기화 직전에 가져오는 용도. (account_id, name) 유니크라 동시
   * 호출에도 ON CONFLICT DO NOTHING 으로 안전하다.
   */
  public FolderSyncState ensureFolder(long accountId, String name) {
    dsl.insertInto(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.ACCOUNT_ID, accountId)
        .set(EMAIL_FOLDER.NAME, name)
        .onConflictDoNothing()
        .execute();
    return dsl.select(EMAIL_FOLDER.ID, EMAIL_FOLDER.UID_VALIDITY, EMAIL_FOLDER.LAST_SEEN_UID)
        .from(EMAIL_FOLDER)
        .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_FOLDER.NAME.eq(name))
        .fetchOne(
            r ->
                new FolderSyncState(
                    r.get(EMAIL_FOLDER.ID),
                    r.get(EMAIL_FOLDER.UID_VALIDITY),
                    r.get(EMAIL_FOLDER.LAST_SEEN_UID)));
  }

  /** 동기화 커서 갱신(UIDVALIDITY · 마지막 동기화 UID · updated_at). */
  public void updateSyncState(long folderId, long uidValidity, long lastSeenUid) {
    dsl.update(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.UID_VALIDITY, uidValidity)
        .set(EMAIL_FOLDER.LAST_SEEN_UID, lastSeenUid)
        .set(EMAIL_FOLDER.UPDATED_AT, OffsetDateTime.now())
        .where(EMAIL_FOLDER.ID.eq(folderId))
        .execute();
  }
}
