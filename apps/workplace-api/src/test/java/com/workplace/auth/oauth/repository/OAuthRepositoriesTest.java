package com.workplace.auth.oauth.repository;

import static com.workplace.jooq.Tables.OAUTH_CLIENT;
import static com.workplace.jooq.Tables.OAUTH_CONNECTION;
import static com.workplace.jooq.Tables.OAUTH_TOKEN;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.oauth.repository.OAuthClientRepository.ClientRow;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository.Created;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository.ListedConnection;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1685 — OAuth 인가 서버 저장소 4종 통합 테스트. 클래스 단위 {@code @Transactional} 로 각 테스트가 만든 행(사용자·테넌트·OAuth
 * 표)이 롤백돼 남지 않는다.
 */
@Transactional
class OAuthRepositoriesTest extends IntegrationTestBase {

  @Autowired private OAuthClientRepository clients;
  @Autowired private OAuthConnectionRepository connections;
  @Autowired private OAuthCodeRepository codes;
  @Autowired private OAuthTokenRepository tokens;
  @Autowired private DSLContext dsl;

  private long userId;
  private long tenantId;
  private long tenant2Id;
  private ClientRow client;

  @BeforeEach
  void seed() {
    userId = TestFixtures.createHuman(dsl);
    tenantId = TestFixtures.createTenant(dsl, "ACTIVE");
    tenant2Id = TestFixtures.createTenant(dsl, "ACTIVE");
    client =
        clients.insertDcr(
            "swc_test_" + System.nanoTime(), "테스트 앱", List.of("https://app.example/cb"));
  }

  private OffsetDateTime future() {
    return OffsetDateTime.now().plusHours(1);
  }

  private OffsetDateTime past() {
    return OffsetDateTime.now().minusHours(1);
  }

  @Test
  void findOrCreateActive_reusesActiveConnection() {
    Created first = connections.findOrCreateActive(userId, tenantId, client.id());
    Created second = connections.findOrCreateActive(userId, tenantId, client.id());
    Created otherTenant = connections.findOrCreateActive(userId, tenant2Id, client.id());

    assertThat(first.created()).isTrue();
    assertThat(second.created()).isFalse();
    assertThat(second.row().id()).isEqualTo(first.row().id());
    assertThat(otherTenant.created()).isTrue();
    assertThat(otherTenant.row().id()).isNotEqualTo(first.row().id());
  }

  @Test
  void findOrCreateActive_afterRevoke_createsNew() {
    Created first = connections.findOrCreateActive(userId, tenantId, client.id());
    assertThat(connections.revoke(first.row().id(), userId)).isTrue();

    Created again = connections.findOrCreateActive(userId, tenantId, client.id());

    assertThat(again.created()).isTrue();
    assertThat(again.row().id()).isNotEqualTo(first.row().id());
  }

  @Test
  void revoke_onlyOwnAndAlive() {
    long conn = connections.findOrCreateActive(userId, tenantId, client.id()).row().id();
    long other = TestFixtures.createHuman(dsl);

    assertThat(connections.revoke(conn, other)).isFalse();
    assertThat(isActiveConnection(conn)).isTrue();
    assertThat(connections.revoke(conn, userId)).isTrue();
    assertThat(connections.revoke(conn, userId)).isFalse();
    assertThat(isActiveConnection(conn)).isFalse();
  }

  /** WP-1685 리뷰 F6 — 인증 필터가 요청마다 부르므로 1분 안의 기록은 덮어쓰지 않고, 1분보다 오래된 기록만 갱신한다. */
  @Test
  void touchLastUsed_throttledToOncePerMinute() {
    long conn = connections.findOrCreateActive(userId, tenantId, client.id()).row().id();
    OffsetDateTime recent = OffsetDateTime.now().minusSeconds(30).truncatedTo(ChronoUnit.MICROS);
    setLastUsed(conn, recent);

    connections.touchLastUsed(conn);
    assertThat(lastUsed(conn)).as("1분 안이면 그대로").isAtSameInstantAs(recent);

    OffsetDateTime old = OffsetDateTime.now().minusMinutes(2).truncatedTo(ChronoUnit.MICROS);
    setLastUsed(conn, old);
    connections.touchLastUsed(conn);
    assertThat(lastUsed(conn)).as("1분보다 오래됐으면 갱신").isAfter(old.plusSeconds(60));
  }

  private void setLastUsed(long connectionId, OffsetDateTime at) {
    dsl.update(OAUTH_CONNECTION)
        .set(OAUTH_CONNECTION.LAST_USED_AT, at)
        .where(OAUTH_CONNECTION.ID.eq(connectionId))
        .execute();
  }

  private OffsetDateTime lastUsed(long connectionId) {
    return dsl.select(OAUTH_CONNECTION.LAST_USED_AT)
        .from(OAUTH_CONNECTION)
        .where(OAUTH_CONNECTION.ID.eq(connectionId))
        .fetchOne(OAUTH_CONNECTION.LAST_USED_AT);
  }

  @Test
  void touchLastUsed_andListActiveByUser() {
    long conn = connections.findOrCreateActive(userId, tenantId, client.id()).row().id();
    long revoked = connections.findOrCreateActive(userId, tenant2Id, client.id()).row().id();
    connections.revoke(revoked, userId);
    connections.touchLastUsed(conn);

    List<ListedConnection> list = connections.listActiveByUser(userId);

    assertThat(list).hasSize(1);
    ListedConnection c = list.get(0);
    assertThat(c.id()).isEqualTo(conn);
    assertThat(c.clientName()).isEqualTo("테스트 앱");
    assertThat(c.clientKind()).isEqualTo("DCR");
    assertThat(c.redirectUris()).containsExactly("https://app.example/cb");
    assertThat(c.tenantId()).isEqualTo(tenantId);
    assertThat(c.tenantName()).isEqualTo("fixture-tenant");
    assertThat(c.lastUsedAt()).isNotNull();
  }

  @Test
  void markUsed_codeOnlyOnce() {
    long conn = connections.findOrCreateActive(userId, tenantId, client.id()).row().id();
    codes.insert("code-hash-1", conn, "https://app.example/cb", "challenge", "res", future());

    var row = codes.findByHash("code-hash-1").orElseThrow();

    assertThat(row.connectionId()).isEqualTo(conn);
    assertThat(row.usedAt()).isNull();
    assertThat(codes.markUsed(row.id())).isTrue();
    assertThat(codes.markUsed(row.id())).isFalse();
    assertThat(codes.findByHash("code-hash-1").orElseThrow().usedAt()).isNotNull();
    assertThat(codes.findByHash("nope")).isEmpty();
  }

  @Test
  void deleteExpiredBefore_codes() {
    long conn = connections.findOrCreateActive(userId, tenantId, client.id()).row().id();
    codes.insert("old-code", conn, "https://app.example/cb", "c", null, past());
    codes.insert("new-code", conn, "https://app.example/cb", "c", null, future());

    assertThat(codes.deleteExpiredBefore(OffsetDateTime.now())).isEqualTo(1);
    assertThat(codes.findByHash("old-code")).isEmpty();
    assertThat(codes.findByHash("new-code")).isPresent();
  }

  @Test
  void markRefreshUsed_onlyOnce() {
    long conn = connections.findOrCreateActive(userId, tenantId, client.id()).row().id();
    tokens.insert(conn, "REFRESH", "refresh-hash-1", "swr_abcdefgh", "res", future());

    var row = tokens.findRefresh("refresh-hash-1").orElseThrow();

    assertThat(tokens.markRefreshUsed(row.id())).isTrue();
    assertThat(tokens.markRefreshUsed(row.id())).isFalse();
    assertThat(tokens.findRefresh("refresh-hash-1").orElseThrow().usedAt()).isNotNull();
  }

  @Test
  void findRefresh_ignoresAccessTokens() {
    long conn = connections.findOrCreateActive(userId, tenantId, client.id()).row().id();
    tokens.insert(conn, "ACCESS", "access-hash-x", "swo_abcdefgh", null, future());

    assertThat(tokens.findRefresh("access-hash-x")).isEmpty();
  }

  @Test
  void findActiveAccess_excludesExpiredRevokedAndRevokedConnection() {
    long conn = connections.findOrCreateActive(userId, tenantId, client.id()).row().id();
    OffsetDateTime now = OffsetDateTime.now();

    tokens.insert(conn, "ACCESS", "acc-ok", "swo_okokokok", null, future());
    var ok = tokens.findActiveAccess("acc-ok", now).orElseThrow();
    assertThat(ok.connectionId()).isEqualTo(conn);
    assertThat(ok.userId()).isEqualTo(userId);
    assertThat(ok.tenantId()).isEqualTo(tenantId);

    // 만료
    tokens.insert(conn, "ACCESS", "acc-expired", "swo_expired0", null, past());
    assertThat(tokens.findActiveAccess("acc-expired", now)).isEmpty();

    // 토큰 폐기
    tokens.insert(conn, "ACCESS", "acc-revoked", "swo_revoked0", null, future());
    dsl.update(OAUTH_TOKEN)
        .set(OAUTH_TOKEN.REVOKED_AT, now)
        .where(OAUTH_TOKEN.TOKEN_HASH.eq("acc-revoked"))
        .execute();
    assertThat(tokens.findActiveAccess("acc-revoked", now)).isEmpty();

    // REFRESH 종류는 액세스로 인정하지 않는다
    tokens.insert(conn, "REFRESH", "ref-as-access", "swr_refresh00", null, future());
    assertThat(tokens.findActiveAccess("ref-as-access", now)).isEmpty();

    // 연결 폐기 → 살아 있던 토큰도 거부
    connections.revoke(conn, userId);
    assertThat(tokens.findActiveAccess("acc-ok", now)).isEmpty();
  }

  @Test
  void revokeAllForConnection_revokesBothKinds() {
    long conn = connections.findOrCreateActive(userId, tenantId, client.id()).row().id();
    tokens.insert(conn, "ACCESS", "rv-access", "swo_rvrvrvrv", null, future());
    tokens.insert(conn, "REFRESH", "rv-refresh", "swr_rvrvrvrv", null, future());

    assertThat(tokens.revokeAllForConnection(conn)).isEqualTo(2);

    assertThat(tokens.findRefresh("rv-refresh").orElseThrow().revokedAt()).isNotNull();
    assertThat(tokens.findActiveAccess("rv-access", OffsetDateTime.now())).isEmpty();
    // 이미 폐기된 것은 다시 세지 않는다
    assertThat(tokens.revokeAllForConnection(conn)).isZero();
  }

  @Test
  void deleteExpiredBefore_tokens() {
    long conn = connections.findOrCreateActive(userId, tenantId, client.id()).row().id();
    tokens.insert(conn, "ACCESS", "exp-a", "swo_expaexpa", null, past());
    tokens.insert(conn, "ACCESS", "live-a", "swo_livelive", null, future());

    assertThat(tokens.deleteExpiredBefore(OffsetDateTime.now())).isEqualTo(1);
    assertThat(tokens.findActiveAccess("live-a", OffsetDateTime.now())).isPresent();
  }

  @Test
  void deleteUnusedDcrOlderThan_keepsClientsWithConnections() {
    ClientRow used =
        clients.insertDcr("swc_used_" + System.nanoTime(), "쓴 앱", List.of("https://a/cb"));
    ClientRow unused =
        clients.insertDcr("swc_unused_" + System.nanoTime(), "안 쓴 앱", List.of("https://b/cb"));
    ClientRow cimd =
        clients.upsertCimd(
            "https://cimd.example/meta.json",
            "CIMD 앱",
            List.of("https://c/cb"),
            null,
            null,
            OffsetDateTime.now());
    connections.findOrCreateActive(userId, tenantId, used.id());
    // 모든 행의 created_at 을 과거로 돌려 cutoff 이전으로 만든다(이 트랜잭션 안에서만 보이고 롤백된다).
    dsl.update(OAUTH_CLIENT).set(OAUTH_CLIENT.CREATED_AT, past().minusDays(1)).execute();

    int deleted = clients.deleteUnusedDcrOlderThan(OffsetDateTime.now().minusHours(1));

    assertThat(clients.findByClientId(used.clientId())).isPresent();
    assertThat(clients.findByClientId(unused.clientId())).isEmpty();
    // CIMD 는 캐시 항목이라 이 정리 대상이 아니다.
    assertThat(clients.findByClientId(cimd.clientId())).isPresent();
    // 테스트 시드(client) 도 연결이 없어 지워지므로 최소 2건.
    assertThat(deleted).isGreaterThanOrEqualTo(2);
  }

  @Test
  void upsertCimd_updatesExisting() {
    OffsetDateTime t1 = OffsetDateTime.now().minusMinutes(5);
    ClientRow a =
        clients.upsertCimd(
            "https://cimd.example/m.json", "이름1", List.of("https://x/cb"), "https://l/1", null, t1);
    ClientRow b =
        clients.upsertCimd(
            "https://cimd.example/m.json",
            "이름2",
            List.of("https://x/cb", "https://y/cb"),
            null,
            "https://c/",
            OffsetDateTime.now());

    assertThat(b.id()).isEqualTo(a.id());
    assertThat(b.kind()).isEqualTo("CIMD");
    assertThat(b.clientName()).isEqualTo("이름2");
    assertThat(b.redirectUris()).containsExactly("https://x/cb", "https://y/cb");
    assertThat(b.logoUri()).isNull();
    assertThat(b.clientUri()).isEqualTo("https://c/");
    assertThat(b.fetchedAt()).isAfter(a.fetchedAt());
  }

  /** 연결이 살아 있는지(폐기되지 않은 행이 있는지) — DSLContext 로 직접 본다. */
  private boolean isActiveConnection(long id) {
    return dsl.fetchExists(
        OAUTH_CONNECTION, OAUTH_CONNECTION.ID.eq(id).and(OAUTH_CONNECTION.REVOKED_AT.isNull()));
  }
}
