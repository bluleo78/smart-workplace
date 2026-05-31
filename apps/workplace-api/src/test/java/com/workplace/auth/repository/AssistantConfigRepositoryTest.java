package com.workplace.auth.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

// 비-트랜잭션 IntegrationTestBase 위에서 @Transactional 로 행 롤백(격리) 보장.
@Transactional
class AssistantConfigRepositoryTest extends IntegrationTestBase {

  @Autowired AssistantConfigRepository repo;
  @Autowired DSLContext dsl;

  @Test
  void upsert_후_조회하면_값이_나오고_재upsert_로_갱신된다() {
    long agentId = TestFixtures.createAgentNoToken(dsl);
    repo.upsert(agentId, "claude-opus-4-8", "DEEP", null, null);

    var row = repo.find(agentId).orElseThrow();
    assertThat(row.model()).isEqualTo("claude-opus-4-8");
    assertThat(row.thinkingDepth()).isEqualTo("DEEP");
    assertThat(row.maxTurns()).isNull();

    repo.upsert(agentId, "claude-sonnet-4-6", "NORMAL", 10, 70000);
    var updated = repo.find(agentId).orElseThrow();
    assertThat(updated.model()).isEqualTo("claude-sonnet-4-6");
    assertThat(updated.maxTurns()).isEqualTo(10);
  }

  @Test
  void 미설정이면_empty() {
    assertThat(repo.find(999_999L)).isEmpty();
  }
}
