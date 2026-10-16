package com.workplace.file.repository;

import static com.workplace.jooq.Tables.STAGED_UPLOAD_LINK;

import java.time.OffsetDateTime;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * staged_upload_link 접근(WP-421). 발급·정리는 RLS 컨텍스트(인증 요청 트랜잭션) 안에서, 공개 경로의 조회·소비는 테넌트 컨텍스트가 없으므로
 * SECURITY DEFINER 함수({@code staged_upload_link_resolve}·{@code staged_upload_link_consume})로 한다 —
 * 드라이브 전송 링크({@code DriveTransferLinkRepository})와 같은 방식.
 */
@Repository
@RequiredArgsConstructor
public class StagedUploadLinkRepository {
  /** 두 SECURITY DEFINER 함수가 같은 열 순서로 돌려준다. */
  private static final String COLUMNS = "id, tenant_id, user_id, file_name, expires_at, used_at";

  /** 만료 행을 지우는 기준 — 만료 뒤 하루. 주기 정리 함수({@code staged_upload_link_purge_expired})와 같은 값이다. */
  private static final Field<OffsetDateTime> PURGE_CUTOFF =
      DSL.field("now() - interval '1 day'", OffsetDateTime.class);

  private final DSLContext dsl;

  /**
   * 링크 행 삽입(현재 테넌트 GUC 의 tenant_id 가 기본값으로 들어간다).
   *
   * @return 새 행 id
   */
  public long insert(String tokenHash, long userId, String fileName, OffsetDateTime expiresAt) {
    return dsl.insertInto(STAGED_UPLOAD_LINK)
        .set(STAGED_UPLOAD_LINK.TOKEN_HASH, tokenHash)
        .set(STAGED_UPLOAD_LINK.USER_ID, userId)
        .set(STAGED_UPLOAD_LINK.FILE_NAME, fileName)
        .set(STAGED_UPLOAD_LINK.EXPIRES_AT, expiresAt)
        .returning(STAGED_UPLOAD_LINK.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 발급자의 만료 뒤 하루가 지난 링크 행을 지운다(발급 시 정리 — 주기 정리는 {@link #purgeExpired}). 막 만료·사용된 행은 남겨 그 링크를 다시 쓰려는
   * 요청이 404 가 아니라 410 을 받게 한다.
   *
   * @return 지운 행 수
   */
  public int deleteExpiredByUser(long userId) {
    return dsl.deleteFrom(STAGED_UPLOAD_LINK)
        .where(STAGED_UPLOAD_LINK.USER_ID.eq(userId))
        .and(STAGED_UPLOAD_LINK.EXPIRES_AT.lt(PURGE_CUTOFF))
        .execute();
  }

  /** 공개 조회 — SECURITY DEFINER 함수(테넌트 컨텍스트·RLS 무관). 사용·만료 여부와 상관없이 행을 돌려준다. */
  public Optional<StagedLinkRow> resolve(String tokenHash) {
    return Optional.ofNullable(
            dsl.resultQuery("SELECT " + COLUMNS + " FROM staged_upload_link_resolve(?)", tokenHash)
                .fetchOne())
        .map(StagedUploadLinkRepository::toRow);
  }

  /**
   * 공개 원자적 소비 — SECURITY DEFINER 함수가 미사용·만료 전일 때만 {@code used_at = now()} 로 바꾸고 그 행을 돌려준다. 동시 요청 중
   * 정확히 하나만 행을 받는다.
   *
   * <p>뒤이은 재확인·저장과 같은 트랜잭션에 넣지 않는다 — 그 뒤 실패로 롤백되면 링크가 되살아나기 때문이다. 호출부는 트랜잭션 밖(autocommit)에서 부른다.
   *
   * @return 소비된 행, 없거나 이미 사용·만료면 빈 값
   */
  public Optional<StagedLinkRow> consume(String tokenHash) {
    return Optional.ofNullable(
            dsl.resultQuery("SELECT " + COLUMNS + " FROM staged_upload_link_consume(?)", tokenHash)
                .fetchOne())
        .map(StagedUploadLinkRepository::toRow);
  }

  /**
   * 만료 뒤 하루가 지난 행을 모든 테넌트에서 지운다(정리 스케줄러용) — SECURITY DEFINER 함수라 테넌트 컨텍스트 없이 RLS 를 우회한다.
   *
   * @return 지운 행 수
   */
  public int purgeExpired() {
    Integer deleted =
        dsl.resultQuery("SELECT staged_upload_link_purge_expired()").fetchOne(0, Integer.class);
    return deleted == null ? 0 : deleted;
  }

  private static StagedLinkRow toRow(Record r) {
    return new StagedLinkRow(
        r.get("id", Long.class),
        r.get("tenant_id", Long.class),
        r.get("user_id", Long.class),
        r.get("file_name", String.class),
        r.get("expires_at", OffsetDateTime.class),
        r.get("used_at", OffsetDateTime.class));
  }

  /**
   * 스테이징 업로드 링크 행(RLS 우회 함수로 읽은 값).
   *
   * @param userId 발급자 — 쓸 때 이 사용자가 지금도 워크스페이스 ACTIVE 멤버인지 다시 확인하고, 올린 파일의 업로더가 된다
   * @param fileName 저장할(정리된) 파일 이름
   * @param usedAt NULL = 미사용
   */
  public record StagedLinkRow(
      long id,
      long tenantId,
      long userId,
      String fileName,
      OffsetDateTime expiresAt,
      OffsetDateTime usedAt) {}
}
