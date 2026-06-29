package com.workplace.drive.repository;

import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** Overview 근거용 추출 텍스트 발췌 조회. file_extraction.extracted_text 앞 maxChars 자. RLS 자동 스코프. */
@Repository
public class DriveExcerptRepository {

  private final DSLContext dsl;

  public DriveExcerptRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /**
   * fileId 의 추출 텍스트 앞 maxChars 자를 반환(없거나 DONE 아니면 null).
   *
   * <p>RLS 는 ambient GUC(app.tenant_id) 로 자동 스코프되므로 호출 전 트랜잭션이 열려 있어야 한다 — fail-closed 회피를 위해
   * DriveOverviewService 에서 읽기전용 TransactionTemplate 으로 감싼다(#492 / mail-444 패턴).
   */
  public String findExtractedText(long fileId, int maxChars) {
    return (String)
        dsl.fetchValue(
            "SELECT left(extracted_text, ?) FROM file_extraction WHERE file_id = ? AND status = 'DONE'",
            maxChars,
            fileId);
  }
}
