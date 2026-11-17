package com.workplace.auth.oauth;

import static com.workplace.jooq.Tables.OAUTH_AUTHORIZATION_CODE;
import static com.workplace.jooq.Tables.OAUTH_CLIENT;
import static com.workplace.jooq.Tables.OAUTH_TOKEN;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.oauth.repository.OAuthClientRepository;
import com.workplace.auth.oauth.repository.OAuthCodeRepository;
import com.workplace.auth.oauth.repository.OAuthConnectionRepository;
import com.workplace.auth.oauth.repository.OAuthTokenRepository;
import com.workplace.auth.oauth.service.OAuthCleanupScheduler;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * WP-1685 — OAuth 정리 작업({@link OAuthCleanupScheduler#cleanup()}) 통합 테스트. 테스트 프로파일은 스케줄링을 끄므로(빈은 있다)
 * 메서드를 직접 부른다.
 *
 * <p>만료 24시간 경계 양쪽(25시간·23시간 전 만료)의 code·토큰, 7일 경계 양쪽(8일·6일)의 연결 없는 DCR, 연결 있는 오래된 DCR, 오래된 CIMD
 * 캐시를 심고 지워질 것만 지워지는지 본다.
 */
class OAuthCleanupSchedulerTest extends IntegrationTestBase {

  private static final long TENANT_ID = 1L;
  private static final String CALLBACK = "https://claude.ai/api/mcp/auth_callback";
  private static final String CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  @Autowired DSLContext dsl;
  @Autowired OAuthCleanupScheduler scheduler;
  @Autowired OAuthClientRepository clients;
  @Autowired OAuthConnectionRepository connections;
  @Autowired OAuthCodeRepository codes;
  @Autowired OAuthTokenRepository tokens;

  private long userId;
  private final List<Long> clientPks = new ArrayList<>();

  @BeforeEach
  void seed() {
    userId = TestFixtures.createHuman(dsl);
    TestFixtures.ensureActiveMember(dsl, userId, TENANT_ID);
  }

  @AfterEach
  void cleanup() {
    // membership·oauth_connection·code·token 은 user 삭제 CASCADE.
    dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
    dsl.deleteFrom(OAUTH_CLIENT).where(OAUTH_CLIENT.ID.in(clientPks)).execute();
  }

  @Test
  void cleanup_deletesExpiredAndUnusedDcr() {
    OffsetDateTime now = OffsetDateTime.now();
    long usedOldDcr = dcr(now.minusDays(8));
    long connectionId = connections.findOrCreateActive(userId, TENANT_ID, usedOldDcr).row().id();

    // code·토큰 — 만료 25시간 전은 지우고 23시간 전은 남긴다.
    String oldCode = code(connectionId, now.minusHours(25));
    String recentCode = code(connectionId, now.minusHours(23));
    String oldAccess = token(connectionId, "ACCESS", now.minusHours(25));
    String recentAccess = token(connectionId, "ACCESS", now.minusHours(23));
    String oldRefresh = token(connectionId, "REFRESH", now.minusHours(25));
    String liveRefresh = token(connectionId, "REFRESH", now.plusDays(30));

    // DCR — 연결 없이 8일 지난 것만 지운다. 6일 된 것·연결 있는 것·CIMD 캐시는 남긴다.
    long unusedOldDcr = dcr(now.minusDays(8));
    long unusedRecentDcr = dcr(now.minusDays(6));
    long oldCimd =
        clients
            .upsertCimd(
                "https://app.example/oauth/" + CapabilityTokens.generate("c") + ".json",
                "Cimd",
                List.of(CALLBACK),
                null,
                null,
                now.minusDays(8))
            .id();
    clientPks.add(oldCimd);
    backdateClient(oldCimd, now.minusDays(8));

    scheduler.cleanup();

    assertThat(codeExists(oldCode)).isFalse();
    assertThat(codeExists(recentCode)).isTrue();
    assertThat(tokenExists(oldAccess)).isFalse();
    assertThat(tokenExists(recentAccess)).isTrue();
    assertThat(tokenExists(oldRefresh)).isFalse();
    assertThat(tokenExists(liveRefresh)).isTrue();

    assertThat(clientExists(unusedOldDcr)).isFalse();
    assertThat(clientExists(unusedRecentDcr)).isTrue();
    assertThat(clientExists(usedOldDcr)).isTrue();
    assertThat(clientExists(oldCimd)).isTrue();
  }

  // ---- 도우미 ----

  /** created_at 을 {@code createdAt} 으로 되돌린 DCR 클라이언트. */
  private long dcr(OffsetDateTime createdAt) {
    long pk = clients.insertDcr(CapabilityTokens.generate("swc_"), "Dcr", List.of(CALLBACK)).id();
    clientPks.add(pk);
    backdateClient(pk, createdAt);
    return pk;
  }

  private void backdateClient(long pk, OffsetDateTime createdAt) {
    dsl.update(OAUTH_CLIENT)
        .set(OAUTH_CLIENT.CREATED_AT, createdAt)
        .where(OAUTH_CLIENT.ID.eq(pk))
        .execute();
  }

  /** 지정 만료 시각의 code 를 넣고 그 해시를 돌려준다. */
  private String code(long connectionId, OffsetDateTime expiresAt) {
    String hash = CapabilityTokens.sha256Hex(CapabilityTokens.generateUrlSafe(32));
    codes.insert(hash, connectionId, CALLBACK, CHALLENGE, null, expiresAt);
    return hash;
  }

  /** 지정 만료 시각의 토큰을 넣고 그 해시를 돌려준다. */
  private String token(long connectionId, String kind, OffsetDateTime expiresAt) {
    String plain = CapabilityTokens.generate("ACCESS".equals(kind) ? "swo_" : "swr_");
    String hash = CapabilityTokens.sha256Hex(plain);
    tokens.insert(connectionId, kind, hash, plain.substring(0, 12), null, expiresAt);
    return hash;
  }

  private boolean codeExists(String hash) {
    return dsl.fetchExists(OAUTH_AUTHORIZATION_CODE, OAUTH_AUTHORIZATION_CODE.CODE_HASH.eq(hash));
  }

  private boolean tokenExists(String hash) {
    return dsl.fetchExists(OAUTH_TOKEN, OAUTH_TOKEN.TOKEN_HASH.eq(hash));
  }

  private boolean clientExists(long pk) {
    return dsl.fetchExists(OAUTH_CLIENT, OAUTH_CLIENT.ID.eq(pk));
  }
}
