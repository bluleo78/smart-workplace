package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_TRANSFER_LINK;

import java.time.OffsetDateTime;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * drive_transfer_link 접근(WP-369). 발급·정리는 RLS 컨텍스트(인증 요청 트랜잭션) 안에서, 공개 경로의 조회·소비는 테넌트 컨텍스트가 없으므로
 * SECURITY DEFINER 함수({@code drive_transfer_link_resolve}·{@code drive_transfer_link_consume})로 한다.
 */
@Repository
@RequiredArgsConstructor
public class DriveTransferLinkRepository {
  /** 두 SECURITY DEFINER 함수가 같은 열 순서로 돌려준다. */
  private static final String COLUMNS =
      "id, tenant_id, kind, user_id, space_id, folder_id, drive_file_id, file_name, expires_at,"
          + " used_at";

  private final DSLContext dsl;

  /**
   * 링크 행 삽입(현재 테넌트 GUC 의 tenant_id 가 기본값으로 들어간다).
   *
   * @return 새 행 id
   */
  public long insert(
      String kind,
      String tokenHash,
      long userId,
      long spaceId,
      Long folderId,
      Long driveFileId,
      String fileName,
      OffsetDateTime expiresAt) {
    return dsl.insertInto(DRIVE_TRANSFER_LINK)
        .set(DRIVE_TRANSFER_LINK.KIND, kind)
        .set(DRIVE_TRANSFER_LINK.TOKEN_HASH, tokenHash)
        .set(DRIVE_TRANSFER_LINK.USER_ID, userId)
        .set(DRIVE_TRANSFER_LINK.SPACE_ID, spaceId)
        .set(DRIVE_TRANSFER_LINK.FOLDER_ID, folderId)
        .set(DRIVE_TRANSFER_LINK.DRIVE_FILE_ID, driveFileId)
        .set(DRIVE_TRANSFER_LINK.FILE_NAME, fileName)
        .set(DRIVE_TRANSFER_LINK.EXPIRES_AT, expiresAt)
        .returning(DRIVE_TRANSFER_LINK.ID)
        .fetchOne()
        .getId();
  }

  /** 만료 행을 지우는 기준 — 만료 뒤 하루. 주기 정리 함수({@code drive_transfer_link_purge_expired})와 같은 값이다. */
  private static final Field<OffsetDateTime> PURGE_CUTOFF =
      DSL.field("now() - interval '1 day'", OffsetDateTime.class);

  /**
   * 발급자의 만료 뒤 하루가 지난 링크 행을 지운다(발급 시 정리 — 주기 정리는 {@link #purgeExpired}). 막 만료·사용된 행은 남겨 그 링크를 다시 쓰려는
   * 요청이 404 가 아니라 410 을 받게 한다.
   *
   * @return 지운 행 수
   */
  public int deleteExpiredByUser(long userId) {
    return dsl.deleteFrom(DRIVE_TRANSFER_LINK)
        .where(DRIVE_TRANSFER_LINK.USER_ID.eq(userId))
        .and(DRIVE_TRANSFER_LINK.EXPIRES_AT.lt(PURGE_CUTOFF))
        .execute();
  }

  /**
   * 만료 뒤 하루가 지난 행을 모든 테넌트에서 지운다(정리 스케줄러용) — SECURITY DEFINER 함수라 테넌트 컨텍스트 없이 RLS 를 우회한다. 하루를 남겨 막
   * 만료·사용된 링크의 재사용 요청이 404 가 아니라 410 을 받게 한다.
   *
   * @return 지운 행 수
   */
  public int purgeExpired() {
    Integer deleted =
        dsl.resultQuery("SELECT drive_transfer_link_purge_expired()").fetchOne(0, Integer.class);
    return deleted == null ? 0 : deleted;
  }

  /** 공개 조회 — SECURITY DEFINER 함수(테넌트 컨텍스트·RLS 무관). 사용·만료 여부와 상관없이 행을 돌려준다. */
  public Optional<TransferLinkRow> resolve(String tokenHash) {
    return Optional.ofNullable(
            dsl.resultQuery("SELECT " + COLUMNS + " FROM drive_transfer_link_resolve(?)", tokenHash)
                .fetchOne())
        .map(DriveTransferLinkRepository::toRow);
  }

  /**
   * 공개 원자적 소비 — SECURITY DEFINER 함수가 {@code UPDATE … SET used_at = now() WHERE token_hash = ? AND
   * kind = ? AND used_at IS NULL AND expires_at > now()} 를 실행한다. 동시 요청 중 정확히 하나만 행을 받는다.
   *
   * <p>소비는 뒤이은 권한 재확인·파일 읽기와 같은 트랜잭션에 넣지 않는다 — 그 뒤 실패로 롤백되면 링크가 되살아나기 때문이다. 호출부는 트랜잭션 밖(autocommit)
   * 에서 부른다(읽기 전용 트랜잭션 안에서는 UPDATE 가 거부된다).
   *
   * @param kind {@code DOWNLOAD} | {@code UPLOAD}
   * @return 소비된 행, 없거나·종류가 다르거나·이미 사용·만료면 빈 값
   */
  public Optional<TransferLinkRow> consume(String tokenHash, String kind) {
    return Optional.ofNullable(
            dsl.resultQuery(
                    "SELECT " + COLUMNS + " FROM drive_transfer_link_consume(?, ?)",
                    tokenHash,
                    kind)
                .fetchOne())
        .map(DriveTransferLinkRepository::toRow);
  }

  private static TransferLinkRow toRow(Record r) {
    return new TransferLinkRow(
        r.get("id", Long.class),
        r.get("tenant_id", Long.class),
        r.get("kind", String.class),
        r.get("user_id", Long.class),
        r.get("space_id", Long.class),
        r.get("folder_id", Long.class),
        r.get("drive_file_id", Long.class),
        r.get("file_name", String.class),
        r.get("expires_at", OffsetDateTime.class),
        r.get("used_at", OffsetDateTime.class));
  }

  /**
   * 전송 링크 행(RLS 우회 함수로 읽은 값).
   *
   * @param userId 발급자 — 쓸 때 이 사용자의 권한을 다시 확인한다
   * @param folderId 이름 기반 업로드 링크의 대상 폴더(NULL = 루트). 다운로드·파일 지정 업로드 링크는 쓰지 않는다(NULL)
   * @param driveFileId 다운로드 대상, 또는 파일 지정 업로드 링크의 새 버전 대상(WP-369 Task 3). 이름 기반 업로드 링크는 NULL — PUT 은
   *     이 값이 있으면 이름으로 찾지 않고 이 파일에 새 버전을 더한다
   * @param fileName 이름 기반 업로드 링크가 저장할 이름. 파일 지정 업로드 링크는 발급 시점 이름으로, 본문 전 상한 계산에만 쓴다(저장 이름은 파일의 지금
   *     이름). 다운로드는 NULL
   */
  public record TransferLinkRow(
      long id,
      long tenantId,
      String kind,
      long userId,
      long spaceId,
      Long folderId,
      Long driveFileId,
      String fileName,
      OffsetDateTime expiresAt,
      OffsetDateTime usedAt) {}
}
