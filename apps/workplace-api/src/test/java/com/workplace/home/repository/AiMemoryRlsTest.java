package com.workplace.home.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-55 ai_memory 저장소 — 테넌트 RLS 증명(ChatDomainRlsTest 와 같은 방식)과 되살리기의 시퀀스 발급 확인. 테스트 GUC 가 tenant#1
 * 로 고정돼 있어 tenant#1 만 쓰면 거짓 통과하므로, 롤백 트랜잭션 안에서 tenant#2 를 만들고 트랜잭션-로컬 GUC 를 바꿔 가며 본다.
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

  /**
   * 되살리기의 발급 확인(lastIssued)은 is_called 를 본다 — nextval 전의 새 시퀀스는 last_value 가 1 이어도 아무것도 발급하지
   * 않았다(0). 실제 ai_memory_id_seq 는 nextval·setval 이 롤백되지 않아 다른 테스트와 얽히므로, 롤백되는 트랜잭션 안에서 만든 임시 시퀀스로
   * 본다(DDL 은 롤백된다).
   */
  @Test
  void 시퀀스_발급값은_nextval_전이면_0_이고_뒤면_그_값이다() {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              dsl.execute("CREATE TEMP SEQUENCE ai_memory_issued_probe_seq");
              assertThat(AiMemoryRepository.lastIssued(dsl, "ai_memory_issued_probe_seq")).isZero();
              dsl.execute("SELECT nextval('ai_memory_issued_probe_seq')");
              assertThat(AiMemoryRepository.lastIssued(dsl, "ai_memory_issued_probe_seq"))
                  .isEqualTo(1);
              status.setRollbackOnly();
            });
  }

  /** 트랜잭션-로컬 GUC 직접 설정. */
  private void setGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }
}
