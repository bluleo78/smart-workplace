package com.workplace.auth.service;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_API_TOKEN;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.dto.IssueUserTokenRequest;
import com.workplace.auth.dto.UserApiTokenResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 개인 API 토큰·에이전트 API 키 개수 상한과 토큰 목록 정리(WP-818).
 *
 * <p>쓸 수 있는(회수·만료되지 않은) 토큰·키는 소유자당 20개까지다 — 넘으면 400 으로 거절하고, 동시에 발급해도 20개를 넘지 않는다. 토큰 목록은 쓸 수 있는 것
 * 전부와, 회수·만료된 것 중 최근 30일 것만 보여 준다(DB 행은 감사용으로 남는다). 동시 발급을 보려고 트랜잭션을 커밋하므로 만든 사용자를 지워 정리한다.
 */
class ApiTokenLimitTest extends IntegrationTestBase {

  @Autowired UserApiTokenService tokenService;
  @Autowired AgentApiKeyService agentKeyService;

  private final List<Long> users = new ArrayList<>();
  private long human;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    human = user();
  }

  @AfterEach
  void cleanup() {
    // 키의 created_by 는 CASCADE 가 아니라 사용자보다 먼저 지운다.
    baseDsl.deleteFrom(AGENT_API_KEY).where(AGENT_API_KEY.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
    TenantContext.clear();
  }

  private long user() {
    String s = UUID.randomUUID().toString().substring(0, 8);
    long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, "pat-" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "pat")
            .set(USER.EMAIL, "pat-" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    TestFixtures.addMember(baseDsl, id, 1L);
    users.add(id);
    return id;
  }

  private long issue(String name) {
    return tokenService.issue(human, new IssueUserTokenRequest(name, null)).id();
  }

  /** 회수·만료 시각을 지정한 토큰 행을 직접 넣는다 — 발급 API 는 지난 만료일을 받지 않는다. */
  private long seedToken(String name, OffsetDateTime expiresAt, OffsetDateTime revokedAt) {
    return baseDsl
        .insertInto(USER_API_TOKEN)
        .set(USER_API_TOKEN.USER_ID, human)
        .set(USER_API_TOKEN.TENANT_ID, 1L)
        .set(USER_API_TOKEN.NAME, name)
        .set(USER_API_TOKEN.TOKEN_PREFIX, "swp_seed")
        .set(USER_API_TOKEN.TOKEN_HASH, UUID.randomUUID().toString())
        .set(USER_API_TOKEN.EXPIRES_AT, expiresAt)
        .set(USER_API_TOKEN.REVOKED_AT, revokedAt)
        .returning(USER_API_TOKEN.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void 쓸_수_있는_토큰이_20개면_더_발급하지_않고_하나를_회수하면_다시_발급된다() {
    List<Long> ids = new ArrayList<>();
    for (int i = 0; i < 20; i++) ids.add(issue("t" + i));

    assertThatThrownBy(() -> issue("t20"))
        .isInstanceOf(IllegalArgumentException.class)
        // WP-835: 개인 토큰 화면의 버튼·확인창은 「폐기」다 — 안내도 같은 말을 쓴다(AI 키 화면은 「회수」라 그대로).
        .hasMessage("개인 API 토큰은 20개까지 쓸 수 있습니다. 쓰지 않는 토큰을 폐기한 뒤 다시 발급하세요");

    tokenService.revoke(human, ids.get(0));
    assertThat(issue("again")).isPositive();
  }

  @Test
  void 회수되거나_만료된_토큰은_상한에_세지_않는다() {
    OffsetDateTime now = OffsetDateTime.now();
    for (int i = 0; i < 5; i++) seedToken("revoked" + i, null, now.minusDays(1));
    for (int i = 0; i < 5; i++) seedToken("expired" + i, now.minusDays(1), null);
    for (int i = 0; i < 20; i++) issue("t" + i);
    assertThatThrownBy(() -> issue("t20")).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void 동시에_발급해도_쓸_수_있는_토큰은_20개를_넘지_않는다() throws Exception {
    for (int i = 0; i < 15; i++) issue("t" + i);
    ExecutorService pool = Executors.newFixedThreadPool(10);
    try {
      List<Callable<Boolean>> calls = new ArrayList<>();
      for (int i = 0; i < 20; i++) {
        String name = "c" + i;
        calls.add(
            () -> {
              TenantContext.set(1L);
              try {
                issue(name);
                return true;
              } catch (IllegalArgumentException e) {
                return false;
              } finally {
                TenantContext.clear();
              }
            });
      }
      long ok = 0;
      for (Future<Boolean> f : pool.invokeAll(calls)) if (f.get()) ok++;
      assertThat(ok).isEqualTo(5);
    } finally {
      pool.shutdownNow();
    }
    assertThat(baseDsl.fetchCount(USER_API_TOKEN, USER_API_TOKEN.USER_ID.eq(human))).isEqualTo(20);
  }

  @Test
  void 목록은_쓸_수_있는_토큰과_최근_30일_안에_회수_만료된_토큰만_보여준다() {
    OffsetDateTime now = OffsetDateTime.now();
    long active = issue("active");
    long future = seedToken("future", now.plusDays(10), null);
    long revokedRecent = seedToken("revokedRecent", null, now.minusDays(29));
    long expiredRecent = seedToken("expiredRecent", now.minusDays(29), null);
    seedToken("revokedOld", null, now.minusDays(31));
    seedToken("expiredOld", now.minusDays(31), null);
    seedToken("revokedOldButExpiresLater", now.plusDays(100), now.minusDays(40));

    assertThat(tokenService.list(human))
        .extracting(UserApiTokenResponse::id)
        .containsExactlyInAnyOrder(active, future, revokedRecent, expiredRecent);
  }

  @Test
  void 에이전트_API_키도_쓸_수_있는_것이_20개면_더_발급하지_않는다() {
    long admin = user();
    long agent = TestFixtures.createAgentNoToken(baseDsl);
    TestFixtures.addMember(baseDsl, agent, 1L);
    users.add(agent);
    List<Long> keys = new ArrayList<>();
    for (int i = 0; i < 20; i++) {
      keys.add(agentKeyService.issue(admin, agent, new IssueAgentKeyRequest("k" + i)).id());
    }
    assertThatThrownBy(() -> agentKeyService.issue(admin, agent, new IssueAgentKeyRequest("k20")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("AI 에이전트 API 키는 20개까지 쓸 수 있습니다. 쓰지 않는 키를 회수한 뒤 다시 발급하세요");
    agentKeyService.revoke(admin, agent, keys.get(0));
    assertThat(agentKeyService.issue(admin, agent, new IssueAgentKeyRequest("again")).id())
        .isPositive();
    assertThat(
            baseDsl.fetchCount(
                AGENT_API_KEY,
                AGENT_API_KEY.USER_ID.eq(agent).and(AGENT_API_KEY.REVOKED_AT.isNull())))
        .isEqualTo(20);
  }
}
