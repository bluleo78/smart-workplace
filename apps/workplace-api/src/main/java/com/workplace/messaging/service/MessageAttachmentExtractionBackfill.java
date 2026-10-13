package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.MESSAGE_ATTACHMENT;
import static org.jooq.impl.DSL.notExists;
import static org.jooq.impl.DSL.selectOne;

import com.workplace.fileai.inbound.ExtractionBackfillSource;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

/**
 * 팀 채팅 메시지 첨부 중 추출 행이 없는 파일 — WP-358 이전에 전송된 첨부의 백필 대상. 이슈·챗 첨부(WP-244)와 같은 SPI 라
 * FileExtractionScheduler 가 회차당 예산 안에서 천천히 TEXT_ONLY 로 시드한다. 정션(message_attachment)에 있는 = 메시지에 바인딩된
 * 영구 파일만 대상이다(버려진 선업로드 임시 파일은 제외). 메시지는 소프트 삭제라 첨부 행이 남으므로, 삭제된 메시지의 첨부는 추출 대상에서 뺀다(WP-366 과 같은
 * 기준).
 */
@Component
@RequiredArgsConstructor
public class MessageAttachmentExtractionBackfill implements ExtractionBackfillSource {

  private final DSLContext dsl;

  /**
   * file_extraction 행이 없는 메시지 첨부 파일을 id 오름차순으로 limit 건 조회한다. 공용 BackfillQueries 는 메시지 삭제 여부를
   * 모르므로(이슈·챗 첨부엔 해당 없음), 메시징은 MESSAGE 를 조인해 DELETED_AT IS NULL 만 대상으로 하는 전용 쿼리를 쓴다.
   */
  @Override
  public List<Target> findMissing(int limit) {
    return dsl.select(FILE.ID, FILE.MIME_TYPE)
        .from(MESSAGE_ATTACHMENT)
        .join(FILE)
        .on(FILE.ID.eq(MESSAGE_ATTACHMENT.FILE_ID))
        .join(MESSAGE)
        .on(MESSAGE.ID.eq(MESSAGE_ATTACHMENT.MESSAGE_ID))
        .where(MESSAGE.DELETED_AT.isNull())
        .and(
            notExists(selectOne().from(FILE_EXTRACTION).where(FILE_EXTRACTION.FILE_ID.eq(FILE.ID))))
        .orderBy(FILE.ID)
        .limit(limit)
        .fetch(r -> new Target(r.get(FILE.ID), r.get(FILE.MIME_TYPE)));
  }
}
