package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK;
import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK_VISIT;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;

import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 「공유받은 항목」 기록(drive_share_link_visit, WP-1539) 접근. 로그인한 같은 워크스페이스 사람이 사내 공유 링크를 연 기록을 남기고, 내 목록을
 * 읽고, 내 목록에서만 숨긴다. 모든 메서드는 링크 워크스페이스 RLS 컨텍스트·트랜잭션 안에서 부른다(FORCE RLS).
 */
@Repository
@RequiredArgsConstructor
public class DriveShareLinkVisitRepository {
  private final DSLContext dsl;

  /** 링크를 만든 사람 — 공간 주인(개인 공간 이름 표시용)과 구분하려고 별칭을 쓴다. */
  private static final com.workplace.jooq.tables.User CREATOR = USER.as("dslv_creator");

  /** 공간 주인 — 남의 개인 공간은 저장된 이름이 「내 드라이브」라 주인 이름으로 바꿔 보인다. */
  private static final com.workplace.jooq.tables.User SPACE_OWNER = USER.as("dslv_owner");

  /**
   * 열었음을 기록한다(upsert). 처음이면 행을 만들고, 이미 있으면 마지막으로 연 시각을 갱신하고 「목록에서 빼기」를 되돌린다(다시 열면 목록에 돌아온다는 제품 규칙).
   * 시각은 DB 시계(now()) — 다른 링크 시각 칸과 같은 시계를 쓴다. 토큰 암호문은 매번 새로 덮는다(가장 최근에 연 토큰).
   */
  public void recordOpen(long userId, long shareLinkId, String tokenEncrypted) {
    dsl.insertInto(DRIVE_SHARE_LINK_VISIT)
        .set(DRIVE_SHARE_LINK_VISIT.USER_ID, userId)
        .set(DRIVE_SHARE_LINK_VISIT.SHARE_LINK_ID, shareLinkId)
        .set(DRIVE_SHARE_LINK_VISIT.TOKEN_ENCRYPTED, tokenEncrypted)
        .onConflict(DRIVE_SHARE_LINK_VISIT.USER_ID, DRIVE_SHARE_LINK_VISIT.SHARE_LINK_ID)
        .doUpdate()
        .set(DRIVE_SHARE_LINK_VISIT.LAST_OPENED_AT, DSL.currentOffsetDateTime())
        .setNull(DRIVE_SHARE_LINK_VISIT.HIDDEN_AT)
        .set(DRIVE_SHARE_LINK_VISIT.TOKEN_ENCRYPTED, tokenEncrypted)
        .execute();
  }

  /** 「목록에서 빼기」 — 내 행만 숨긴다. 링크 권한은 그대로다. 영향 행 수(0 = 내 행 없음·이미 숨김). */
  public int hide(long userId, long shareLinkId) {
    return dsl.update(DRIVE_SHARE_LINK_VISIT)
        .set(DRIVE_SHARE_LINK_VISIT.HIDDEN_AT, DSL.currentOffsetDateTime())
        .where(DRIVE_SHARE_LINK_VISIT.USER_ID.eq(userId))
        .and(DRIVE_SHARE_LINK_VISIT.SHARE_LINK_ID.eq(shareLinkId))
        .and(DRIVE_SHARE_LINK_VISIT.HIDDEN_AT.isNull())
        .execute();
  }

  /**
   * 내 목록 한 줄 — 화면 칸과, 서비스가 토큰을 되살리는 데 쓰는 암호문·해시. openable 은 DB 시계로 판정한 「링크가 살아 있고 파일이 휴지통에 없음」.
   * spaceType·spaceOwnerName 은 개인 공간 이름 표시용.
   */
  public record VisitRow(
      long shareLinkId,
      String fileName,
      String mimeType,
      long sizeBytes,
      String spaceType,
      String spaceName,
      String spaceOwnerName,
      String sharedByName,
      OffsetDateTime lastOpenedAt,
      boolean openable,
      boolean hasPassword,
      String visitTokenEncrypted,
      String linkTokenEncrypted,
      String tokenHash) {}

  /** 목록 상한 — 최근에 연 것부터 이만큼만 돌려준다(사이드바가 드라이브를 열 때마다 받으므로 크기를 묶는다). */
  public static final int LIST_LIMIT = 200;

  /**
   * 내 공유받은 항목(숨기지 않은 것, 마지막으로 연 순, 최근 {@link #LIST_LIMIT}개). 지금 그 공간의 실효 역할(부서 역할 포함)이 있으면 뺀다 — 기록
   * 뒤 구성원이 되면 그 공간에서 바로 보이니 목록에서 사라진다(읽을 때마다 판정). 다른 워크스페이스 행은 RLS 가 막는다.
   *
   * <p>파일은 inner join — 영구 삭제된 파일은 링크와 기록이 CASCADE 로 함께 지워진다. 휴지통 파일은 행을 남기고 열 수 없음으로 표시한다.
   */
  public List<VisitRow> listForUser(long userId) {
    Field<Boolean> openable =
        DSL.field(DriveShareLinkRepository.ACTIVE_CONDITION.and(DRIVE_FILE.TRASHED_AT.isNull()))
            .as("openable");
    return dsl.select(
            DRIVE_SHARE_LINK_VISIT.SHARE_LINK_ID,
            DRIVE_FILE.NAME,
            FILE.MIME_TYPE,
            FILE.SIZE_BYTES,
            DRIVE_SPACE.TYPE,
            DRIVE_SPACE.NAME,
            SPACE_OWNER.NAME,
            CREATOR.NAME,
            DRIVE_SHARE_LINK_VISIT.LAST_OPENED_AT,
            openable,
            DRIVE_SHARE_LINK.PASSWORD_HASH,
            DRIVE_SHARE_LINK_VISIT.TOKEN_ENCRYPTED,
            DRIVE_SHARE_LINK.TOKEN_ENCRYPTED,
            DRIVE_SHARE_LINK.TOKEN_HASH)
        .from(DRIVE_SHARE_LINK_VISIT)
        .join(DRIVE_SHARE_LINK)
        .on(DRIVE_SHARE_LINK.ID.eq(DRIVE_SHARE_LINK_VISIT.SHARE_LINK_ID))
        .join(DRIVE_FILE)
        .on(DRIVE_FILE.ID.eq(DRIVE_SHARE_LINK.DRIVE_FILE_ID))
        .join(FILE)
        .on(FILE.ID.eq(DRIVE_FILE.FILE_ID))
        .join(DRIVE_SPACE)
        .on(DRIVE_SPACE.ID.eq(DRIVE_SHARE_LINK.SPACE_ID))
        .leftJoin(SPACE_OWNER)
        .on(SPACE_OWNER.ID.eq(DRIVE_SPACE.OWNER_ID))
        .leftJoin(CREATOR)
        .on(CREATOR.ID.eq(DRIVE_SHARE_LINK.CREATED_BY))
        .where(DRIVE_SHARE_LINK_VISIT.USER_ID.eq(userId))
        .and(DRIVE_SHARE_LINK_VISIT.HIDDEN_AT.isNull())
        // 사내 링크만 목록에 둔다 — 기록 시점에 이미 걸렀지만, 읽을 때도 지켜 규칙이 한 곳에서 새지 않게 한다.
        .and(DRIVE_SHARE_LINK.AUDIENCE.eq("INTERNAL"))
        .and(
            DriveSpaceMembership.effectiveRole(DRIVE_SHARE_LINK.SPACE_ID, DSL.val(userId)).isNull())
        .orderBy(
            DRIVE_SHARE_LINK_VISIT.LAST_OPENED_AT.desc(),
            DRIVE_SHARE_LINK_VISIT.SHARE_LINK_ID.desc())
        .limit(LIST_LIMIT)
        .fetch(
            r ->
                new VisitRow(
                    r.get(DRIVE_SHARE_LINK_VISIT.SHARE_LINK_ID),
                    r.get(DRIVE_FILE.NAME),
                    r.get(FILE.MIME_TYPE),
                    r.get(FILE.SIZE_BYTES),
                    r.get(DRIVE_SPACE.TYPE),
                    r.get(DRIVE_SPACE.NAME),
                    r.get(SPACE_OWNER.NAME),
                    r.get(CREATOR.NAME),
                    r.get(DRIVE_SHARE_LINK_VISIT.LAST_OPENED_AT),
                    Boolean.TRUE.equals(r.get(openable)),
                    r.get(DRIVE_SHARE_LINK.PASSWORD_HASH) != null,
                    r.get(DRIVE_SHARE_LINK_VISIT.TOKEN_ENCRYPTED),
                    r.get(DRIVE_SHARE_LINK.TOKEN_ENCRYPTED),
                    r.get(DRIVE_SHARE_LINK.TOKEN_HASH)));
  }
}
