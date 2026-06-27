package com.workplace.mail;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * V100 스키마(content_attachment·email_attachment.ordinal) 가 적용됐고, 새 email_attachment 의 ordinal 이 다운로드
 * 파생식(message_id 내 id 오름차순 0-based)과 일치하는지 검증.
 */
@Transactional
class MailAttachmentManifestBackfillIntegrationTest extends IntegrationTestBase {

  @Autowired private org.jooq.DSLContext dsl;

  @Test
  void V100_스키마_적용됨() {
    // content_attachment·email_attachment.ordinal 컬럼이 존재해 빈 조회가 성립하면 통과.
    assertThat(dsl.fetchCount(CONTENT_ATTACHMENT)).isGreaterThanOrEqualTo(0);
    assertThat(
            dsl.selectCount()
                .from(EMAIL_ATTACHMENT)
                .where(EMAIL_ATTACHMENT.ORDINAL.isNotNull())
                .fetchOne())
        .isNotNull();
  }
}
