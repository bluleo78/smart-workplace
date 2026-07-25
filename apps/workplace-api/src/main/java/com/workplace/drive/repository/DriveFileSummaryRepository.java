package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.FILE_EXTRACTION;

import org.jooq.DSLContext;
import org.jooq.Record3;
import org.springframework.stereotype.Repository;

/**
 * file_extraction 의 요약·상태·오류를 코어 file id 로 조회(drive 모듈 소유, FILE_EXTRACTION 테이블 직접 접근). RLS 가 테넌트를
 * 스코프하므로 호출은 반드시 트랜잭션 안에서(테넌트 GUC 주입). 행이 없으면 전부 null.
 *
 * <p>error 는 raw 값(예: {@code unsupported-mime:application/zip})을 그대로 반환한다 — 사용자 문구 매핑은 {@code
 * DriveFileService.toReason} 이 담당(#735, raw error 를 API 응답에 직접 노출하지 않기 위함).
 */
@Repository
public class DriveFileSummaryRepository {

  private final DSLContext dsl;

  public DriveFileSummaryRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /** 코어 file id 로 요약·상태·오류 조회. 행 없으면 전부 null. */
  public SummaryRow findSummary(long fileId) {
    Record3<String, String, String> r =
        dsl.select(FILE_EXTRACTION.SUMMARY, FILE_EXTRACTION.STATUS, FILE_EXTRACTION.ERROR)
            .from(FILE_EXTRACTION)
            .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
            .fetchOne();
    if (r == null) {
      return new SummaryRow(null, null, null);
    }
    return new SummaryRow(r.value1(), r.value2(), r.value3());
  }

  /** file_extraction 원시 조회 결과(summary, status, error). */
  public record SummaryRow(String summary, String status, String error) {}
}
