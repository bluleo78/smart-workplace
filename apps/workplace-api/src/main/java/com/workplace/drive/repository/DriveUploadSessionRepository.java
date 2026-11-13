package com.workplace.drive.repository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * drive_upload_session 접근(WP-1520 나눠 올리기). 모든 조회·쓰기는 RLS 컨텍스트(인증 요청 트랜잭션) 안에서 하고, 늘 owner_id 로 한 번
 * 더 거른다 — 남의 세션은 없는 것과 같다(404). 만료 정리만 테넌트 컨텍스트가 없어 SECURITY DEFINER 함수({@code
 * drive_upload_session_purge_expired})로 한다.
 *
 * <p>새 표 하나뿐이라 jOOQ 코드젠을 다시 돌리지 않고 바인딩 SQL 로 쓴다 — 생성 소스 전체가 흔들리지 않게 하려는 것이다.
 */
@Repository
@RequiredArgsConstructor
public class DriveUploadSessionRepository {
  /** 조회 열 — {@link #toRow} 와 순서를 맞춘다. */
  private static final String COLUMNS =
      "id, tenant_id, owner_id, space_id, folder_id, file_name, content_type, total_size,"
          + " received_bytes, expires_at";

  private final DSLContext dsl;

  /** 세션 한 행. */
  public record SessionRow(
      UUID id,
      long tenantId,
      long ownerId,
      long spaceId,
      Long folderId,
      String fileName,
      String contentType,
      long totalSize,
      long receivedBytes,
      OffsetDateTime expiresAt) {}

  /** 만료 정리가 지운 행 — 임시 파일 경로를 만드는 데 쓴다. */
  public record PurgedSession(UUID id, long tenantId) {}

  /** 새 세션 삽입(현재 테넌트 GUC 의 tenant_id 가 기본값으로 들어간다). */
  public SessionRow insert(
      UUID id,
      long ownerId,
      long spaceId,
      Long folderId,
      String fileName,
      String contentType,
      long totalSize,
      OffsetDateTime expiresAt) {
    Record r =
        dsl.resultQuery(
                "INSERT INTO drive_upload_session"
                    + " (id, owner_id, space_id, folder_id, file_name, content_type, total_size,"
                    + " expires_at) VALUES (CAST(? AS uuid), ?, ?, ?, ?, ?, ?, CAST(? AS timestamptz)) RETURNING "
                    + COLUMNS,
                id,
                ownerId,
                spaceId,
                folderId,
                fileName,
                contentType,
                totalSize,
                expiresAt)
            .fetchOne();
    return toRow(r);
  }

  /** 소유자의 만료 전 세션(잠그지 않음 — 상태 조회·본문 받기 전 빠른 거절용). */
  public Optional<SessionRow> findActive(UUID id, long ownerId) {
    return Optional.ofNullable(
            dsl.resultQuery(
                    "SELECT "
                        + COLUMNS
                        + " FROM drive_upload_session WHERE id = CAST(? AS uuid) AND owner_id = ?"
                        + " AND expires_at > now()",
                    id,
                    ownerId)
                .fetchOne())
        .map(DriveUploadSessionRepository::toRow);
  }

  /** 소유자의 만료 전 세션을 잠근다(FOR UPDATE) — 조각 쓰기·완료가 같은 세션에서 겹치지 않게 직렬화한다. */
  public Optional<SessionRow> lockActive(UUID id, long ownerId) {
    return Optional.ofNullable(
            dsl.resultQuery(
                    "SELECT "
                        + COLUMNS
                        + " FROM drive_upload_session WHERE id = CAST(? AS uuid) AND owner_id = ?"
                        + " AND expires_at > now() FOR UPDATE",
                    id,
                    ownerId)
                .fetchOne())
        .map(DriveUploadSessionRepository::toRow);
  }

  /**
   * 현재 테넌트의 만료 전 세션들이 올리겠다고 선언한 크기(total_size)의 합 — 시작 시 용량 사전 검사에 더한다. 열린 세션이 아직 파일로 저장되지 않아 사용량에
   * 잡히지 않으므로, 이를 빼면 큰 세션 여러 개를 동시에 열어 용량을 넘길 수 있다. 테넌트 범위는 RLS 도 거르지만, 테넌트 인덱스를 타도록 tenant_id 조건을
   * 명시한다.
   */
  public long sumOpenTotalSize() {
    Long sum =
        dsl.resultQuery(
                "SELECT COALESCE(SUM(total_size), 0) AS s FROM drive_upload_session"
                    + " WHERE tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint"
                    + " AND expires_at > now()")
            .fetchOne(r -> r.get("s", Long.class));
    return sum == null ? 0 : sum;
  }

  /** 받은 바이트와 만료 시각을 갱신한다(조각 하나를 이어 쓴 뒤). */
  public void updateProgress(UUID id, long receivedBytes, OffsetDateTime expiresAt) {
    dsl.query(
            "UPDATE drive_upload_session SET received_bytes = ?, expires_at = CAST(? AS timestamptz), updated_at = now()"
                + " WHERE id = CAST(? AS uuid)",
            receivedBytes,
            expiresAt,
            id)
        .execute();
  }

  /**
   * 소유자의 세션 행을 지운다(만료 여부와 상관없이 — 취소는 만료 직후에도 정리하게).
   *
   * @return 지운 행 — 없으면 빈 값
   */
  public Optional<SessionRow> delete(UUID id, long ownerId) {
    return Optional.ofNullable(
            dsl.resultQuery(
                    "DELETE FROM drive_upload_session WHERE id = CAST(? AS uuid) AND owner_id = ? RETURNING "
                        + COLUMNS,
                    id,
                    ownerId)
                .fetchOne())
        .map(DriveUploadSessionRepository::toRow);
  }

  /** 만료 행을 모든 테넌트에서 지우고 지운 행의 id·tenant_id 를 돌려준다(SECURITY DEFINER — 테넌트 컨텍스트 불필요). */
  public List<PurgedSession> purgeExpired() {
    return dsl.resultQuery("SELECT id, tenant_id FROM drive_upload_session_purge_expired()")
        .fetch(r -> new PurgedSession(r.get("id", UUID.class), r.get("tenant_id", Long.class)));
  }

  private static SessionRow toRow(Record r) {
    return new SessionRow(
        r.get("id", UUID.class),
        r.get("tenant_id", Long.class),
        r.get("owner_id", Long.class),
        r.get("space_id", Long.class),
        r.get("folder_id", Long.class),
        r.get("file_name", String.class),
        r.get("content_type", String.class),
        r.get("total_size", Long.class),
        r.get("received_bytes", Long.class),
        r.get("expires_at", OffsetDateTime.class));
  }
}
