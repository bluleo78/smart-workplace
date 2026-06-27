package com.workplace.mail;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_BLOB;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.service.MailAttachmentMeteringService;
import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * MailAttachmentMeteringService 통합 테스트.
 *
 * <p>같은 content_hash 를 가진 content_attachment 2행(논리 2×size) + blob 1행(물리 1×size) seed → 물리 <
 * 논리(dedup 절감 가시화), blobCount=1 을 검증한다. RLS(FORCE) 통과를 위해 TenantContext + TransactionTemplate 패턴
 * 사용.
 */
class MailAttachmentMeteringIntegrationTest extends IntegrationTestBase {

  @Autowired private MailAttachmentMeteringService meteringService;

  private static final long TENANT_ID = 1L;
  private static final String HASH = "h-dedup-metering-test";
  private static final long SIZE = 100L;

  private long contentId;
  private long caId1;
  private long caId2;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);

    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              long nano = System.nanoTime();

              // email_content 1행 (content_attachment 의 부모)
              contentId =
                  baseDsl
                      .insertInto(EMAIL_CONTENT)
                      .set(EMAIL_CONTENT.TENANT_ID, TENANT_ID)
                      .set(EMAIL_CONTENT.MESSAGE_ID, "msg-metering-" + nano + "@test.local")
                      .set(EMAIL_CONTENT.THREAD_ID, "thread-metering-" + nano)
                      .returning(EMAIL_CONTENT.ID)
                      .fetchOne()
                      .getId();

              // content_attachment 2행: 같은 content_hash, size 100 각 → 논리 200
              caId1 =
                  baseDsl
                      .insertInto(CONTENT_ATTACHMENT)
                      .set(CONTENT_ATTACHMENT.TENANT_ID, TENANT_ID)
                      .set(CONTENT_ATTACHMENT.CONTENT_ID, contentId)
                      .set(CONTENT_ATTACHMENT.ORDINAL, 0)
                      .set(CONTENT_ATTACHMENT.FILENAME, "file-a.txt")
                      .set(CONTENT_ATTACHMENT.CONTENT_TYPE, "text/plain")
                      .set(CONTENT_ATTACHMENT.SIZE_BYTES, SIZE)
                      .set(CONTENT_ATTACHMENT.CONTENT_HASH, HASH)
                      .returning(CONTENT_ATTACHMENT.ID)
                      .fetchOne()
                      .getId();

              caId2 =
                  baseDsl
                      .insertInto(CONTENT_ATTACHMENT)
                      .set(CONTENT_ATTACHMENT.TENANT_ID, TENANT_ID)
                      .set(CONTENT_ATTACHMENT.CONTENT_ID, contentId)
                      .set(CONTENT_ATTACHMENT.ORDINAL, 1)
                      .set(CONTENT_ATTACHMENT.FILENAME, "file-b.txt")
                      .set(CONTENT_ATTACHMENT.CONTENT_TYPE, "text/plain")
                      .set(CONTENT_ATTACHMENT.SIZE_BYTES, SIZE)
                      .set(CONTENT_ATTACHMENT.CONTENT_HASH, HASH)
                      .returning(CONTENT_ATTACHMENT.ID)
                      .fetchOne()
                      .getId();

              // mail_attachment_blob 1행: 물리 100
              baseDsl
                  .insertInto(MAIL_ATTACHMENT_BLOB)
                  .set(MAIL_ATTACHMENT_BLOB.TENANT_ID, TENANT_ID)
                  .set(MAIL_ATTACHMENT_BLOB.CONTENT_HASH, HASH)
                  .set(MAIL_ATTACHMENT_BLOB.FILE_REF, "test/blob-metering-" + nano)
                  .set(MAIL_ATTACHMENT_BLOB.SIZE_BYTES, SIZE)
                  .execute();
            });
  }

  @AfterEach
  void tearDown() {
    cleanupInTenant(
        TENANT_ID,
        () -> {
          baseDsl
              .deleteFrom(CONTENT_ATTACHMENT)
              .where(CONTENT_ATTACHMENT.ID.in(caId1, caId2))
              .execute();
          baseDsl.deleteFrom(EMAIL_CONTENT).where(EMAIL_CONTENT.ID.eq(contentId)).execute();
          baseDsl
              .deleteFrom(MAIL_ATTACHMENT_BLOB)
              .where(MAIL_ATTACHMENT_BLOB.CONTENT_HASH.eq(HASH))
              .execute();
        });
    TenantContext.clear();
  }

  @Test
  void dedup_절감_물리는_논리보다_작음() {
    // content_attachment 2행(같은 content_hash "h", size 100 각) + blob 1행(size 100)
    // → 물리 100, 논리 200, blobCount 1
    var usage = meteringService.currentTenantUsage();
    assertThat(usage.physicalBytes()).isLessThan(usage.logicalBytes());
    assertThat(usage.blobCount()).isEqualTo(1L);
  }
}
