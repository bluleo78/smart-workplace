package com.workplace.auth.repository;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.dto.AgentApiKeyResponse;
import com.workplace.auth.repository.AgentApiKeyRepository.ActiveKey;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.UserKind;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** Phase 5a — AgentApiKeyRepository jOOQ 통합 테스트. */
@Transactional
class AgentApiKeyRepositoryTest extends IntegrationTestBase {

  @Autowired private AgentApiKeyRepository repo;
  @Autowired private DSLContext dsl;

  private Long agentId;
  private Long adminId;

  @BeforeEach
  void seed() {
    long n = System.nanoTime();
    adminId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "admin-" + n)
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, "Admin")
            .set(USER.EMAIL, "admin-" + n + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    agentId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "agent-" + n)
            .setNull(USER.PASSWORD)
            .set(USER.NAME, "Agent")
            .set(USER.EMAIL, "agent-" + n + "@example.com")
            .set(USER.KIND, UserKind.AGENT)
            .returning(USER.ID)
            .fetchOne()
            .getId();
  }

  @Test
  void insert_and_find_by_user() {
    Long id = repo.insert(agentId, "ak_abc12345", "hash-1", "ci-key", adminId);
    List<AgentApiKeyResponse> keys = repo.findByUser(agentId);
    assertThat(keys).hasSize(1);
    assertThat(keys.get(0).id()).isEqualTo(id);
    assertThat(keys.get(0).label()).isEqualTo("ci-key");
    assertThat(keys.get(0).keyPrefix()).isEqualTo("ak_abc12345");
    assertThat(keys.get(0).revokedAt()).isNull();
  }

  @Test
  void find_active_by_hash_returns_only_unrevoked() {
    Long activeId = repo.insert(agentId, "ak_aaaa", "hash-active", null, adminId);
    Long revokedId = repo.insert(agentId, "ak_bbbb", "hash-revoked", null, adminId);
    dsl.update(AGENT_API_KEY)
        .set(AGENT_API_KEY.REVOKED_AT, OffsetDateTime.now())
        .where(AGENT_API_KEY.ID.eq(revokedId))
        .execute();

    Optional<ActiveKey> active = repo.findActiveByHash("hash-active");
    assertThat(active).isPresent();
    assertThat(active.get().id()).isEqualTo(activeId);
    assertThat(active.get().userId()).isEqualTo(agentId);

    assertThat(repo.findActiveByHash("hash-revoked")).isEmpty();
    assertThat(repo.findActiveByHash("hash-nope")).isEmpty();
  }

  @Test
  void revoke_sets_revoked_at_and_makes_inactive() {
    Long id = repo.insert(agentId, "ak_revoke", "h-r", "rev", adminId);
    int updated = repo.revoke(id);
    assertThat(updated).isEqualTo(1);
    assertThat(repo.findById(id).orElseThrow().revokedAt()).isNotNull();
    assertThat(repo.findActiveByHash("h-r")).isEmpty();

    // 두번째 호출은 영향 없음
    assertThat(repo.revoke(id)).isEqualTo(0);
  }

  @Test
  void touch_last_used_updates_timestamp() {
    Long id = repo.insert(agentId, "ak_touch", "h-t", null, adminId);
    assertThat(repo.findById(id).orElseThrow().lastUsedAt()).isNull();
    repo.touchLastUsed(id);
    assertThat(repo.findById(id).orElseThrow().lastUsedAt()).isNotNull();
  }
}
