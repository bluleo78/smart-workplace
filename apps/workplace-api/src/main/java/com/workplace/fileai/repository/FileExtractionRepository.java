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
}
