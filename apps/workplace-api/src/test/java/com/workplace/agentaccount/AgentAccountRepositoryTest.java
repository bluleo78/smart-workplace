package com.workplace.agentaccount;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.agentaccount.dto.AgentAccountRow;
import com.workplace.agentaccount.repository.AgentAccountBindingRepository;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1448 AI 계정 목록 저장소(agent_account·agent_account_binding) 통합 테스트 — 삽입·조회, 원문 교체 시 버전 증가, 폐기, 묶음
 * 덮어쓰기, 계정별 AI 묶음 조회, 테넌트 격리(RLS)를 확인한다. 키 값은 모두 가짜다.
 */
@Transactional
class AgentAccountRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AgentAccountRepository accounts;
  @Autowired AgentAccountBindingRepository bindings;

  private long agentA;
  private long agentB;

  /** 워크스페이스 1 에 AI 둘을 시드한다. */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    agentA = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    agentB = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
  }

  private long newAccount(String label) {
    return accounts.insert("anthropic", label, "iv:cipher", null, null, "ACTIVE", null, null);
  }

  @Test
  void insertThenFindActive() {
    long id = newAccount("팀 계정");

    AgentAccountRow row = accounts.findActive(id).orElseThrow();

    assertThat(row.provider()).isEqualTo("anthropic");
    assertThat(row.label()).isEqualTo("팀 계정");
    assertThat(row.status()).isEqualTo("ACTIVE");
    assertThat(row.secretVersion()).isPositive();
    assertThat(row.revokedAt()).isNull();
    assertThat(row.toString()).doesNotContain("iv:cipher");
    assertThat(accounts.findAllActive()).extracting(AgentAccountRow::id).contains(id);
    assertThat(accounts.findActiveByIds(List.of(id))).containsKey(id);
  }

  /**
   * secret_version 은 1e12 부터 나온다 — runner 비밀값 버전이 옛 연결 id(ai_agent_credential.id)와 겹치지 않게(겹치면 옛 연결
   * → 계정 전환을 runner 가 모른다). runner(TypeScript) JSON 숫자 정밀도 범위(2^53 미만)도 지킨다.
   */
  @Test
  void secretVersionStartsAboveLegacyCredentialIds() {
    long id = newAccount("버전");
    long version = accounts.findActive(id).orElseThrow().secretVersion();
    assertThat(version).isGreaterThanOrEqualTo(1_000_000_000_000L).isLessThan(1L << 53);

    accounts.replaceSecret(id, "iv:again", null, null, "ACTIVE", "fp-version");
    assertThat(accounts.findActive(id).orElseThrow().secretVersion())
        .isGreaterThanOrEqualTo(1_000_000_000_000L)
        .isLessThan(1L << 53);
  }

  @Test
  void replaceSecretBumpsVersion() {
    long id = newAccount("a");
    long before = accounts.findActive(id).orElseThrow().secretVersion();

    accounts.replaceSecret(id, "iv:other", "a@example.test", Instant.now(), "ACTIVE", "fp1");

    AgentAccountRow after = accounts.findActive(id).orElseThrow();
    assertThat(after.secretVersion()).isGreaterThan(before);
    assertThat(after.accountEmail()).isEqualTo("a@example.test");
    assertThat(accounts.findActiveByFingerprint("anthropic", "fp1")).isPresent();
  }

  @Test
  void updateLabelChangesLabelOnly() {
    long id = newAccount("old");
    long version = accounts.findActive(id).orElseThrow().secretVersion();

    accounts.updateLabel(id, "new");

    AgentAccountRow row = accounts.findActive(id).orElseThrow();
    assertThat(row.label()).isEqualTo("new");
    assertThat(row.secretVersion()).isEqualTo(version);
  }

  @Test
  void revokedIsNotActive() {
    long id = newAccount("a");

    assertThat(accounts.revoke(id)).isEqualTo(1);

    assertThat(accounts.findActive(id)).isEmpty();
    assertThat(accounts.findAllActive()).extracting(AgentAccountRow::id).doesNotContain(id);
    assertThat(accounts.revoke(id)).isZero();
  }

  @Test
  void bindingUpsertReplacesAccount() {
    long first = newAccount("first");
    long second = newAccount("second");

    bindings.upsert(agentA, first, null, null, null);
    bindings.upsert(agentA, second, null, null, null);

    assertThat(bindings.findAccountId(agentA)).contains(second);
    assertThat(bindings.isInUse(first)).isFalse();
    assertThat(bindings.isInUse(second)).isTrue();
    assertThat(bindings.delete(agentA)).isEqualTo(1);
    assertThat(bindings.findAccountId(agentA)).isEmpty();
  }

  @Test
  void findAgentsByAccountsGroups() {
    long acc = newAccount("shared");
    bindings.upsert(agentA, acc, null, null, null);
    bindings.upsert(agentB, acc, null, null, null);

    Map<Long, List<Long>> grouped = bindings.findAgentsByAccounts(List.of(acc));

    assertThat(grouped.get(acc)).containsExactlyInAnyOrder(agentA, agentB);
    assertThat(bindings.findAccountIds(List.of(agentA, agentB)))
        .containsEntry(agentA, acc)
        .containsEntry(agentB, acc);
  }

  @Test
  void otherTenantRowsInvisible() {
    long acc = newAccount("mine");
    bindings.upsert(agentA, acc, null, null, null);
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");

    useTenant(tenant2);
    assertThat(accounts.findActive(acc)).isEmpty();
    assertThat(accounts.findAllActive()).isEmpty();
    assertThat(bindings.findAccountId(agentA)).isEmpty();
    assertThat(bindings.isInUse(acc)).isFalse();

    useTenant(1L);
    assertThat(accounts.findActive(acc)).isPresent();
  }
}
