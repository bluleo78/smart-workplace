package com.workplace.chat.service;

import static com.workplace.jooq.Tables.CHAT_MESSAGE_ATTACHMENT;

import com.workplace.fileai.inbound.ExtractionBackfillSource;
import com.workplace.fileai.repository.BackfillQueries;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

/**
 * 이슈 챗 메시지 첨부 중 추출 행이 없는 파일 — WP-242 이전 업로드분 백필 대상(WP-244). 삭제된 메시지의 첨부도 포함한다(구간 읽기 API 가 막지 않으므로
 * 일관되게).
 */
@Component
@RequiredArgsConstructor
public class ChatAttachmentExtractionBackfill implements ExtractionBackfillSource {

  private final DSLContext dsl;

  /** file_extraction 행이 없는 챗 첨부 파일을 id 오름차순으로 limit 건 조회한다. */
  @Override
  public List<Target> findMissing(int limit) {
    return BackfillQueries.findMissingFor(dsl, CHAT_MESSAGE_ATTACHMENT.FILE_ID, limit);
  }
}
