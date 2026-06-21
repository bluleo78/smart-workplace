package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK;

import com.workplace.drive.dto.ShareLinkResponse;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** drive_share_link 접근. 관리는 RLS 컨텍스트, 공개 resolve 는 SECURITY DEFINER 함수. */
@Repository
@RequiredArgsConstructor
public class DriveShareLinkRepository {
  private final DSLContext dsl;

  public long insert(
      long driveFileId,
      long spaceId,
      String tokenHash,
      String audience,
      String passwordHash,
      OffsetDateTime expiresAt,
      long createdBy) {
    return dsl.insertInto(DRIVE_SHARE_LINK)
        .set(DRIVE_SHARE_LINK.DRIVE_FILE_ID, driveFileId)
        .set(DRIVE_SHARE_LINK.SPACE_ID, spaceId)
        .set(DRIVE_SHARE_LINK.TOKEN_HASH, tokenHash)
        .set(DRIVE_SHARE_LINK.AUDIENCE, audience)
        .set(DRIVE_SHARE_LINK.PASSWORD_HASH, passwordHash)
        .set(DRIVE_SHARE_LINK.EXPIRES_AT, expiresAt)
        .set(DRIVE_SHARE_LINK.CREATED_BY, createdBy)
        .returning(DRIVE_SHARE_LINK.ID)
        .fetchOne()
        .getId();
  }

  /** 한 파일의 활성+폐기 링크 목록(최신순). 토큰 미포함. */
  public List<ShareLinkResponse> listByFile(long driveFileId) {
    return dsl.select(
            DRIVE_SHARE_LINK.ID,
            DRIVE_SHARE_LINK.AUDIENCE,
            DRIVE_SHARE_LINK.PASSWORD_HASH,
            DRIVE_SHARE_LINK.EXPIRES_AT,
            DRIVE_SHARE_LINK.REVOKED_AT,
            DRIVE_SHARE_LINK.CREATED_AT,
            DRIVE_SHARE_LINK.CREATED_BY)
        .from(DRIVE_SHARE_LINK)
        .where(DRIVE_SHARE_LINK.DRIVE_FILE_ID.eq(driveFileId))
        .orderBy(DRIVE_SHARE_LINK.CREATED_AT.desc())
        .fetch(
            r ->
                new ShareLinkResponse(
                    r.get(DRIVE_SHARE_LINK.ID),
                    r.get(DRIVE_SHARE_LINK.AUDIENCE),
                    r.get(DRIVE_SHARE_LINK.PASSWORD_HASH) != null,
                    r.get(DRIVE_SHARE_LINK.EXPIRES_AT),
                    r.get(DRIVE_SHARE_LINK.REVOKED_AT) != null,
                    r.get(DRIVE_SHARE_LINK.CREATED_AT),
                    r.get(DRIVE_SHARE_LINK.CREATED_BY)));
  }

  /** 폐기 권한 검증용 — 활성(미폐기) 링크의 space_id. */
  public Optional<Long> findSpaceIdOfActive(long linkId) {
    return dsl.select(DRIVE_SHARE_LINK.SPACE_ID)
        .from(DRIVE_SHARE_LINK)
        .where(DRIVE_SHARE_LINK.ID.eq(linkId))
        .and(DRIVE_SHARE_LINK.REVOKED_AT.isNull())
        .fetchOptional(DRIVE_SHARE_LINK.SPACE_ID);
  }

  /** 폐기(soft). 영향 행 수 반환(0=대상없음/이미폐기 → 멱등). */
  public int revoke(long linkId) {
    return dsl.update(DRIVE_SHARE_LINK)
        .set(DRIVE_SHARE_LINK.REVOKED_AT, OffsetDateTime.now())
        .where(DRIVE_SHARE_LINK.ID.eq(linkId))
        .and(DRIVE_SHARE_LINK.REVOKED_AT.isNull())
        .execute();
  }

  /** 공개 resolve — SECURITY DEFINER 함수 호출(컨텍스트/ RLS 무관). */
  public Optional<ResolvedLink> resolve(String tokenHash) {
    var r =
        dsl.resultQuery(
                "SELECT tenant_id, drive_file_id, password_hash, audience, expires_at, revoked_at"
                    + " FROM drive_share_link_resolve(?)",
                tokenHash)
            .fetchOne();
    return r == null
        ? Optional.empty()
        : Optional.of(
            new ResolvedLink(
                r.get("tenant_id", Long.class),
                r.get("drive_file_id", Long.class),
                r.get("password_hash", String.class),
                r.get("audience", String.class),
                r.get("expires_at", OffsetDateTime.class),
                r.get("revoked_at", OffsetDateTime.class)));
  }

  /** 공개 resolve 결과(RLS 우회로 읽은 최소 필드). */
  public record ResolvedLink(
      long tenantId,
      long driveFileId,
      String passwordHash,
      String audience,
      OffsetDateTime expiresAt,
      OffsetDateTime revokedAt) {}
}
