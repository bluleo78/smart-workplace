package com.workplace.auth.sso;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_EXTERNAL_IDENTITY;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.PostgresTestContainer;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.oauth2.jwt.Jwt;

/** 같은 Microsoft 계정의 동시 최초 로그인 — 둘 다 같은 사용자로 결정되고 연결은 1건. */
class SsoUserResolverConcurrencyTest extends SsoIntegrationTestBase {

  @Autowired SsoUserResolver resolver;
  @Autowired DSLContext dsl;

  long userId;
  long tenantId;

  /**
   * 비-트랜잭션 테스트라 커밋된 시드를 직접 지운다. 사용자 삭제는 연결·멤버십을 FK CASCADE 로 함께 지운다. tenant 삭제는 런타임 롤 (app_tenant)에
   * V46 이 REVOKE 했으므로 소유자(app) 커넥션으로 수행한다.
   */
  @AfterEach
  void cleanup() throws Exception {
    dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
    var c = PostgresTestContainer.INSTANCE;
    try (Connection conn =
            DriverManager.getConnection(c.getJdbcUrl(), c.getUsername(), c.getPassword());
        PreparedStatement ps = conn.prepareStatement("DELETE FROM tenant WHERE id = ?")) {
      ps.setLong(1, tenantId);
      ps.executeUpdate();
    }
  }

  @Test
  void concurrentFirstLogin_linksOnce() throws Exception {
    String email = SsoTestData.uniqueEmail("race");
    tenantId = SsoTestData.tenant(dsl, true);
    userId = SsoTestData.user(dsl, email, null);
    SsoTestData.member(dsl, userId, tenantId);
    Jwt jwt =
        new Jwt(
            "t",
            Instant.now(),
            Instant.now().plusSeconds(60),
            Map.of("alg", "RS256"),
            Map.of(
                "tid",
                "11111111-2222-3333-4444-555555555555",
                "oid",
                "oid-race",
                "sub",
                "s",
                "upn",
                email));

    ExecutorService pool = Executors.newFixedThreadPool(4);
    CountDownLatch go = new CountDownLatch(1);
    List<Future<Long>> results = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      results.add(
          pool.submit(
              () -> {
                go.await();
                return resolver.resolve(jwt).user().id();
              }));
    }
    go.countDown();
    for (Future<Long> f : results) assertThat(f.get()).isEqualTo(userId);
    pool.shutdown();

    assertThat(dsl.fetchCount(USER_EXTERNAL_IDENTITY, USER_EXTERNAL_IDENTITY.USER_ID.eq(userId)))
        .isEqualTo(1);
  }
}
