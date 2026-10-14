package com.workplace.home.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.home.service.SearchTerms;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-384 대화 검색의 테넌트 RLS — 테스트 GUC 가 tenant#1 로 고정돼 있어 tenant#1 만 쓰면 거짓 통과하므로, 롤백 트랜잭션 안에서 tenant#2
 * 를 만들고 트랜잭션-로컬 GUC 를 바꿔 본다(AiMemoryRlsTest 와 같은 방식).
 */
class HomeConversationSearchRlsTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired HomeSessionRepository sessionRepo;
  @Autowired HomeMessageRepository messageRepo;
  @Autowired HomeConversationSearchRepository repo;

  @Test
  void 다른_테넌트의_대화는_찾지_않는다() {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              long tid2 = TestFixtures.createTenant(dsl, "ACTIVE");
              long uid = TestFixtures.createHuman(dsl);
              setGuc(tid2);
              UUID sid = sessionRepo.insert(uid);
              messageRepo.insert(sid, "USER", "고양이 사진 정리", null, null, null, "COMPLETE");
              assertThat(repo.search(uid, "고양이", SearchTerms.of("고양이"), null, null, 5)).hasSize(1);

              setGuc(1L);
              assertThat(repo.search(uid, "고양이", SearchTerms.of("고양이"), null, null, 5)).isEmpty();

              status.setRollbackOnly();
            });
  }

  private void setGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }
}
