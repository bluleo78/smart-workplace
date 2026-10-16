package com.workplace.filepreview.repository;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_PREVIEW;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * file_preview 테이블 접근 — 문서 미리보기(서버 변환 PDF) 상태의 CAS 선점과 결과 기록(WP-431).
 *
 * <p>선점({@link #claim})은 단일 업서트라 동시 요청 중 한 쪽만 {@code RETURNING} 을 받는다. 선점이 돌려주는 {@code
 * leased_until} 이 리스 토큰이며, 모든 기록은 {@code status='CONVERTING' AND leased_until=토큰} CAS 로만 반영된다 — 리스가
 * 만료돼 다른 작업이 다시 선점한 뒤 늦게 끝난 오래된 작업이 새 선점을 덮지 못하게 하기 위해서다.
 *
 * <p>RLS 대상 테이블이라 호출자는 테넌트 GUC 가 심긴 트랜잭션 안에서 불러야 한다.
 */
@Repository
@RequiredArgsConstructor
public class FilePreviewRepository {

  private final DSLContext dsl;

  /**
   * 미리보기 상태 한 행. {@code leasedUntil} 은 CONVERTING 일 때의 리스 토큰(그 밖엔 대개 null), {@code updatedAt} 은 마지막
   * 상태 변경 시각(일시 실패 쿨다운 판정용).
   */
  public record Row(
      String status,
      String failureCode,
      boolean failureTransient,
      int attempts,
      String engineVersion,
      Integer pageCount,
      OffsetDateTime leasedUntil,
      OffsetDateTime updatedAt) {}

  /** 미리보기에 필요한 file 행 메타. */
  public record FileMeta(String storagePath, String mime, long sizeBytes, String originalName) {}

  /**
   * file 행 메타와 미리보기 상태를 함께 담은 결과.
   *
   * @param preview 미리보기 행(아직 변환 시도 전이면 null)
   */
  public record FileWithPreview(FileMeta file, Row preview) {}

  /** 파일의 미리보기 상태를 조회한다. 행이 없으면(아직 변환 시도 전) empty. */
  public Optional<Row> find(long fileId) {
    return dsl.select(ROW_FIELDS)
        .from(FILE_PREVIEW)
        .where(FILE_PREVIEW.FILE_ID.eq(fileId))
        .fetchOptional(FilePreviewRepository::toRow);
  }

  /**
   * file 행 메타와 미리보기 상태를 한 번의 조회(FILE LEFT JOIN FILE_PREVIEW)로 읽는다 — 열람 판정이 두 번 왕복하지 않게. 두 테이블 모두
   * RLS 대상이라 활성 테넌트의 행만 보인다.
   *
   * @return file 행이 없으면(삭제됨·다른 테넌트) empty
   */
  public Optional<FileWithPreview> findWithFile(long fileId) {
    return dsl.select(FILE.STORAGE_PATH, FILE.MIME_TYPE, FILE.SIZE_BYTES, FILE.ORIGINAL_NAME)
        .select(ROW_FIELDS)
        .from(FILE)
        .leftJoin(FILE_PREVIEW)
        .on(FILE_PREVIEW.FILE_ID.eq(FILE.ID))
        .where(FILE.ID.eq(fileId))
        .fetchOptional(
            r ->
                new FileWithPreview(
                    new FileMeta(
                        r.get(FILE.STORAGE_PATH),
                        r.get(FILE.MIME_TYPE),
                        r.get(FILE.SIZE_BYTES),
                        r.get(FILE.ORIGINAL_NAME)),
                    // LEFT JOIN 에서 미리보기 행이 없으면 file_id 가 null 이다.
                    r.get(FILE_PREVIEW.FILE_ID) == null ? null : toRow(r)));
  }

  /** {@link Row} 를 만드는 데 필요한 열(file_id 는 LEFT JOIN 에서 행 유무 판정용). */
  private static final List<Field<?>> ROW_FIELDS =
      List.of(
          FILE_PREVIEW.FILE_ID,
          FILE_PREVIEW.STATUS,
          FILE_PREVIEW.FAILURE_CODE,
          FILE_PREVIEW.FAILURE_TRANSIENT,
          FILE_PREVIEW.ATTEMPTS,
          FILE_PREVIEW.ENGINE_VERSION,
          FILE_PREVIEW.PAGE_COUNT,
          FILE_PREVIEW.LEASED_UNTIL,
          FILE_PREVIEW.UPDATED_AT);

  private static Row toRow(Record r) {
    return new Row(
        r.get(FILE_PREVIEW.STATUS),
        r.get(FILE_PREVIEW.FAILURE_CODE),
        r.get(FILE_PREVIEW.FAILURE_TRANSIENT),
        r.get(FILE_PREVIEW.ATTEMPTS),
        r.get(FILE_PREVIEW.ENGINE_VERSION),
        r.get(FILE_PREVIEW.PAGE_COUNT),
        r.get(FILE_PREVIEW.LEASED_UNTIL),
        r.get(FILE_PREVIEW.UPDATED_AT));
  }

  /**
   * 변환 작업을 선점한다. 선점 가능한 경우(행 없음·PENDING·리스 만료 CONVERTING·엔진 버전이 바뀐 READY·재시도 허용된 FAILED)에만
   * CONVERTING 으로 바꾸고 새 {@code leased_until}(리스 토큰)을 돌려준다.
   *
   * <p>엔진 버전이 바뀐 READY 는 재시도 허용과 무관하게 선점한다 — 새 엔진의 결과로 바꿔 보이기 위해서다(폴링·백그라운드도).
   *
   * <p>FAILED 재선점은 {@code allowFailedRetry} 일 때만 — 엔진 버전이 바뀌었거나(영구 실패 포함), 일시 실패이면서 {@code attempts
   * < maxAttempts} 이거나, 일시 실패가 상한에 닿았어도 마지막 실패({@code updated_at})가 {@code transientCooldown} 보다
   * 오래됐을 때. 폴링은 false 로 불러 몇 초 장애가 폴링 몇 번에 시도 상한을 소진하지 않게 한다. 엔진 버전이 바뀌거나 쿨다운 뒤 다시 잡으면 attempts 는 1
   * 부터 다시 센다.
   *
   * @return 선점 성공 시 리스 토큰, 이미 다른 작업이 선점했거나 선점 불가 상태면 empty
   */
  public Optional<OffsetDateTime> claim(
      long fileId,
      long tenantId,
      String engineVersion,
      Duration lease,
      int maxAttempts,
      Duration transientCooldown,
      boolean allowFailedRetry) {
    // 경합 시 ON CONFLICT 의 WHERE 가 나중 쪽을 걸러 RETURNING 이 비므로 한 쪽만 선점한다.
    // 바인드는 글자 순서대로 — VALUES(4개) → SET 의 CASE(maxAttempts) → WHERE(allow·maxAttempts·cooldown).
    return dsl.resultQuery(
            """
            INSERT INTO file_preview (file_id, tenant_id, status, attempts, engine_version, leased_until)
            VALUES (?, ?, 'CONVERTING', 1, ?, now() + (? * interval '1 millisecond'))
            ON CONFLICT (file_id) DO UPDATE SET
              status = 'CONVERTING',
              attempts = CASE WHEN file_preview.engine_version IS DISTINCT FROM EXCLUDED.engine_version
                                OR (file_preview.status = 'FAILED' AND file_preview.failure_transient
                                    AND file_preview.attempts >= ?)
                              THEN 1 ELSE file_preview.attempts + 1 END,
              engine_version = EXCLUDED.engine_version,
              leased_until = EXCLUDED.leased_until,
              failure_code = NULL,
              failure_transient = false,
              updated_at = now()
            WHERE file_preview.status = 'PENDING'
               OR (file_preview.status = 'CONVERTING' AND file_preview.leased_until < now())
               OR (file_preview.status = 'READY'
                   AND file_preview.engine_version IS DISTINCT FROM EXCLUDED.engine_version)
               OR (file_preview.status = 'FAILED' AND ?
                   AND (file_preview.engine_version IS DISTINCT FROM EXCLUDED.engine_version
                        OR (file_preview.failure_transient
                            AND (file_preview.attempts < ?
                                 OR file_preview.updated_at < now() - (? * interval '1 millisecond')))))
            RETURNING leased_until
            """,
            fileId,
            tenantId,
            engineVersion,
            lease.toMillis(),
            maxAttempts,
            allowFailedRetry,
            maxAttempts,
            transientCooldown.toMillis())
        .fetchOptional(0, OffsetDateTime.class);
  }

  /**
   * 실행기 작업이 실제로 시작할 때 리스를 새로 잡는다 — 이 토큰으로 아직 CONVERTING 이면 {@code leased_until = now() + lease} 로
   * 바꾸고 새 토큰을 돌려준다. 큐에서 기다린 시간만큼 리스가 줄어 변환 도중 만료되는 일을 막기 위해서다.
   *
   * <p>만료 여부는 보지 않고 토큰 일치만 본다 — 만료됐어도 아무도 다시 선점하지 않았다면(토큰 그대로) 이 작업이 여전히 행의 주인이고, 다시 선점됐다면 토큰이 바뀌어
   * CAS 가 실패한다.
   *
   * @return 새 리스 토큰, 리스를 잃었으면 empty(작업을 건너뛴다)
   */
  public Optional<OffsetDateTime> refreshLease(
      long fileId, OffsetDateTime leaseToken, Duration lease) {
    return dsl.update(FILE_PREVIEW)
        .set(
            FILE_PREVIEW.LEASED_UNTIL,
            DSL.field(
                "now() + ({0} * interval '1 millisecond')",
                OffsetDateTime.class, DSL.val(lease.toMillis())))
        .set(FILE_PREVIEW.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(holdsLease(fileId, leaseToken))
        .returningResult(FILE_PREVIEW.LEASED_UNTIL)
        .fetchOptional(FILE_PREVIEW.LEASED_UNTIL);
  }

  /**
   * 이 리스 토큰으로 아직 CONVERTING 이고 리스가 살아 있는지 — 변환 결과(PDF)를 쓰기 직전에 리스를 잃었는지 확인하는 데 쓴다. 만료된 리스는 언제든 다른
   * 요청이 다시 선점할 수 있어 주인으로 보지 않는다.
   */
  public boolean isCurrentLease(long fileId, OffsetDateTime leaseToken) {
    return dsl.fetchExists(
        FILE_PREVIEW,
        holdsLease(fileId, leaseToken)
            .and(FILE_PREVIEW.LEASED_UNTIL.gt(DSL.currentOffsetDateTime())));
  }

  /**
   * 변환 완료 기록 — READY 로 바꾸고 실패 필드·리스를 비운다. 리스를 잃었으면 false.
   *
   * @param pageCount 변환 서비스의 X-Page-Count(없으면 null)
   */
  public boolean markReady(long fileId, OffsetDateTime leaseToken, Integer pageCount) {
    return dsl.update(FILE_PREVIEW)
            .set(FILE_PREVIEW.STATUS, "READY")
            .set(FILE_PREVIEW.PAGE_COUNT, pageCount)
            .setNull(FILE_PREVIEW.FAILURE_CODE)
            .set(FILE_PREVIEW.FAILURE_TRANSIENT, false)
            .setNull(FILE_PREVIEW.LEASED_UNTIL)
            .set(FILE_PREVIEW.UPDATED_AT, DSL.currentOffsetDateTime())
            .where(holdsLease(fileId, leaseToken))
            .execute()
        == 1;
  }

  /** 변환 실패 기록 — FAILED·실패 코드·일시 여부를 남기고 리스를 비운다(attempts 는 선점 때 이미 셌다). 리스를 잃었으면 false. */
  public boolean markFailed(
      long fileId, OffsetDateTime leaseToken, String code, boolean transientFailure) {
    return dsl.update(FILE_PREVIEW)
            .set(FILE_PREVIEW.STATUS, "FAILED")
            .set(FILE_PREVIEW.FAILURE_CODE, code)
            .set(FILE_PREVIEW.FAILURE_TRANSIENT, transientFailure)
            .setNull(FILE_PREVIEW.LEASED_UNTIL)
            .set(FILE_PREVIEW.UPDATED_AT, DSL.currentOffsetDateTime())
            .where(holdsLease(fileId, leaseToken))
            .execute()
        == 1;
  }

  /**
   * 선점 반납 — CONVERTING → PENDING 으로 되돌리고 선점 때 센 시도 1회를 돌려준다. 실행기가 작업을 거절(큐 가득)해 변환을 시작조차 못 했을 때 시도
   * 상한을 소모하지 않게 하기 위해서다. 리스를 잃었으면 false.
   */
  public boolean release(long fileId, OffsetDateTime leaseToken) {
    return dsl.update(FILE_PREVIEW)
            .set(FILE_PREVIEW.STATUS, "PENDING")
            .set(FILE_PREVIEW.ATTEMPTS, FILE_PREVIEW.ATTEMPTS.minus(1))
            .setNull(FILE_PREVIEW.LEASED_UNTIL)
            .set(FILE_PREVIEW.UPDATED_AT, DSL.currentOffsetDateTime())
            .where(holdsLease(fileId, leaseToken))
            .execute()
        == 1;
  }

  /** READY 인데 preview.pdf 가 디스크에서 사라졌을 때(볼륨 이전·수동 정리) 다시 변환하도록 PENDING·attempts 0 으로 되돌린다. */
  public void resetReady(long fileId) {
    dsl.update(FILE_PREVIEW)
        .set(FILE_PREVIEW.STATUS, "PENDING")
        .set(FILE_PREVIEW.ATTEMPTS, 0)
        .setNull(FILE_PREVIEW.PAGE_COUNT)
        .set(FILE_PREVIEW.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(FILE_PREVIEW.FILE_ID.eq(fileId).and(FILE_PREVIEW.STATUS.eq("READY")))
        .execute();
  }

  /**
   * 크기 상한 초과 — 변환 서비스를 부르지 않고 영구 실패(FAILED/TOO_LARGE)로 업서트한다. 원본 크기는 바뀌지 않으므로 기존 상태와 무관하게 덮어쓰며, 엔진
   * 버전을 함께 남겨 같은 엔진에서는 다시 선점되지 않게 한다.
   */
  public void markTooLarge(long fileId, long tenantId, String engineVersion) {
    dsl.insertInto(FILE_PREVIEW)
        .set(FILE_PREVIEW.FILE_ID, fileId)
        .set(FILE_PREVIEW.TENANT_ID, tenantId)
        .set(FILE_PREVIEW.STATUS, "FAILED")
        .set(FILE_PREVIEW.FAILURE_CODE, "TOO_LARGE")
        .set(FILE_PREVIEW.FAILURE_TRANSIENT, false)
        .set(FILE_PREVIEW.ENGINE_VERSION, engineVersion)
        .onConflict(FILE_PREVIEW.FILE_ID)
        .doUpdate()
        .set(FILE_PREVIEW.STATUS, "FAILED")
        .set(FILE_PREVIEW.FAILURE_CODE, "TOO_LARGE")
        .set(FILE_PREVIEW.FAILURE_TRANSIENT, false)
        .set(FILE_PREVIEW.ENGINE_VERSION, engineVersion)
        .setNull(FILE_PREVIEW.PAGE_COUNT)
        .setNull(FILE_PREVIEW.LEASED_UNTIL)
        .set(FILE_PREVIEW.UPDATED_AT, DSL.currentOffsetDateTime())
        .execute();
  }

  /** 기록 CAS 조건 — 이 토큰으로 선점한 CONVERTING 행일 때만 참. */
  private static Condition holdsLease(long fileId, OffsetDateTime leaseToken) {
    return FILE_PREVIEW
        .FILE_ID
        .eq(fileId)
        .and(FILE_PREVIEW.STATUS.eq("CONVERTING"))
        .and(FILE_PREVIEW.LEASED_UNTIL.eq(leaseToken));
  }
}
