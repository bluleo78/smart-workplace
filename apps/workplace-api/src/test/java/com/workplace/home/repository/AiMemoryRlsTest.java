package com.workplace.home.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-55 ai_memory 저장소 — 테넌트 RLS 증명(ChatDomainRlsTest 와 같은 방식). 테스트 GUC 가 tenant#1 로 고정돼 있어 tenant#1
 * 만 쓰면 거짓 통과하므로, 롤백 트랜잭션 안에서 tenant#2 를 만들고 트랜잭션-로컬 GUC 를 바꿔 가며 본다.
 */
class AiMemoryRlsTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AiMemoryRepository repo;

  @Test
  void 다른_테넌트의_메모리는_보이지도_세어지지도_않는다() {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              long tid2 = TestFixtures.createTenant(dsl, "ACTIVE");
              long uid = TestFixtures.createHuman(dsl);
              setGuc(tid2);
              long id = repo.insert(uid, "PREFERENCE", "테넌트2 메모리", "USER", null).id();
              assertThat(repo.count(uid)).isEqualTo(1);

              setGuc(1L);
              assertThat(repo.listNewest(uid, 50)).isEmpty();
              assertThat(repo.count(uid)).isZero();
              assertThat(repo.lock(uid, id)).isEmpty();
              assertThat(repo.delete(uid, id)).isEmpty();

              status.setRollbackOnly();
            });
  }

  /** 트랜잭션-로컬 GUC 직접 설정. */
  private void setGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }
}
