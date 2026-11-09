package com.workplace.agentaccount.refresh;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.global.security.EncryptionService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.tenant.repository.TenantRepository;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.client.RestClient;

/**
 * WP-1450 ChatGPT 로그인 서버 갱신 통합 테스트 — 대상 선정(만료 임박·NEEDS_CHECK·폐기 제외), 성공 병합·secret_version
 * 유지·login_revision 증가, 영구/일시 실패 처리, 응답 중 원문 교체 경합, 동시 갱신 임대, Gen:iA 만료 표시, 평문 토큰이 로그·기록에 없음을 확인한다.
 *
 * <p>서비스는 가짜 토큰 서버(루프백)를 가리키는 클라이언트로 직접 만들어 컨텍스트 캐시를 깨지 않는다. 동시성·응답 중 경합은 다른 스레드(커넥션)에서 보여야 하므로
 * 커밋하는 (비-@Transactional) 테스트이고, 만든 계정은 테스트가 정리한다.
 */
class LoginRefreshServiceTest extends IntegrationTestBase {

  private static final long TENANT = 1L;
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final String OLD_REFRESH = "rt-OLD-SECRET-VALUE";

  @Autowired DSLContext dsl;
  @Autowired AgentAccountRepository accounts;
  @Autowired LoginRefreshRepository refreshes;
  @Autowired EncryptionService encryption;
  @Autowired TenantRepository tenantRepository;

  private FakeTokenServer server;
  private LoginRefreshService service;
  private final List<Long> created = new ArrayList<>();
  private ListAppender<ILoggingEvent> logs;

  /** 본문 로그가 나올 수 있는 HTTP 로거들. */
  private static final List<String> DEBUG_LOGGERS =
      List.of("org.springframework.web.client", "org.springframework.http");

  private final Map<String, Level> savedLevels = new java.util.HashMap<>();

  @BeforeEach
  void setUp() throws Exception {
    server = new FakeTokenServer();
    ChatgptTokenClient client = new ChatgptTokenClient(RestClient.create(), server.url());
    var props =
        new LoginRefreshProperties(
            true, null, Duration.ofDays(5), server.url(), null, null, Duration.ofSeconds(30), null);
    service =
        new LoginRefreshService(
            tenantRepository, accounts, refreshes, encryption, client, props, txManager);
    logs = new ListAppender<>();
    logs.start();
    // 본문 로그가 새는지 보려면 HTTP 클라이언트 쪽 로거를 DEBUG 로 올려야 한다(Spring RestClient 의 「Writing [...]」). Apache
    // wire 로그는 운영에서 켜지 않는 별도 로거라 올리지 않는다.
    // 루트가 아니라 이 로거들만 올리고 tearDown 에서 원래 수준으로 되돌린다 — 다른 테스트로 새지 않게.
    for (String name : DEBUG_LOGGERS) {
      Logger l = (Logger) LoggerFactory.getLogger(name);
      savedLevels.put(name, l.getLevel());
      l.setLevel(Level.DEBUG);
    }
    ((Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME)).addAppender(logs);
  }

  @AfterEach
  void tearDown() {
    ((Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME)).detachAppender(logs);
    for (var e : savedLevels.entrySet()) {
      ((Logger) LoggerFactory.getLogger(e.getKey())).setLevel(e.getValue());
    }
    server.close();
    cleanupInTenant(
        TENANT,
        () -> {
          for (Long id : created) {
            dsl.execute("DELETE FROM agent_account_login_refresh WHERE account_id = ?", id);
            dsl.execute("DELETE FROM agent_account WHERE id = ?", id);
          }
        });
  }

  /** exp(초)를 가진 가짜 JWT — 서명은 의미 없다. */
  private static String jwt(Instant exp) {
    Base64.Encoder enc = Base64.getUrlEncoder().withoutPadding();
    String header = enc.encodeToString("{\"alg\":\"none\"}".getBytes(StandardCharsets.UTF_8));
    String payload =
        enc.encodeToString(
            ("{\"exp\":" + exp.getEpochSecond() + "}").getBytes(StandardCharsets.UTF_8));
    return header + "." + payload + ".sig";
  }

  /** account_id·id_token·다른 최상위 칸을 가진 Codex auth.json. */
  private static String authJson(Instant accessExp, Instant lastRefresh) {
    return "{\"OPENAI_API_KEY\":null,\"tokens\":{\"id_token\":\"id-old\",\"access_token\":\""
        + jwt(accessExp)
        + "\",\"refresh_token\":\""
        + OLD_REFRESH
        + "\",\"account_id\":\"acct-1\"},\"last_refresh\":\""
        + lastRefresh
        + "\"}";
  }

  /** 서버 갱신 준비(server_refresh_ready)가 true 인 계정 — 사람이 넣은 계정과 같다. */
  private long account(String provider, String secret, String status) {
    return account(provider, secret, status, true);
  }

  private long account(String provider, String secret, String status, boolean ready) {
    long id =
        callInTenant(
            TENANT,
            () ->
                accounts.insert(
                    provider,
                    provider + "-계정",
                    encryption.encrypt(secret),
                    null,
                    Instant.now().minus(Duration.ofDays(6)),
                    status,
                    null,
                    null,
                    ready));
    created.add(id);
    return id;
  }

  private Map<String, Object> row(long id) {
    return callInTenant(
        TENANT,
        () ->
            dsl.fetchOne(
                    "SELECT status, secret_version, login_revision, last_refreshed_at, encrypted_secret"
                        + " FROM agent_account WHERE id = ?",
                    id)
                .intoMap());
  }

  private JsonNode secret(long id) throws Exception {
    return JSON.readTree(encryption.decrypt((String) row(id).get("encrypted_secret")));
  }

  private Map<String, Object> refreshRow(long id) {
    return callInTenant(
        TENANT,
        () ->
            dsl.fetchOptional(
                    "SELECT error_code, error_message, attempted_at, succeeded_at, lease_until"
                        + " FROM agent_account_login_refresh WHERE account_id = ?",
                    id)
                .map(r -> r.intoMap())
                .orElse(null));
  }

  private static Instant inDays(long d) {
    return Instant.now().plus(Duration.ofDays(d));
  }

  @Test
  void dueAccount_isRefreshed_mergedAndVersionKept() throws Exception {
    long id =
        account("chatgpt", authJson(inDays(4), Instant.now().minus(Duration.ofDays(6))), "ACTIVE");
    long versionBefore = (Long) row(id).get("secret_version");
    server.responseBody = "{\"access_token\":\"at-NEW\",\"refresh_token\":\"rt-NEW\"}";

    int attempted = service.refreshDue();

    assertThat(attempted).isEqualTo(1);
    assertThat(server.requests).hasSize(1);
    assertThat(server.requests.get(0).body()).contains(OLD_REFRESH);
    JsonNode s = secret(id);
    assertThat(s.at("/tokens/access_token").asText()).isEqualTo("at-NEW");
    assertThat(s.at("/tokens/refresh_token").asText()).isEqualTo("rt-NEW");
    // 응답에 없던 칸·다른 최상위 칸은 그대로.
    assertThat(s.at("/tokens/id_token").asText()).isEqualTo("id-old");
    assertThat(s.at("/tokens/account_id").asText()).isEqualTo("acct-1");
    assertThat(s.has("OPENAI_API_KEY")).isTrue();
    Instant lastRefresh = Instant.parse(s.get("last_refresh").asText());
    assertThat(lastRefresh).isAfter(Instant.now().minus(Duration.ofMinutes(1)));
    var r = row(id);
    assertThat(r.get("secret_version")).isEqualTo(versionBefore);
    assertThat(r.get("login_revision")).isEqualTo(1L);
    assertThat(r.get("status")).isEqualTo("ACTIVE");
    assertThat(refreshRow(id).get("succeeded_at")).isNotNull();
    assertThat(refreshRow(id).get("lease_until")).isNull();
  }

  @Test
  void notDue_neededCheck_andRevoked_areNotCalled() {
    account("chatgpt", authJson(inDays(6), Instant.now()), "ACTIVE");
    account("chatgpt", authJson(inDays(1), Instant.now()), "NEEDS_CHECK");
    long revoked = account("chatgpt", authJson(inDays(1), Instant.now()), "ACTIVE");
    callInTenant(TENANT, () -> accounts.revoke(revoked));

    int attempted = service.refreshDue();

    assertThat(attempted).isZero();
    assertThat(server.requests).isEmpty();
  }

  @Test
  void permanentFailure_marksReloginRequired_secretUntouched() throws Exception {
    long id = account("chatgpt", authJson(inDays(1), Instant.now()), "ACTIVE");
    String before = (String) row(id).get("encrypted_secret");
    server.status = 400;
    server.responseBody = "{\"error\":{\"code\":\"refresh_token_reused\"}}";

    service.refreshDue();

    var r = row(id);
    assertThat(r.get("status")).isEqualTo("RELOGIN_REQUIRED");
    assertThat(r.get("encrypted_secret")).isEqualTo(before);
    assertThat(r.get("login_revision")).isEqualTo(0L);
    var rr = refreshRow(id);
    assertThat(rr.get("error_code")).isEqualTo("refresh_token_reused");
    assertThat(rr.get("lease_until")).isNull();
  }

  /**
   * 영구 실패 뒤 사용량 조회 성공이 상태를 ACTIVE 로 되돌려도(직접 UPDATE 로 흉내) 다음 갱신 회차는 죽은 갱신 토큰으로 외부 호출을 하지 않는다 — 영구
   * 실패가 같은 저장에서 server_refresh_ready 를 내리기 때문. 사람이 원문을 교체하거나 Pod 가 더 새 로그인을 올려야 다시 선다.
   */
  @Test
  void permanentFailure_thenUsageRestoresActive_nextCycleMakesNoCall() {
    long id = account("chatgpt", authJson(inDays(1), Instant.now()), "ACTIVE");
    server.status = 400;
    server.responseBody = "{\"error\":{\"code\":\"refresh_token_reused\"}}";

    service.refreshDue();

    assertThat(row(id).get("status")).isEqualTo("RELOGIN_REQUIRED");
    assertThat(
            callInTenant(
                TENANT,
                () ->
                    dsl.fetchValue(
                        "SELECT server_refresh_ready FROM agent_account WHERE id = ?", id)))
        .isEqualTo(false);

    // 사용량 조회 성공(AgentAccountUsageCollector)이 ACTIVE 로 되돌린 것과 같다.
    callInTenant(
        TENANT, () -> dsl.execute("UPDATE agent_account SET status = 'ACTIVE' WHERE id = ?", id));
    server.requests.clear();
    server.status = 200;
    server.responseBody = "{\"access_token\":\"at-NEW\",\"refresh_token\":\"rt-NEW\"}";

    assertThat(service.refreshDue()).isZero();
    service.refreshOne(TENANT, id);
    assertThat(server.requests).isEmpty();
  }

  /**
   * access token 수명이 refresh-before 보다 짧아도, 방금 갱신했으면 min-interval 동안은 다시 갱신하지 않는다 — 매 시간 갱신 방지. 다만
   * access token 이 이미 만료됐으면 min-interval 안이라도 갱신한다.
   */
  @Test
  void shortLivedToken_isNotRefreshedAgainWithinMinInterval_unlessExpired() {
    long id = account("chatgpt", authJson(inDays(1), Instant.now()), "ACTIVE");
    // 새 access token 도 수명 1일 — refresh-before(5일) 안쪽이라 exp 만 보면 곧바로 다시 갱신할 때다.
    server.responseBody =
        "{\"access_token\":\"" + jwt(inDays(1)) + "\",\"refresh_token\":\"rt-NEW\"}";

    assertThat(service.refreshDue()).isEqualTo(1);
    assertThat(server.requests).hasSize(1);

    // 다음 회차 — 방금(last_refreshed_at) 갱신했으니 호출하지 않는다.
    assertThat(service.refreshDue()).isZero();
    service.refreshOne(TENANT, id);
    assertThat(server.requests).hasSize(1);

    // access token 이 이미 만료된 원문이면 min-interval 안이라도 갱신한다.
    callInTenant(
        TENANT,
        () ->
            dsl.execute(
                "UPDATE agent_account SET encrypted_secret = ? WHERE id = ?",
                encryption.encrypt(
                    authJson(Instant.now().minus(Duration.ofMinutes(5)), Instant.now())),
                id));
    assertThat(service.refreshDue()).isEqualTo(1);
    assertThat(server.requests).hasSize(2);
  }

  @Test
  void transientFailure_keepsStatus_recordsOnly() {
    long id = account("chatgpt", authJson(inDays(1), Instant.now()), "ACTIVE");
    server.status = 500;

    service.refreshDue();

    assertThat(row(id).get("status")).isEqualTo("ACTIVE");
    assertThat(refreshRow(id).get("error_code")).isEqualTo("http_500");
    assertThat(row(id).get("login_revision")).isEqualTo(0L);
  }

  @Test
  void secretReplacedDuringCall_resultDiscarded() throws Exception {
    long id = account("chatgpt", authJson(inDays(1), Instant.now()), "ACTIVE");
    String human = authJson(inDays(10), Instant.now()).replace("acct-1", "acct-HUMAN");
    server.responseBody = "{\"access_token\":\"at-NEW\",\"refresh_token\":\"rt-NEW\"}";
    // 가짜 서버가 응답하는 동안 사람이 원문을 교체한 것처럼 secret_version 을 바꾼다.
    server.onRequest =
        () ->
            callInTenant(
                TENANT,
                () ->
                    dsl.execute(
                        "UPDATE agent_account SET encrypted_secret = ?,"
                            + " secret_version = nextval('agent_account_secret_version_seq') WHERE id = ?",
                        encryption.encrypt(human),
                        id));

    service.refreshOne(TENANT, id);

    JsonNode s = secret(id);
    assertThat(s.at("/tokens/account_id").asText()).isEqualTo("acct-HUMAN");
    assertThat(s.at("/tokens/access_token").asText()).doesNotContain("at-NEW");
    assertThat(row(id).get("login_revision")).isEqualTo(0L);
    assertThat(refreshRow(id).get("lease_until")).isNull();
  }

  @Test
  void concurrentRefreshOne_sendsOneRequest() throws Exception {
    long id = account("chatgpt", authJson(inDays(1), Instant.now()), "ACTIVE");
    server.responseBody = "{\"access_token\":\"at-NEW\",\"refresh_token\":\"rt-NEW\"}";
    server.delayMillis = 800;
    CountDownLatch start = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      List<Future<?>> fs = new ArrayList<>();
      for (int i = 0; i < 2; i++) {
        fs.add(
            pool.submit(
                () -> {
                  start.await();
                  service.refreshOne(TENANT, id);
                  return null;
                }));
      }
      start.countDown();
      for (Future<?> f : fs) f.get();
    } finally {
      pool.shutdownNow();
    }

    assertThat(server.requests).hasSize(1);
    assertThat(row(id).get("login_revision")).isEqualTo(1L);
  }

  @Test
  void genia_expiredBecomesReloginRequired_futureStays_neverCalled() {
    long past =
        account(
            "genia",
            "{\"genia\":{\"type\":\"oauth\",\"refresh\":\"x\",\"expires\":"
                + Instant.now().minusSeconds(60).toEpochMilli()
                + "}}",
            "ACTIVE");
    long future =
        account(
            "genia",
            "{\"genia\":{\"type\":\"oauth\",\"refresh\":\"x\",\"expires\":"
                + Instant.now().plusSeconds(3600).toEpochMilli()
                + "}}",
            "ACTIVE");

    service.refreshDue();

    assertThat(row(past).get("status")).isEqualTo("RELOGIN_REQUIRED");
    assertThat(row(future).get("status")).isEqualTo("ACTIVE");
    assertThat(server.requests).isEmpty();
  }

  @Test
  void tokensNeverAppearInLogsOrRecords() throws Exception {
    long id = account("chatgpt", authJson(inDays(1), Instant.now()), "ACTIVE");
    server.status = 500;
    // 서버가 요청 토큰을 응답에 되돌려 줘도 기록·로그에 새지 않아야 한다.
    server.responseBody = "{\"error\":\"echo " + OLD_REFRESH + "\"}";

    service.refreshDue();
    server.status = 400;
    server.responseBody = "{\"error\":\"invalid_grant\",\"detail\":\"" + OLD_REFRESH + "\"}";
    service.refreshOne(TENANT, id);

    assertNoTokenLeak(id);
    // 요청이 실제로 나갔고 HTTP 로그가 켜져 있었는지 — 로그가 비어 있으면 위 검사가 아무것도 보지 못한 것이다.
    assertThat(server.requests).hasSize(2);
    assertThat(logs.list).anyMatch(e -> e.getLevel() == Level.DEBUG);
  }

  /** 영구 실패(401) 응답의 error 가 64자를 넘거나 토큰을 되돌려 줘도 RELOGIN_REQUIRED 가 저장되고 코드는 http_401 로 대신한다. */
  @Test
  void unsafeErrorCode_isReplaced_andStatusStillSaved() throws Exception {
    long id = account("chatgpt", authJson(inDays(1), Instant.now()), "ACTIVE");
    server.status = 401;
    server.responseBody = "{\"error\":\"" + "x".repeat(200) + "\"}";

    service.refreshOne(TENANT, id);

    assertThat(row(id).get("status")).isEqualTo("RELOGIN_REQUIRED");
    assertThat(refreshRow(id).get("error_code")).isEqualTo("http_401");

    long id2 = account("chatgpt", authJson(inDays(1), Instant.now()), "ACTIVE");
    server.responseBody = "{\"error\":\"" + OLD_REFRESH + "\"}";

    service.refreshOne(TENANT, id2);

    assertThat(row(id2).get("status")).isEqualTo("RELOGIN_REQUIRED");
    assertThat(refreshRow(id2).get("error_code")).isEqualTo("http_401");
    assertNoTokenLeak(id2);
  }

  /** 400 의 알 수 없는 긴 error 는 일시 실패(Codex 와 같음) — 코드는 http_400. */
  @Test
  void unknownLongError400_isTransient_withSafeCode() throws Exception {
    long id = account("chatgpt", authJson(inDays(1), Instant.now()), "ACTIVE");
    server.status = 400;
    server.responseBody = "{\"error\":\"" + "x".repeat(200) + OLD_REFRESH + "\"}";

    service.refreshOne(TENANT, id);

    assertThat(row(id).get("status")).isEqualTo("ACTIVE");
    assertThat(refreshRow(id).get("error_code")).isEqualTo("http_400");
    assertNoTokenLeak(id);
  }

  /** access token 에서 exp 를 읽지 못하면 last_refresh 로 판단한다 — 오래됐으면 갱신, 최근이면 호출 없음. */
  @Test
  void unreadableExp_fallsBackToLastRefresh() {
    String old =
        "{\"tokens\":{\"access_token\":\"not-a-jwt\",\"refresh_token\":\""
            + OLD_REFRESH
            + "\",\"account_id\":\"a\"},\"last_refresh\":\""
            + Instant.now().minus(Duration.ofDays(6))
            + "\"}";
    long oldId = account("chatgpt", old, "ACTIVE");
    server.responseBody = "{\"access_token\":\"at-NEW\"}";

    int attempted = service.refreshDue();

    assertThat(attempted).isEqualTo(1);
    assertThat(row(oldId).get("login_revision")).isEqualTo(1L);

    // 방금 갱신한(last_refresh = 지금) 계정은 때가 아니다.
    server.requests.clear();
    int again = service.refreshDue();
    assertThat(again).isZero();
    assertThat(server.requests).isEmpty();
  }

  /**
   * 이관 백필 계정(server_refresh_ready=false)은 다른 코드가 상태를 ACTIVE 로 돌려 놓았어도(직접 갱신으로 흉내) 때가 됐어도 갱신하지 않는다 —
   * Pod 가 이미 갱신 토큰을 돌렸을 수 있다. Pod 올리기로 준비 표시가 서면 다음 회차에 갱신한다.
   */
  @Test
  void backfilledAccountSetActiveByOthers_isNotRefreshed_untilReady() {
    long id = account("chatgpt", authJson(inDays(1), Instant.now()), "NEEDS_CHECK", false);
    callInTenant(
        TENANT, () -> dsl.execute("UPDATE agent_account SET status = 'ACTIVE' WHERE id = ?", id));
    server.responseBody = "{\"access_token\":\"at-NEW\",\"refresh_token\":\"rt-NEW\"}";

    assertThat(service.refreshDue()).isZero();
    service.refreshOne(TENANT, id);
    assertThat(server.requests).isEmpty();
    assertThat(refreshRow(id)).isNull(); // 임대도 잡지 않는다

    callInTenant(
        TENANT,
        () -> {
          accounts.markServerRefreshReady(id);
          return null;
        });

    assertThat(service.refreshDue()).isEqualTo(1);
    assertThat(server.requests).hasSize(1);
  }

  /** 때가 아닌 계정은 임대(쓰기)도 잡지 않는다 — 목록 행으로 먼저 거른다. */
  @Test
  void notDueAccount_doesNotTakeLease() {
    long id = account("chatgpt", authJson(inDays(6), Instant.now()), "ACTIVE");

    assertThat(service.refreshDue()).isZero();

    assertThat(refreshRow(id)).isNull();
  }

  @Test
  void reloginRequiredAccount_isSkipped() {
    long id = account("chatgpt", authJson(inDays(1), Instant.now()), "RELOGIN_REQUIRED");

    assertThat(service.refreshDue()).isZero();
    service.refreshOne(TENANT, id);

    assertThat(server.requests).isEmpty();
    assertThat(row(id).get("status")).isEqualTo("RELOGIN_REQUIRED");
  }

  /** 로그·DB 기록 어디에도 갱신 토큰 원문이 없다. */
  private void assertNoTokenLeak(long id) {
    for (ILoggingEvent e : logs.list) {
      assertThat(e.getFormattedMessage()).doesNotContain(OLD_REFRESH);
      if (e.getThrowableProxy() != null) {
        assertThat(ThrowableProxyUtil.asString(e.getThrowableProxy())).doesNotContain(OLD_REFRESH);
      }
    }
    var rr = refreshRow(id);
    assertThat(String.valueOf(rr.get("error_code"))).doesNotContain(OLD_REFRESH);
    assertThat(String.valueOf(rr.get("error_message"))).doesNotContain(OLD_REFRESH);
  }
}
