package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.FILE_EXTRACTION;

import com.workplace.drive.dto.FileSummaryResponse;
import org.jooq.DSLContext;
import org.jooq.Record2;
import org.springframework.stereotype.Repository;

/**
 * file_extraction 의 요약·상태를 코어 file id 로 조회(drive 모듈 소유, FILE_EXTRACTION 테이블 직접 접근). RLS 가 테넌트를
 * 스코프하므로 호출은 반드시 트랜잭션 안에서(테넌트 GUC 주입). 행이 없으면 (null, null).
 */
@Repository
public class DriveFileSummaryRepository {

  private final DSLContext dsl;

  public DriveFileSummaryRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /** 코어 file id 로 요약·상태 조회. 행 없으면 summary/status 모두 null. */
  public FileSummaryResponse findSummary(long fileId) {
    Record2<String, String> r =
        dsl.select(FILE_EXTRACTION.SUMMARY, FILE_EXTRACTION.STATUS)
            .from(FILE_EXTRACTION)
            .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
            .fetchOne();
    if (r == null) {
      return new FileSummaryResponse(null, null);
    }
    return new FileSummaryResponse(r.value1(), r.value2());
  }
}
