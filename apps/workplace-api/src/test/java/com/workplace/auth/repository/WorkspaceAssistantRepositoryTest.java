package com.workplace.auth.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 공용 비서(싱글톤) 저장/조회 저장소 통합 테스트.
 *
 * <p>{@code @Transactional} 로 각 메서드가 롤백되어 싱글톤 테이블 상태가 테스트 간 누수되지 않는다 — 미지정 케이스에서 {@code .isEmpty()}
 * 를 안전하게 단언할 수 있다.
 */
@Transactional
class WorkspaceAssistantRepositoryTest extends IntegrationTestBase {

  @Autowired WorkspaceAssistantRepository repo;
  @Autowired DSLContext dsl;

  @Test
  void upsert_후_조회하면_지정한_agent_가_나온다() {
    long admin = TestFixtures.createHuman(dsl);
    long agentA = TestFixtures.createAgentNoToken(dsl);
    long agentB = TestFixtures.createAgentNoToken(dsl);

    repo.upsert(agentA, admin);
    assertThat(repo.findAgentId()).hasValue(agentA);

    repo.upsert(agentB, admin); // 싱글톤 갱신
    assertThat(repo.findAgentId()).hasValue(agentB);
  }

  @Test
  void 미지정이면_empty() {
    // 롤백 격리 덕분에 클린 상태에서 시작 — test DB(workplace_test)에는 V18 시드 행이 없다.
    assertThat(repo.findAgentId()).isEmpty();
  }
}
