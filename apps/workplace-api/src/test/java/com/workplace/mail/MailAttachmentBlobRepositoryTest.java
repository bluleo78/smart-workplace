package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.repository.MailAttachmentBlobRepository;
import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * MailAttachmentBlobRepository 통합 테스트.
 *
 * <p>insertIfAbsent 멱등성, findByHash, usage 집계를 검증한다. RLS(FORCE) 통과를 위해 TenantContext +
 * TransactionTemplate 패턴 사용.
 */
class MailAttachmentBlobRepositoryTest extends IntegrationTestBase {

  @Autowired private MailAttachmentBlobRepository repo;

  private static final long TENANT_ID = 1L;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  void insertIfAbsent_멱등_findByHash() {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              repo.insertIfAbsent("hashX", "tenant-1/ha/x.enc", 500L);
              repo.insertIfAbsent("hashX", "tenant-1/ha/y.enc", 500L); // 무시(ON CONFLICT DO NOTHING)
              var found = repo.findByHash("hashX");
              assertThat(found).isPresent();
              assertThat(found.get().fileRef()).isEqualTo("tenant-1/ha/x.enc");
              status.setRollbackOnly();
            });
  }

  @Test
  void usage_물리사용량_distinct_blob_합() {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              repo.insertIfAbsent("h1", "tenant-1/h1/a.enc", 100L);
              repo.insertIfAbsent("h2", "tenant-1/h2/b.enc", 200L);
              assertThat(repo.usage().physicalBytes()).isGreaterThanOrEqualTo(300L);
              assertThat(repo.usage().blobCount()).isGreaterThanOrEqualTo(2L);
              status.setRollbackOnly();
            });
  }
}
