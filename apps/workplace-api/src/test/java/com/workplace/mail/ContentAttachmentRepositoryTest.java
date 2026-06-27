package com.workplace.mail;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * ContentAttachmentRepository 통합 테스트.
 *
 * <p>find-or-create 멱등성, content_hash 최초1회 기록을 검증한다. RLS(FORCE) 통과를 위해 TenantContext +
 * TransactionTemplate 패턴 사용.
 */
class ContentAttachmentRepositoryTest extends IntegrationTestBase {

  @Autowired private ContentAttachmentRepository repo;
  @Autowired private DSLContext dsl;

  private static final long TENANT_ID = 1L;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  private long seedContent() {
    return new TransactionTemplate(txManager)
        .execute(
            status -> {
              long id =
                  dsl.insertInto(EMAIL_CONTENT)
                      .set(EMAIL_CONTENT.TENANT_ID, TENANT_ID)
                      .set(EMAIL_CONTENT.MESSAGE_ID, "msg-" + System.nanoTime() + "@t")
                      .set(EMAIL_CONTENT.THREAD_ID, "thread-test")
                      .returning(EMAIL_CONTENT.ID)
                      .fetchOne()
                      .getId();
              return id;
            });
  }

  @Test
  void findOrCreate_멱등() {
    long contentId = seedContent();
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              long a = repo.findOrCreate(contentId, 0, "a.pdf", "application/pdf", 100L, null);
              long b = repo.findOrCreate(contentId, 0, "a.pdf", "application/pdf", 100L, null);
              assertThat(a).isEqualTo(b);
              assertThat(
                      dsl.fetchCount(
                          CONTENT_ATTACHMENT, CONTENT_ATTACHMENT.CONTENT_ID.eq(contentId)))
                  .isEqualTo(1);
              status.setRollbackOnly();
            });
    // content 도 정리
    cleanupInTenant(
        TENANT_ID,
        () -> dsl.deleteFrom(EMAIL_CONTENT).where(EMAIL_CONTENT.ID.eq(contentId)).execute());
  }

  @Test
  void setContentHashIfNull_최초1회만() {
    long contentId = seedContent();
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              long id = repo.findOrCreate(contentId, 0, "a.pdf", "application/pdf", 100L, null);
              repo.setContentHashIfNull(id, "hash1");
              repo.setContentHashIfNull(id, "hash2"); // 무시되어야 함
              assertThat(
                      dsl.select(CONTENT_ATTACHMENT.CONTENT_HASH)
                          .from(CONTENT_ATTACHMENT)
                          .where(CONTENT_ATTACHMENT.ID.eq(id))
                          .fetchOne(CONTENT_ATTACHMENT.CONTENT_HASH))
                  .isEqualTo("hash1");
              status.setRollbackOnly();
            });
    cleanupInTenant(
        TENANT_ID,
        () -> dsl.deleteFrom(EMAIL_CONTENT).where(EMAIL_CONTENT.ID.eq(contentId)).execute());
  }
}
