package com.workplace.issue.service;

import static com.workplace.jooq.Tables.ISSUE_ATTACHMENT;

import com.workplace.fileai.inbound.ExtractionBackfillSource;
import com.workplace.fileai.repository.BackfillQueries;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

/** 이슈 첨부 중 추출 행이 없는 파일 — WP-242 이전 업로드분 백필 대상(WP-244). */
@Component
@RequiredArgsConstructor
public class IssueAttachmentExtractionBackfill implements ExtractionBackfillSource {

  private final DSLContext dsl;

  /** file_extraction 행이 없는 이슈 첨부 파일을 id 오름차순으로 limit 건 조회한다. */
  @Override
  public List<Target> findMissing(int limit) {
    return BackfillQueries.findMissingFor(dsl, ISSUE_ATTACHMENT.FILE_ID, limit);
  }
}
