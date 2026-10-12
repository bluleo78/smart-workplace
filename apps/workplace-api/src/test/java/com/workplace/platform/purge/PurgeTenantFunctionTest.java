package com.workplace.platform.purge;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import com.workplace.support.PostgresTestContainer;
import com.workplace.support.TestFixtures;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * purge_tenant() SECURITY DEFINER 함수 검증 — 런타임 롤(app_tenant)이 tenant 행을 직접 지울 수 없으므로(V46) 이 함수가 유일한
 * 삭제 경로다. 비-트랜잭션: 함수가 실제로 커밋된 행을 지우는지 본다.
 */
class PurgeTenantFunctionTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;

  /** 테스트가 만든 테넌트·사용자 — 단언 실패로 중간에 끝나도 @AfterEach 가 정리하도록 생성 즉시 기록한다. */
  private final List<Long> tenantIds = new ArrayList<>();

  private final List<Long> userIds = new ArrayList<>();

  /**
   * 남은 행을 소유자 커넥션으로 정리(함수가 이미 지웠으면 0행). created_by(NO ACTION) 참조가 사용자 삭제를 막지 않도록 API 키를 먼저 지운다.
   * membership 은 user/tenant FK CASCADE 로 함께 지워진다.
   */
  @AfterEach
  void cleanup() throws Exception {
    var c = PostgresTestContainer.INSTANCE;
    try (Connection conn =
        DriverManager.getConnection(c.getJdbcUrl(), c.getUsername(), c.getPassword())) {
      Long[] users = userIds.toArray(Long[]::new);
      try (PreparedStatement ps =
          conn.prepareStatement(
              "DELETE FROM agent_api_key WHERE created_by = ANY(?) OR user_id = ANY(?)")) {
        ps.setArray(1, conn.createArrayOf("bigint", users));
        ps.setArray(2, conn.createArrayOf("bigint", users));
        ps.executeUpdate();
      }
      try (PreparedStatement ps =
          conn.prepareStatement(
              "UPDATE \"user\" SET personal_assistant_agent_id = NULL WHERE id = ANY(?)")) {
        ps.setArray(1, conn.createArrayOf("bigint", users));
        ps.executeUpdate();
      }
      try (PreparedStatement ps = conn.prepareStatement("DELETE FROM \"user\" WHERE id = ANY(?)")) {
        ps.setArray(1, conn.createArrayOf("bigint", users));
        ps.executeUpdate();
      }
      try (PreparedStatement ps = conn.prepareStatement("DELETE FROM tenant WHERE id = ANY(?)")) {
        ps.setArray(1, conn.createArrayOf("bigint", tenantIds.toArray(Long[]::new)));
        ps.executeUpdate();
      }
    }
  }

  /** 지정 상태의 테넌트를 런타임 롤로 만든다(app_tenant 는 tenant INSERT 권한이 있다). */
  private long newTenant(String status) {
    long id = TestFixtures.createTenant(dsl, status);
    tenantIds.add(id);
    return id;
  }

  /** 정리 대상으로 기록한 HUMAN 사용자. */
  private long newHuman() {
    long id = TestFixtures.createHuman(dsl);
    userIds.add(id);
    return id;
  }

  /** 정리 대상으로 기록한 AGENT 사용자. */
  private long newAgent() {
    long id = TestFixtures.createAgentNoToken(dsl);
    userIds.add(id);
    return id;
  }

  /** purge_tenant 를 런타임 롤로 호출해 반환값을 돌려준다. */
  private Boolean purge(long tenantId, Long... agentIds) {
    return dsl.select(
            DSL.field(
                "purge_tenant({0}, {1})", Boolean.class, DSL.val(tenantId), DSL.val(agentIds)))
        .fetchOne(0, Boolean.class);
  }

  /**
   * PURGING 테넌트: tenant·membership 과 이 테넌트 전용 AGENT 를 지우고, 사람 계정은 남기며 개인 비서 링크를 끊는다(주인 사람이 이 테넌트에만
   * 소속된 경우).
   */
  @Test
  void deletesTenantMembershipAndAgent_whenPurging() {
    long tenantId = newTenant("PURGING");
    long human = newHuman();
    long agent = newAgent();
    // 사람의 개인 비서가 이 AGENT 를 가리켜도(NO ACTION FK) 함수가 끊고 삭제해야 한다.
    dsl.update(USER)
        .set(USER.PERSONAL_ASSISTANT_AGENT_ID, agent)
        .where(USER.ID.eq(human))
        .execute();
    TestFixtures.addMember(dsl, human, tenantId);
    TestFixtures.addMember(dsl, agent, tenantId);

    assertThat(purge(tenantId, agent)).isTrue();
    assertThat(dsl.fetchExists(TENANT, TENANT.ID.eq(tenantId))).isFalse();
    assertThat(dsl.fetchExists(MEMBERSHIP, MEMBERSHIP.TENANT_ID.eq(tenantId))).isFalse();
    assertThat(dsl.fetchExists(USER, USER.ID.eq(agent))).isFalse();
    assertThat(dsl.fetchExists(USER, USER.ID.eq(human))).isTrue();
    assertThat(
            dsl.select(USER.PERSONAL_ASSISTANT_AGENT_ID)
                .from(USER)
                .where(USER.ID.eq(human))
                .fetchOne(0, Long.class))
        .isNull();
  }

  /**
   * 개인 비서 AGENT 는 사용자 단위 전역 계정이다 — 멤버십은 처음 등록한 테넌트에만 있지만 다른 테넌트에서도 사용자 기준으로 쓰인다. 주인(사람)이 다른 테넌트에도
   * 소속돼 있으면, 비서가 영구 삭제 대상 테넌트에만 멤버여도 계정·링크는 남고 이 테넌트 멤버십만 사라져야 한다.
   */
  @Test
  void keepsPersonalAssistant_whenOwnerBelongsToAnotherTenant() {
    long tenantId = newTenant("PURGING");
    long other = newTenant("ACTIVE");
    long human = newHuman();
    long assistant = newAgent();
    dsl.update(USER)
        .set(USER.PERSONAL_ASSISTANT_AGENT_ID, assistant)
        .where(USER.ID.eq(human))
        .execute();
    TestFixtures.addMember(dsl, human, tenantId);
    TestFixtures.addMember(dsl, human, other);
    TestFixtures.addMember(dsl, assistant, tenantId); // 비서 멤버십은 처음 등록한 테넌트에만 있다

    assertThat(purge(tenantId, assistant)).isTrue();
    assertThat(dsl.fetchExists(TENANT, TENANT.ID.eq(tenantId))).isFalse();
    assertThat(dsl.fetchExists(USER, USER.ID.eq(assistant))).isTrue();
    assertThat(
            dsl.select(USER.PERSONAL_ASSISTANT_AGENT_ID)
                .from(USER)
                .where(USER.ID.eq(human))
                .fetchOne(0, Long.class))
        .isEqualTo(assistant);
    assertThat(
            dsl.fetchExists(
                MEMBERSHIP,
                MEMBERSHIP.USER_ID.eq(assistant).and(MEMBERSHIP.TENANT_ID.eq(tenantId))))
        .isFalse();
  }

  /** PURGING 이 아니면(예: DELETED — 복원 가능) 아무것도 지우지 않고 FALSE 를 돌려준다. */
  @Test
  void noop_whenNotPurging() {
    long tenantId = newTenant("DELETED");
    assertThat(purge(tenantId)).isFalse();
    assertThat(dsl.fetchExists(TENANT, TENANT.ID.eq(tenantId))).isTrue();
  }

  /** 다른 테넌트에도 소속된 AGENT 는 공유 계정이므로 삭제 대상에서 빠진다. */
  @Test
  void keepsAgent_whenMemberOfAnotherTenant() {
    long tenantId = newTenant("PURGING");
    long other = newTenant("ACTIVE");
    long agent = newAgent();
    TestFixtures.addMember(dsl, agent, tenantId);
    TestFixtures.addMember(dsl, agent, other);

    assertThat(purge(tenantId, agent)).isTrue();
    assertThat(dsl.fetchExists(TENANT, TENANT.ID.eq(tenantId))).isFalse();
    assertThat(dsl.fetchExists(USER, USER.ID.eq(agent))).isTrue();
  }

  /** 이 테넌트 멤버가 아닌 AGENT id 가 넘어와도(호출자 실수·악용) 지우지 않는다 — 함수는 호출자가 준 id 를 그대로 믿지 않는다. */
  @Test
  void keepsAgent_whenNotMemberOfPurgingTenant() {
    long tenantId = newTenant("PURGING");
    long stranger = newAgent(); // 어느 테넌트에도 소속되지 않은(고아) AGENT

    assertThat(purge(tenantId, stranger)).isTrue();
    assertThat(dsl.fetchExists(TENANT, TENANT.ID.eq(tenantId))).isFalse();
    assertThat(dsl.fetchExists(USER, USER.ID.eq(stranger))).isTrue();
  }

  /**
   * NO ACTION 참조에 막힌 AGENT 는 자기만 건너뛴다 — 같은 테넌트의 다른 AGENT 삭제와 테넌트 삭제는 진행돼야 한다(하나 때문에 전부 남거나 영구 실패하지
   * 않게). 막는 참조: 다른 사용자의 agent_api_key 를 이 AGENT 가 발급한 것으로 기록(created_by NOT NULL, ON DELETE NO
   * ACTION).
   */
  @Test
  void skipsOnlyBlockedAgent_whenReferencedElsewhere() {
    long tenantId = newTenant("PURGING");
    long blocked = newAgent();
    long free = newAgent();
    long keyOwner = newAgent(); // 테넌트와 무관한 사용자 — 이 사람의 키가 blocked 를 created_by 로 가리킨다.
    TestFixtures.addMember(dsl, blocked, tenantId);
    TestFixtures.addMember(dsl, free, tenantId);
    dsl.insertInto(AGENT_API_KEY)
        .set(AGENT_API_KEY.USER_ID, keyOwner)
        .set(AGENT_API_KEY.KEY_PREFIX, "purgetst")
        .set(AGENT_API_KEY.KEY_HASH, "h-" + UUID.randomUUID())
        .set(AGENT_API_KEY.CREATED_BY, blocked)
        .execute();
    // 막힌 AGENT 자신의 인증 수단 — 계정이 남더라도 더는 인증에 쓰이지 않도록 지워져야 한다.
    dsl.insertInto(AGENT_API_KEY)
        .set(AGENT_API_KEY.USER_ID, blocked)
        .set(AGENT_API_KEY.KEY_PREFIX, "purgeown")
        .set(AGENT_API_KEY.KEY_HASH, "h-" + UUID.randomUUID())
        .set(AGENT_API_KEY.CREATED_BY, blocked)
        .execute();
    dsl.execute(
        "INSERT INTO ai_agent_credential (user_id, encrypted_token, created_by) VALUES (?, 'enc', ?)",
        blocked,
        blocked);

    assertThat(purge(tenantId, blocked, free)).isTrue();
    assertThat(dsl.fetchExists(TENANT, TENANT.ID.eq(tenantId))).isFalse();
    assertThat(dsl.fetchExists(USER, USER.ID.eq(blocked))).isTrue();
    assertThat(dsl.fetchExists(USER, USER.ID.eq(free))).isFalse();
    // 남은 계정은 비활성화돼(is_active=false) 어떤 인증 경로로도 쓸 수 없다.
    assertThat(
            dsl.select(USER.IS_ACTIVE)
                .from(USER)
                .where(USER.ID.eq(blocked))
                .fetchOne(0, Boolean.class))
        .isFalse();
    // 남은 계정은 인증 수단(API 키·OAuth 자격)이 모두 제거돼 고아 계정으로 로그인할 수 없다.
    assertThat(dsl.fetchExists(AGENT_API_KEY, AGENT_API_KEY.USER_ID.eq(blocked))).isFalse();
    assertThat(
            dsl.fetchExists(
                DSL.selectOne()
                    .from("ai_agent_credential")
                    .where(DSL.field("user_id").eq(blocked))))
        .isFalse();
  }
}
