package com.workplace.fileai.repository;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static org.jooq.impl.DSL.notExists;
import static org.jooq.impl.DSL.selectOne;

import com.workplace.fileai.inbound.ExtractionBackfillSource.Target;
import java.util.List;
import org.jooq.DSLContext;
import org.jooq.TableField;

/**
 * 백필 SPI 구현체(이슈·챗 등)가 공유하는 "추출 행 없는 첨부" 조회(WP-244).
 *
 * <p>도메인마다 달라지는 것은 첨부 테이블의 FILE_ID 컬럼뿐이라 쿼리를 한곳에 둔다. 의존 방향(도메인 → fileai)은 유지된다.
 */
public final class BackfillQueries {

  private BackfillQueries() {}

  /**
   * 주어진 첨부 테이블의 file_id 로 FILE 을 조인해, file_extraction 행이 없는 파일을 id 오름차순으로 limit 건 조회한다.
   *
   * @param attachmentFileId 도메인 첨부 테이블의 FILE_ID 필드(예: ISSUE_ATTACHMENT.FILE_ID)
   */
  public static List<Target> findMissingFor(
      DSLContext dsl, TableField<?, Long> attachmentFileId, int limit) {
    return dsl.select(FILE.ID, FILE.MIME_TYPE)
        .from(attachmentFileId.getTable())
        .join(FILE)
        .on(FILE.ID.eq(attachmentFileId))
        .where(
            notExists(selectOne().from(FILE_EXTRACTION).where(FILE_EXTRACTION.FILE_ID.eq(FILE.ID))))
        .orderBy(FILE.ID)
        .limit(limit)
        .fetch(r -> new Target(r.get(FILE.ID), r.get(FILE.MIME_TYPE)));
  }
}
