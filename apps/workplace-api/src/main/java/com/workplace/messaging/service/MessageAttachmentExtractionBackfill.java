package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.MESSAGE_ATTACHMENT;

import com.workplace.fileai.inbound.ExtractionBackfillSource;
import com.workplace.fileai.repository.BackfillQueries;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

/**
 * 팀 채팅 메시지 첨부 중 추출 행이 없는 파일 — WP-358 이전에 전송된 첨부의 백필 대상. 이슈·챗 첨부(WP-244)와 같은 SPI 라
 * FileExtractionScheduler 가 회차당 예산 안에서 천천히 TEXT_ONLY 로 시드한다. 정션(message_attachment)에 있는 = 메시지에 바인딩된
 * 영구 파일만 대상이다(버려진 선업로드 임시 파일은 제외).
 */
@Component
@RequiredArgsConstructor
public class MessageAttachmentExtractionBackfill implements ExtractionBackfillSource {

  private final DSLContext dsl;

  /** file_extraction 행이 없는 메시지 첨부 파일을 id 오름차순으로 limit 건 조회한다. */
  @Override
  public List<Target> findMissing(int limit) {
    return BackfillQueries.findMissingFor(dsl, MESSAGE_ATTACHMENT.FILE_ID, limit);
  }
}
