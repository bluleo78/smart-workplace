package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * email_folder jOOQ 리포지토리. INBOX·SENT 동기화 커서(UIDVALIDITY · last_seen_uid · Graph deltaLink)를 보관하고,
 * WP-960 부터는 서버 메일함 목록에서 고른 보관(ARCHIVE)·사용자(USER) 폴더도 저장한다. 서버 폴더 행은 role 이 있고, 기존 INBOX·SENT 행은
 * role 이 NULL 이다 — 서버 폴더용 쓰기·삭제는 모두 role 이 있는 행으로 한정해 INBOX·SENT 를 건드리지 않는다.
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

  /**
   * Graph 증분 커서({@code @odata.deltaLink}) 조회. IMAP 폴더에는 null 이 저장되므로 empty 를 반환한다.
   *
   * @param folderId 대상 폴더 id
   * @return deltaLink Optional — 없으면 empty(첫 동기화 또는 IMAP 폴더)
   */
  public Optional<String> getDeltaLink(long folderId) {
    String link =
        dsl.select(EMAIL_FOLDER.DELTA_LINK)
            .from(EMAIL_FOLDER)
            .where(EMAIL_FOLDER.ID.eq(folderId))
            .fetchOne(EMAIL_FOLDER.DELTA_LINK);
    return Optional.ofNullable(link);
  }

  /**
   * Graph 증분 커서({@code @odata.deltaLink}) 저장. 동기화 마지막 페이지에서 수신한 deltaLink 를 보관해 다음 동기화 시 시작점으로
   * 사용한다.
   *
   * @param folderId 대상 폴더 id
   * @param deltaLink 저장할 deltaLink URL
   */
  public void setDeltaLink(long folderId, String deltaLink) {
    dsl.update(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.DELTA_LINK, deltaLink)
        .set(EMAIL_FOLDER.UPDATED_AT, OffsetDateTime.now())
        .where(EMAIL_FOLDER.ID.eq(folderId))
        .execute();
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

  /**
   * 저장된 서버 폴더(role 있는 행) 한 개(WP-960).
   *
   * @param name 계정 안 유니크 키(IMAP 전체 경로 / Graph 폴더 id)
   * @param parentId 보이는 부모 폴더 id(최상위면 null)
   */
  public record ServerFolderRow(
      long id,
      String name,
      String displayName,
      Long parentId,
      String role,
      boolean selectable,
      Integer serverUnread,
      Integer serverTotal,
      OffsetDateTime syncedSince,
      OffsetDateTime folderSyncedAt) {}

  /** 계정의 서버 폴더(ARCHIVE·USER) 목록. 보관 먼저, 그다음 표시 이름(대소문자 무시) 순 — 사이드바 표시 순서이자 목록 갱신 전후 비교의 기준. */
  public List<ServerFolderRow> listServerFolders(long accountId) {
    return dsl.select(
            EMAIL_FOLDER.ID,
            EMAIL_FOLDER.NAME,
            EMAIL_FOLDER.DISPLAY_NAME,
            EMAIL_FOLDER.PARENT_ID,
            EMAIL_FOLDER.ROLE,
            EMAIL_FOLDER.SELECTABLE,
            EMAIL_FOLDER.SERVER_UNREAD,
            EMAIL_FOLDER.SERVER_TOTAL,
            EMAIL_FOLDER.SYNCED_SINCE,
            EMAIL_FOLDER.FOLDER_SYNCED_AT)
        .from(EMAIL_FOLDER)
        .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_FOLDER.ROLE.isNotNull())
        .orderBy(
            DSL.when(EMAIL_FOLDER.ROLE.eq("ARCHIVE"), 0).otherwise(1),
            DSL.lower(EMAIL_FOLDER.DISPLAY_NAME),
            EMAIL_FOLDER.ID)
        .fetch(
            r ->
                new ServerFolderRow(
                    r.get(EMAIL_FOLDER.ID),
                    r.get(EMAIL_FOLDER.NAME),
                    r.get(EMAIL_FOLDER.DISPLAY_NAME),
                    r.get(EMAIL_FOLDER.PARENT_ID),
                    r.get(EMAIL_FOLDER.ROLE),
                    r.get(EMAIL_FOLDER.SELECTABLE),
                    r.get(EMAIL_FOLDER.SERVER_UNREAD),
                    r.get(EMAIL_FOLDER.SERVER_TOTAL),
                    r.get(EMAIL_FOLDER.SYNCED_SINCE),
                    r.get(EMAIL_FOLDER.FOLDER_SYNCED_AT)));
  }

  /**
   * 서버 폴더 한 개를 넣거나 갱신하고 행 id 를 돌려준다(WP-960). (account_id, name) 이 이미 있으면 표시·역할·개수·listed_at 을 갱신한다.
   * 개수가 null(서버에서 못 받음)이면 이전 값을 유지한다. 같은 이름의 role 없는 행(INBOX·SENT)과 겹치면 갱신하지 않고 empty — 기존 행을 서버
   * 폴더로 바꾸지 않는다. 동기화 커서·synced_since·parent_id 는 건드리지 않는다.
   */
  public Optional<Long> upsertServerFolder(
      long accountId,
      String name,
      String remoteId,
      String displayName,
      String role,
      boolean selectable,
      Integer serverUnread,
      Integer serverTotal,
      OffsetDateTime listedAt) {
    return dsl.insertInto(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.ACCOUNT_ID, accountId)
        .set(EMAIL_FOLDER.NAME, name)
        .set(EMAIL_FOLDER.REMOTE_ID, remoteId)
        .set(EMAIL_FOLDER.DISPLAY_NAME, displayName)
        .set(EMAIL_FOLDER.ROLE, role)
        .set(EMAIL_FOLDER.SELECTABLE, selectable)
        .set(EMAIL_FOLDER.SERVER_UNREAD, serverUnread)
        .set(EMAIL_FOLDER.SERVER_TOTAL, serverTotal)
        .set(EMAIL_FOLDER.LISTED_AT, listedAt)
        .onConflict(EMAIL_FOLDER.ACCOUNT_ID, EMAIL_FOLDER.NAME)
        .doUpdate()
        .set(EMAIL_FOLDER.REMOTE_ID, DSL.excluded(EMAIL_FOLDER.REMOTE_ID))
        .set(EMAIL_FOLDER.DISPLAY_NAME, DSL.excluded(EMAIL_FOLDER.DISPLAY_NAME))
        .set(EMAIL_FOLDER.ROLE, DSL.excluded(EMAIL_FOLDER.ROLE))
        .set(EMAIL_FOLDER.SELECTABLE, DSL.excluded(EMAIL_FOLDER.SELECTABLE))
        .set(
            EMAIL_FOLDER.SERVER_UNREAD,
            DSL.coalesce(DSL.excluded(EMAIL_FOLDER.SERVER_UNREAD), EMAIL_FOLDER.SERVER_UNREAD))
        .set(
            EMAIL_FOLDER.SERVER_TOTAL,
            DSL.coalesce(DSL.excluded(EMAIL_FOLDER.SERVER_TOTAL), EMAIL_FOLDER.SERVER_TOTAL))
        .set(EMAIL_FOLDER.LISTED_AT, DSL.excluded(EMAIL_FOLDER.LISTED_AT))
        .where(EMAIL_FOLDER.ROLE.isNotNull())
        .returningResult(EMAIL_FOLDER.ID)
        .fetchOptional()
        .map(r -> r.value1());
  }

  /** 서버 폴더의 보이는 부모를 바꾼다(WP-960). 서버 폴더(role 있는 행)만 대상이다. */
  public void setParent(long folderId, Long parentId) {
    dsl.update(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.PARENT_ID, parentId)
        .where(EMAIL_FOLDER.ID.eq(folderId))
        .and(EMAIL_FOLDER.ROLE.isNotNull())
        .and(EMAIL_FOLDER.PARENT_ID.isDistinctFrom(parentId))
        .execute();
  }

  /** 계정 INBOX 행에 서버 식별자를 기록한다(WP-960). 행이 없으면 만들지 않는다. 값이 같으면 쓰지 않는다. */
  public void setInboxRemoteId(long accountId, String remoteId) {
    dsl.update(EMAIL_FOLDER)
        .set(EMAIL_FOLDER.REMOTE_ID, remoteId)
        .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_FOLDER.NAME.eq("INBOX"))
        .and(EMAIL_FOLDER.REMOTE_ID.isDistinctFrom(remoteId))
        .execute();
  }

  /**
   * 서버 폴더 행들을 지운다(WP-960 — 서버에서 사라진 폴더). role 있는 행만 지워 INBOX·SENT 는 절대 대상이 아니다. 메일은 호출자가 먼저 {@link
   * EmailMessageRepository#deleteByFolder} 로 지운다(본문 GC 포함).
   */
  public int deleteServerFolders(long accountId, Collection<Long> folderIds) {
    if (folderIds.isEmpty()) {
      return 0;
    }
    return dsl.deleteFrom(EMAIL_FOLDER)
        .where(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_FOLDER.ID.in(folderIds))
        .and(EMAIL_FOLDER.ROLE.isNotNull())
        .execute();
  }

  /**
   * 메일함별 동기화 대상(WP-960 Pass B) — 폴더 정체(이름·서버 식별자·역할)와 동기화 커서·경계.
   *
   * @param name email_folder.name — IMAP 은 서버 전체 경로(폴더를 여는 이름), Graph 는 폴더 id
   * @param remoteId 서버 식별자(Graph 폴더 id / IMAP 전체 경로)
   * @param role ARCHIVE·USER, 기존 INBOX·SENT 행이면 null
   * @param uidValidity IMAP UIDVALIDITY — 아직 가져오지 않았으면 null
   * @param lastSeenUid IMAP 증분 커서
   * @param syncedSince 가져온 가장 오래된 수신일 경계(아직 안 가져왔으면 null)
   * @param folderSyncedAt 마지막으로 가져온 시각
   */
  public record FolderTarget(
      long id,
      String name,
      String remoteId,
      String role,
      boolean selectable,
      Long uidValidity,
      long lastSeenUid,
      OffsetDateTime syncedSince,
      OffsetDateTime folderSyncedAt) {

    /** IMAP 증분 동기화 커서 부분만(기존 INBOX 경로와 같은 표현). */
    public FolderSyncState syncState() {
      return new FolderSyncState(id, uidValidity, lastSeenUid);
    }
  }

  /** 계정의 폴더 한 개를 동기화 대상으로 읽는다(WP-960). 다른 계정의 폴더면 empty. */
  public Optional<FolderTarget> findTarget(long accountId, long folderId) {
    return selectTarget(EMAIL_FOLDER.ID.eq(folderId).and(EMAIL_FOLDER.ACCOUNT_ID.eq(accountId)));
  }

  /**
   * 계정의 보관 메일함(WP-962 — 「보관」으로 옮길 곳). 서버는 계정당 하나를 주지만 둘 이상이면 id 가 작은 것 — 사이드바(목록 첫 ARCHIVE)와 같은
   * 메일함이 되도록 목록 순서(보관 먼저 → 이름순 → id)를 따른다.
   */
  public Optional<FolderTarget> findArchive(long accountId) {
    return listServerFolders(accountId).stream()
        .filter(r -> "ARCHIVE".equals(r.role()))
        .findFirst()
        .flatMap(r -> findTarget(accountId, r.id()));
  }

  private Optional<FolderTarget> selectTarget(org.jooq.Condition where) {
    return dsl.select(
            EMAIL_FOLDER.ID,
            EMAIL_FOLDER.NAME,
            EMAIL_FOLDER.REMOTE_ID,
            EMAIL_FOLDER.ROLE,
            EMAIL_FOLDER.SELECTABLE,
            EMAIL_FOLDER.UID_VALIDITY,
            EMAIL_FOLDER.LAST_SEEN_UID,
            EMAIL_FOLDER.SYNCED_SINCE,
            EMAIL_FOLDER.FOLDER_SYNCED_AT)
        .from(EMAIL_FOLDER)
        .where(where)
        .fetchOptional(
            r ->
                new FolderTarget(
                    r.get(EMAIL_FOLDER.ID),
                    r.get(EMAIL_FOLDER.NAME),
                    r.get(EMAIL_FOLDER.REMOTE_ID),
                    r.get(EMAIL_FOLDER.ROLE),
                    r.get(EMAIL_FOLDER.SELECTABLE),
                    r.get(EMAIL_FOLDER.UID_VALIDITY),
                    r.get(EMAIL_FOLDER.LAST_SEEN_UID),
                    r.get(EMAIL_FOLDER.SYNCED_SINCE),
                    r.get(EMAIL_FOLDER.FOLDER_SYNCED_AT)));
  }

  /**
   * 메일함을 가져온 기록(WP-960) — folder_synced_at 을 갱신하고, syncedSince 가 있으면 가져온 가장 오래된 경계도 바꾼다(첫 동기화·이전 메일
   * 더 가져오기). null 이면 경계는 그대로(증분 동기화).
   */
  public void markFolderSynced(long folderId, OffsetDateTime syncedSince, OffsetDateTime syncedAt) {
    var update = dsl.update(EMAIL_FOLDER).set(EMAIL_FOLDER.FOLDER_SYNCED_AT, syncedAt);
    if (syncedSince != null) {
      update = update.set(EMAIL_FOLDER.SYNCED_SINCE, syncedSince);
    }
    update.where(EMAIL_FOLDER.ID.eq(folderId)).execute();
  }

  /**
   * 앱에서 읽음/안읽음을 바꾼 메일의 서버 폴더 안 읽은 수를 맞춘다(WP-960) — 다음 목록 갱신 전까지 사이드바 배지가 맞도록. 서버 폴더(role 있는 행)만,
   * 개수를 아는(NULL 아님) 행만 바꾸며 0 아래로 내려가지 않는다. INBOX·SENT 메일은 대상이 아니다.
   *
   * @param messageIds 이번에 실제로 읽음 상태가 바뀐 메일
   * @param delta 메일 한 통당 증감(읽음 처리 -1, 안읽음 처리 +1)
   */
  public void adjustServerUnread(Collection<Long> messageIds, int delta) {
    if (messageIds.isEmpty()) {
      return;
    }
    var counts =
        dsl.select(EMAIL_MESSAGE.FOLDER_ID, DSL.count())
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.in(messageIds))
            .groupBy(EMAIL_MESSAGE.FOLDER_ID)
            .fetch();
    for (var c : counts) {
      int change = delta * c.value2();
      dsl.update(EMAIL_FOLDER)
          .set(
              EMAIL_FOLDER.SERVER_UNREAD,
              DSL.greatest(EMAIL_FOLDER.SERVER_UNREAD.plus(change), DSL.inline(0)))
          .where(EMAIL_FOLDER.ID.eq(c.value1()))
          .and(EMAIL_FOLDER.ROLE.isNotNull())
          .and(EMAIL_FOLDER.SERVER_UNREAD.isNotNull())
          .execute();
    }
  }
}
