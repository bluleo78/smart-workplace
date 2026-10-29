package com.workplace.auth;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.UserKind;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1162 V240 — 개인 비서(__assistant_u)에게 남아 있던 활성 AI 키를 회수하는 이관. Flyway 는 이미 돌았으므로 마이그레이션 파일을 시드 위에
 * 다시 돌려 본다(GlobalInactiveToSuspendMigrationTest 와 같은 방식). @Transactional 롤백으로 시드와 결과는 남지 않는다.
 */
@Transactional
class PersonalAssistantKeyRevokeMigrationTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private AgentApiKeyRepository repo;

  /** 파일을 JDBC 로 그대로 실행한다 — jOOQ 평문 SQL 의 바인드·템플릿 해석({}·?)을 거치지 않게. 테스트 트랜잭션의 같은 커넥션. */
  private void runMigration() throws IOException {
    String sql =
        new ClassPathResource("db/migration/V240__revoke_personal_assistant_agent_keys.sql")
            .getContentAsString(StandardCharsets.UTF_8);
    dsl.connection(
        c -> {
          try (var st = c.createStatement()) {
            st.execute(sql);
          }
        });
  }

  private long seedAgent(String username) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.NAME, username)
        .setNull(USER.PASSWORD)
        .setNull(USER.EMAIL)
        .set(USER.KIND, UserKind.AGENT)
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private boolean isRevoked(long keyId) {
    return dsl.select(AGENT_API_KEY.REVOKED_AT)
            .from(AGENT_API_KEY)
            .where(AGENT_API_KEY.ID.eq(keyId))
            .fetchOne(AGENT_API_KEY.REVOKED_AT)
        != null;
  }

  /**
   * 개인 비서의 활성 키만 회수하고, 일반 AI 의 키와 밑줄이 와일드카드로 맞던 비슷한 이름(xxassistantxu… — 밑줄 자리에 아무 글자)의 키는 그대로 둔다.
   */
  @Test
  void revokes_only_personal_assistant_keys() throws IOException {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    long assistant = seedAgent(AgentUsernames.PERSONAL_ASSISTANT_PREFIX + "9" + suffix);
    long agent = seedAgent("bot-" + suffix);
    long lookalike = seedAgent("xxassistantxu" + suffix);
    long assistantKey = repo.insert(assistant, "ak_pa000000", "pa-hash-" + suffix, "old", agent);
    long agentKey = repo.insert(agent, "ak_ag000000", "ag-hash-" + suffix, null, agent);
    long lookalikeKey = repo.insert(lookalike, "ak_lk000000", "lk-hash-" + suffix, null, agent);

    runMigration();

    assertThat(isRevoked(assistantKey)).isTrue();
    assertThat(isRevoked(agentKey)).isFalse();
    assertThat(isRevoked(lookalikeKey)).isFalse();
  }
}
