package com.workplace.fileai.repository;

import static com.workplace.jooq.Tables.FILE_EXTRACTION;

import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** file_extraction 테이블 접근 — 추출 상태 생성·조회. */
@Repository
@RequiredArgsConstructor
public class FileExtractionRepository {

  private final DSLContext dsl;

  /** 업로드 시 PENDING 행 생성. 동일 file_id 의 중복 업로드에 대비해 ON CONFLICT DO NOTHING(이미 PENDING/DONE 이면 무시). */
  public void upsertPending(long fileId, long tenantId) {
    dsl.insertInto(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.FILE_ID, fileId)
        .set(FILE_EXTRACTION.STATUS, "PENDING")
        .set(FILE_EXTRACTION.TENANT_ID, tenantId)
        .onConflict(FILE_EXTRACTION.FILE_ID)
        .doNothing()
        .execute();
  }

  /**
   * 추출 불가(IMAGE/미지원 형식/크기 초과 등) → SKIPPED 마킹. 이미 행이 있으면 무시(DO NOTHING).
   *
   * @param reason SKIPPED 사유 (error 컬럼에 기록, 최대 500자)
   */
  public void markSkipped(long fileId, long tenantId, String reason) {
    dsl.insertInto(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.FILE_ID, fileId)
        .set(FILE_EXTRACTION.STATUS, "SKIPPED")
        .set(FILE_EXTRACTION.ERROR, reason)
        .set(FILE_EXTRACTION.TENANT_ID, tenantId)
        .onConflict(FILE_EXTRACTION.FILE_ID)
        .doNothing()
        .execute();
  }

  /**
   * V125 마이그레이션 ① octet-stream 보정 UPDATE 와 동일 로직(#735) — {@code file.mime_type} 이 {@code
   * application/octet-stream} 인 행을 파일명 확장자 기준으로 표준 mime 으로 보정한다. {@link
   * com.workplace.file.service.MimeNormalizer} 와 동일 매핑 표를 미러 — 한쪽만 고치면 드리프트.
   *
   * <p>마이그레이션은 컨테이너 기동 시 1회만 실행되므로, 이 메서드는 테스트에서 CASE 분기(특히 {@code .hwpx} 가 {@code .hwp} 보다 먼저
   * 매치되는지)를 별도로 검증하기 위한 용도로 존재한다(운영 경로에서는 호출되지 않음 — 백필은 V125 가 이미 수행).
   *
   * @return 보정된 행 수
   */
  public int normalizeOctetStreamMimes() {
    return dsl.execute(
        """
        UPDATE file SET mime_type = CASE
          WHEN lower(original_name) LIKE '%.html' OR lower(original_name) LIKE '%.htm' THEN 'text/html'
          WHEN lower(original_name) LIKE '%.md'   THEN 'text/markdown'
          WHEN lower(original_name) LIKE '%.txt'  OR lower(original_name) LIKE '%.log' THEN 'text/plain'
          WHEN lower(original_name) LIKE '%.csv'  THEN 'text/csv'
          WHEN lower(original_name) LIKE '%.json' THEN 'application/json'
          WHEN lower(original_name) LIKE '%.xml'  THEN 'application/xml'
          WHEN lower(original_name) LIKE '%.yaml' OR lower(original_name) LIKE '%.yml' THEN 'application/x-yaml'
          WHEN lower(original_name) LIKE '%.pdf'  THEN 'application/pdf'
          WHEN lower(original_name) LIKE '%.docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          WHEN lower(original_name) LIKE '%.xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          WHEN lower(original_name) LIKE '%.pptx' THEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
          WHEN lower(original_name) LIKE '%.doc'  THEN 'application/msword'
          WHEN lower(original_name) LIKE '%.xls'  THEN 'application/vnd.ms-excel'
          WHEN lower(original_name) LIKE '%.ppt'  THEN 'application/vnd.ms-powerpoint'
          WHEN lower(original_name) LIKE '%.hwpx' THEN 'application/hwp+zip'
          WHEN lower(original_name) LIKE '%.hwp'  THEN 'application/x-hwp'
          ELSE mime_type
        END
        WHERE mime_type = 'application/octet-stream'
        """);
  }

  /**
   * V125 마이그레이션 ② 재개방 UPDATE 와 동일 로직(#735) — 카테고리 게이트 시절 {@code non-extractable:} 사유로 SKIPPED 굳은 행
   * 중, 현재 {@link com.workplace.fileai.ExtractableTypes} 기준으로 추출 가능한 mime 을 가진 행을 PENDING 으로 되돌린다.
   * 마이그레이션은 컨테이너 기동 시 1회만 실행되므로, 이 메서드는 테스트에서 동일 UPDATE 로직을 별도로 검증하기 위한 용도로 존재한다(운영 경로에서는 호출되지 않음 —
   * 백필은 V125 가 이미 수행).
   *
   * @return 재개방된 행 수
   */
  public int reopenUnsupportedSkipped() {
    return dsl.execute(
        """
        UPDATE file_extraction fe
        SET status = 'PENDING', error = NULL, attempts = 0
        FROM file f
        WHERE fe.file_id = f.id
          AND fe.status = 'SKIPPED'
          AND fe.error LIKE 'non-extractable:%'
          AND (
            f.mime_type LIKE 'text/%'
            OR f.mime_type IN (
              'application/pdf','application/json','application/xml','application/x-yaml','application/yaml',
              'application/javascript','application/x-sh',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'application/x-hwp','application/hwp+zip',
              'application/msword','application/vnd.ms-powerpoint','application/vnd.ms-excel'
            )
          )
        """);
  }
}
