package com.workplace.chat.service;

import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.CHAT_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static org.jooq.impl.DSL.notExists;
import static org.jooq.impl.DSL.selectOne;

import com.workplace.fileai.inbound.ExtractionBackfillSource;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

/**
 * 이슈 챗 메시지 첨부 중 추출 행이 없는 파일 — WP-242 이전 업로드분 백필 대상(WP-244). 삭제된 메시지의 첨부는 내려받기·구간 읽기에서 막으므로(WP-681)
 * 추출 대상에서도 뺀다 — 팀 채팅 백필(MessageAttachmentExtractionBackfill)과 같은 기준.
 */
@Component
@RequiredArgsConstructor
public class ChatAttachmentExtractionBackfill implements ExtractionBackfillSource {

  private final DSLContext dsl;

  /**
   * file_extraction 행이 없는 챗 첨부 파일을 id 오름차순으로 limit 건 조회한다. 공용 BackfillQueries 는 메시지 삭제 여부를 모르므로
   * CHAT_MESSAGE 를 조인해 DELETED_AT IS NULL 만 대상으로 하는 전용 쿼리를 쓴다.
   */
  @Override
  public List<Target> findMissing(int limit) {
    return dsl.select(FILE.ID, FILE.MIME_TYPE)
        .from(CHAT_MESSAGE_ATTACHMENT)
        .join(FILE)
        .on(FILE.ID.eq(CHAT_MESSAGE_ATTACHMENT.FILE_ID))
        .join(CHAT_MESSAGE)
        .on(CHAT_MESSAGE.ID.eq(CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID))
        .where(CHAT_MESSAGE.DELETED_AT.isNull())
        .and(
            notExists(selectOne().from(FILE_EXTRACTION).where(FILE_EXTRACTION.FILE_ID.eq(FILE.ID))))
        .orderBy(FILE.ID)
        .limit(limit)
        .fetch(r -> new Target(r.get(FILE.ID), r.get(FILE.MIME_TYPE)));
  }
}
