package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_SHARE_LINK;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.SelectConditionStep;
import org.jooq.impl.DSL;
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
      String tokenEncrypted,
      String audience,
      String passwordHash,
      OffsetDateTime expiresAt,
      long createdBy) {
    return dsl.insertInto(DRIVE_SHARE_LINK)
        .set(DRIVE_SHARE_LINK.DRIVE_FILE_ID, driveFileId)
        .set(DRIVE_SHARE_LINK.SPACE_ID, spaceId)
        .set(DRIVE_SHARE_LINK.TOKEN_HASH, tokenHash)
        .set(DRIVE_SHARE_LINK.TOKEN_ENCRYPTED, tokenEncrypted)
        .set(DRIVE_SHARE_LINK.AUDIENCE, audience)
        .set(DRIVE_SHARE_LINK.PASSWORD_HASH, passwordHash)
        .set(DRIVE_SHARE_LINK.EXPIRES_AT, expiresAt)
        .set(DRIVE_SHARE_LINK.CREATED_BY, createdBy)
        .returning(DRIVE_SHARE_LINK.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 링크 한 줄(관리 화면용) — 응답에 필요한 칸과, 서비스가 토큰을 되살리고 검증하는 데 쓰는 암호문·해시를 납작하게 담는다. tokenEncrypted 는 AES-GCM
   * 암호문(WP-1528 이전 링크는 null) — 복호화·응답 조립은 서비스가 한다. active 는 DB 시계(now())로 판정한 「지금 쓸 수 있음」.
   */
  public record ShareLinkRow(
      long id,
      String audience,
      boolean hasPassword,
      OffsetDateTime expiresAt,
      boolean revoked,
      boolean active,
      OffsetDateTime createdAt,
      long createdBy,
      String createdByName,
      String tokenEncrypted,
      String tokenHash) {}

  /**
   * 한 파일의 활성+폐기 링크 목록(최신순, 같은 시각이면 id 내림차순 — 한 트랜잭션에서 만든 링크도 순서가 흔들리지 않게). 만든 사람 이름(USER left join,
   * 삭제돼 없으면 null)과 토큰 암호문·해시를 포함한다.
   */
  public List<ShareLinkRow> listByFile(long driveFileId) {
    return selectRows(DRIVE_SHARE_LINK.DRIVE_FILE_ID.eq(driveFileId))
        .orderBy(DRIVE_SHARE_LINK.CREATED_AT.desc(), DRIVE_SHARE_LINK.ID.desc())
        .fetch(DriveShareLinkRepository::toRow);
  }

  /** 링크 한 줄 — 생성 직후 목록과 같은 모양으로 돌려주려고 쓴다(WP-1528). */
  public Optional<ShareLinkRow> findRow(long linkId) {
    return selectRows(DRIVE_SHARE_LINK.ID.eq(linkId))
        .fetchOptional(DriveShareLinkRepository::toRow);
  }

  /** 「지금 쓸 수 있음」 — 폐기되지 않았고 만료 전. DB 시계(now())로 판정해 클라이언트 시계와 무관한 서버 기준이 된다. */
  private static final Field<Boolean> ACTIVE =
      DSL.field(
          DRIVE_SHARE_LINK
              .REVOKED_AT
              .isNull()
              .and(
                  DRIVE_SHARE_LINK
                      .EXPIRES_AT
                      .isNull()
                      .or(DRIVE_SHARE_LINK.EXPIRES_AT.gt(DSL.currentOffsetDateTime()))));

  /** 목록·한 줄 조회가 함께 쓰는 SELECT — 만든 사람 이름은 USER left join. */
  private SelectConditionStep<? extends Record> selectRows(Condition where) {
    return dsl.select(
            DRIVE_SHARE_LINK.ID,
            DRIVE_SHARE_LINK.AUDIENCE,
            DRIVE_SHARE_LINK.PASSWORD_HASH,
            DRIVE_SHARE_LINK.EXPIRES_AT,
            DRIVE_SHARE_LINK.REVOKED_AT,
            ACTIVE,
            DRIVE_SHARE_LINK.CREATED_AT,
            DRIVE_SHARE_LINK.CREATED_BY,
            USER.NAME,
            DRIVE_SHARE_LINK.TOKEN_ENCRYPTED,
            DRIVE_SHARE_LINK.TOKEN_HASH)
        .from(DRIVE_SHARE_LINK)
        .leftJoin(USER)
        .on(USER.ID.eq(DRIVE_SHARE_LINK.CREATED_BY))
        .where(where);
  }

  /** SELECT 한 줄 → ShareLinkRow. 비밀번호 해시는 「있음」 여부로만 옮긴다. */
  private static ShareLinkRow toRow(Record r) {
    return new ShareLinkRow(
        r.get(DRIVE_SHARE_LINK.ID),
        r.get(DRIVE_SHARE_LINK.AUDIENCE),
        r.get(DRIVE_SHARE_LINK.PASSWORD_HASH) != null,
        r.get(DRIVE_SHARE_LINK.EXPIRES_AT),
        r.get(DRIVE_SHARE_LINK.REVOKED_AT) != null,
        Boolean.TRUE.equals(r.get(ACTIVE)),
        r.get(DRIVE_SHARE_LINK.CREATED_AT),
        r.get(DRIVE_SHARE_LINK.CREATED_BY),
        r.get(USER.NAME),
        r.get(DRIVE_SHARE_LINK.TOKEN_ENCRYPTED),
        r.get(DRIVE_SHARE_LINK.TOKEN_HASH));
  }

  /** 폐기 권한 검증용 — 활성(미폐기) 링크의 space_id. */
  public Optional<Long> findSpaceIdOfActive(long linkId) {
    return dsl.select(DRIVE_SHARE_LINK.SPACE_ID)
        .from(DRIVE_SHARE_LINK)
        .where(DRIVE_SHARE_LINK.ID.eq(linkId))
        .and(DRIVE_SHARE_LINK.REVOKED_AT.isNull())
        .fetchOptional(DRIVE_SHARE_LINK.SPACE_ID);
  }

  /**
   * 폐기(soft). 영향 행 수 반환(0=대상없음/이미폐기 → 멱등). 폐기 시각은 DB 시계(now())로 찍는다 — 목록의 active 판정과 같은 시계를 써서 앱
   * 서버·DB 시계 차이로 판정이 어긋나지 않게 한다.
   */
  public int revoke(long linkId) {
    return dsl.update(DRIVE_SHARE_LINK)
        .set(DRIVE_SHARE_LINK.REVOKED_AT, DSL.currentOffsetDateTime())
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

  /**
   * 링크를 만든 사람 이름(WP-1227 — 공유 화면의 「공유한 사람」). RLS 컨텍스트(링크 워크스페이스)·트랜잭션 안에서 부른다. resolve 함수는 바꾸지
   * 않고(마이그레이션 없이) 테넌트 범위 조회로 읽는다.
   */
  public Optional<String> findCreatorName(String tokenHash) {
    return dsl.select(USER.NAME)
        .from(DRIVE_SHARE_LINK)
        .join(USER)
        .on(USER.ID.eq(DRIVE_SHARE_LINK.CREATED_BY))
        .where(DRIVE_SHARE_LINK.TOKEN_HASH.eq(tokenHash))
        .fetchOptional(USER.NAME);
  }

  /** 공유 화면에 보일 파일 형식·크기(WP-1227). core file id 기준, RLS 컨텍스트·트랜잭션 안에서 부른다. */
  public Optional<FileMeta> findFileMeta(long coreFileId) {
    return dsl.select(FILE.MIME_TYPE, FILE.SIZE_BYTES)
        .from(FILE)
        .where(FILE.ID.eq(coreFileId))
        .fetchOptional(r -> new FileMeta(r.get(FILE.MIME_TYPE), r.get(FILE.SIZE_BYTES)));
  }

  /** 공유 정보용 파일 형식·크기. */
  public record FileMeta(String mimeType, long sizeBytes) {}

  /** 공개 resolve 결과(RLS 우회로 읽은 최소 필드). */
  public record ResolvedLink(
      long tenantId,
      long driveFileId,
      String passwordHash,
      String audience,
      OffsetDateTime expiresAt,
      OffsetDateTime revokedAt) {}
}
