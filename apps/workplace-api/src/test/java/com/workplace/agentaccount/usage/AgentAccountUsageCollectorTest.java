package com.workplace.agentaccount.usage;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.global.security.EncryptionService;
import com.workplace.support.IntegrationTestBase;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1449 AI 계정 사용량 수집 서비스 통합 테스트 — 조회 성공·실패 저장, 간격 안 재조회 건너뜀, 계정 상태 전이(확인 필요 → 정상/다시 로그인, 다시 로그인 →
 * 성공 시 정상), 폐기 계정 제외(조회 중 폐기 포함), 한 계정 예외의 격리, 조회 대상이 아닌 provider(genia·opencode) 제외를 확인한다. NETWORK
 * 실패의 같은 회차 1회 재시도(WP-1487)는 실제 설정 클래스로 만든 조회기와 가짜 소켓 서버로도 확인한다.
 *
 * <p>조회기는 실제 HTTP 대신 가짜 {@link UsageProbe} 를 쓴다. Spring 빈을 바꿔 끼우면(@MockitoBean 등) 테스트 컨텍스트가 하나 더
 * 생기므로, 수집 서비스를 가짜 조회기 목록으로 직접 만들어 컨텍스트 캐시를 깨지 않는다.
 */
@Transactional
class AgentAccountUsageCollectorTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AgentAccountRepository accounts;
  @Autowired AgentAccountUsageRepository usage;
  @Autowired EncryptionService encryption;
  @Autowired AgentAccountUsageProperties props;

  /** 원문 → 그 원문으로 조회했을 때의 동작. 등록 안 된 원문은 기본 성공 값을 돌려준다. */
  private final Map<String, Handler> handlers = new HashMap<>();

  /** 조회기가 받은 원문 기록(provider:원문) — 어떤 계정을 조회했는지 확인한다. */
  private final List<String> calls = new ArrayList<>();

  private AgentAccountUsageCollector collector;

  /** 가짜 조회 동작 — 결과를 돌려주거나 예외를 던진다. */
  @FunctionalInterface
  interface Handler {
    UsageReading read() throws UsageProbeException;
  }

  /** provider 만 다른 가짜 조회기 — 원문별 동작을 handlers 에서 고른다. */
  private UsageProbe fake(String provider) {
    return new UsageProbe() {
      @Override
      public String provider() {
        return provider;
      }

      @Override
      public UsageReading read(String plaintextSecret) throws UsageProbeException {
        calls.add(provider + ":" + plaintextSecret);
        Handler h = handlers.get(plaintextSecret);
        return h == null ? reading("10.00") : h.read();
      }
    };
  }

  @BeforeEach
  void setUp() {
    // genia·opencode 는 조회기를 등록하지 않는다 — 조회기가 없는 provider 는 조회 대상이 아니다.
    collector =
        new AgentAccountUsageCollector(
            accounts,
            usage,
            encryption,
            List.of(fake("anthropic"), fake("chatgpt")),
            props,
            txManager);
  }

  private static UsageReading reading(String fivePct) {
    Instant now = Instant.now();
    return new UsageReading(
        List.of(
            new UsageSnapshot(
                UsageWindow.FIVE_HOUR, new BigDecimal(fivePct), now.plusSeconds(3600), null, now)),
        false);
  }

  private long account(String provider, String secret, String status) {
    return accounts.insert(
        provider,
        provider + "-계정",
        encryption.encrypt(secret),
        null,
        null,
        status,
        null,
        null,
        true,
        null);
  }

  private String status(long accountId) {
    return dsl.fetchValue("SELECT status FROM agent_account WHERE id = ?", accountId).toString();
  }

  /** 간격이 지난 것처럼 마지막 시도 시각을 과거로 돌린다. */
  private void ageCheck(long accountId) {
    dsl.execute(
        "UPDATE agent_account_usage_check SET checked_at = now() - interval '1 day',"
            + " lease_until = NULL WHERE account_id = ?",
        accountId);
  }

  private Object leaseUntil(long accountId) {
    return dsl.fetchValue(
        "SELECT lease_until FROM agent_account_usage_check WHERE account_id = ?", accountId);
  }

  @Test
  void success_savesSnapshot_andSecondCallWithinIntervalSkips() {
    long id = account("anthropic", "tok-ok", "ACTIVE");
    handlers.put("tok-ok", () -> reading("42.50"));

    assertThat(collector.collectAccount(1L, id)).isTrue();

    List<UsageSnapshot> snaps = usage.findSnapshots(List.of(id)).get(id);
    assertThat(snaps).hasSize(1);
    assertThat(snaps.get(0).usedPercent()).isEqualByComparingTo("42.50");
    UsageCheckRow check = usage.findChecks(List.of(id)).get(id);
    assertThat(check.succeededAt()).isNotNull();
    assertThat(check.errorCode()).isNull();
    assertThat(leaseUntil(id)).isNull();

    // 간격(10분) 안 두 번째 호출 — 잡지 못해 조회하지 않는다.
    assertThat(collector.collectAccount(1L, id)).isFalse();
    assertThat(calls).containsExactly("anthropic:tok-ok");
  }

  @Test
  void failure_keepsLastSuccessValues_andRecordsReason() {
    long id = account("anthropic", "tok-flaky", "ACTIVE");
    handlers.put("tok-flaky", () -> reading("30.00"));
    assertThat(collector.collectAccount(1L, id)).isTrue();

    ageCheck(id);
    // 앞선 성공도 과거로 돌린다 — 테스트 트랜잭션 안에서는 DB now() 가 고정이라 시도·성공 시각이 같아진다
    dsl.execute(
        "UPDATE agent_account_usage_check SET succeeded_at = now() - interval '1 day'"
            + " WHERE account_id = ?",
        id);
    handlers.put(
        "tok-flaky",
        () -> {
          throw new UsageProbeException("NETWORK", "연결 실패");
        });
    assertThat(collector.collectAccount(1L, id)).isTrue();

    List<UsageSnapshot> snaps = usage.findSnapshots(List.of(id)).get(id);
    assertThat(snaps).hasSize(1);
    assertThat(snaps.get(0).usedPercent()).isEqualByComparingTo("30.00");
    UsageCheckRow check = usage.findChecks(List.of(id)).get(id);
    assertThat(check.errorCode()).isEqualTo("NETWORK");
    assertThat(check.errorMessage()).isEqualTo("연결 실패");
    assertThat(check.succeededAt()).isBefore(check.checkedAt());
    assertThat(leaseUntil(id)).isNull();
  }

  @Test
  void needsCheck_success_becomesActive() {
    long id = account("chatgpt", "{\"tokens\":{}}", "NEEDS_CHECK");

    assertThat(collector.collectAccount(1L, id)).isTrue();

    assertThat(status(id)).isEqualTo("ACTIVE");
  }

  @Test
  void reloginRequired_success_becomesActive() {
    // 일시 장애 중 401 로 「다시 로그인 필요」가 된 계정 — 조회가 성공하면 저장된 키가 통한다는 뜻이라 「정상」으로 되돌린다
    long id = account("anthropic", "tok-recovered", "RELOGIN_REQUIRED");

    assertThat(collector.collectAccount(1L, id)).isTrue();

    assertThat(status(id)).isEqualTo("ACTIVE");
  }

  @Test
  void reloginRequired_failure_staysReloginRequired() {
    long id = account("chatgpt", "auth-still-dead", "RELOGIN_REQUIRED");
    handlers.put(
        "auth-still-dead",
        () -> {
          throw new UsageProbeException("TOKEN_EXPIRED", "토큰 만료");
        });

    assertThat(collector.collectAccount(1L, id)).isTrue();

    assertThat(status(id)).isEqualTo("RELOGIN_REQUIRED");
  }

  @Test
  void needsCheck_401_becomesReloginRequired() {
    long claude = account("anthropic", "tok-dead", "NEEDS_CHECK");
    long gpt = account("chatgpt", "auth-dead", "NEEDS_CHECK");
    handlers.put(
        "tok-dead",
        () -> {
          throw new UsageProbeException("UNAUTHORIZED", "토큰이 거절됨");
        });
    handlers.put(
        "auth-dead",
        () -> {
          throw new UsageProbeException("TOKEN_EXPIRED", "토큰 만료");
        });

    collector.collectAccount(1L, claude);
    collector.collectAccount(1L, gpt);

    assertThat(status(claude)).isEqualTo("RELOGIN_REQUIRED");
    assertThat(status(gpt)).isEqualTo("RELOGIN_REQUIRED");
    assertThat(usage.findChecks(List.of(claude)).get(claude).errorCode()).isEqualTo("UNAUTHORIZED");
    assertThat(usage.findChecks(List.of(gpt)).get(gpt).errorCode()).isEqualTo("TOKEN_EXPIRED");
  }

  @Test
  void needsCheck_otherFailure_staysNeedsCheck() {
    long id = account("anthropic", "tok-net", "NEEDS_CHECK");
    handlers.put(
        "tok-net",
        () -> {
          throw new UsageProbeException("HTTP_500", "응답 오류(500)");
        });

    collector.collectAccount(1L, id);

    assertThat(status(id)).isEqualTo("NEEDS_CHECK");
    assertThat(usage.findChecks(List.of(id)).get(id).errorCode()).isEqualTo("HTTP_500");
  }

  @Test
  void active_401_staysActive() {
    long id = account("anthropic", "tok-401", "ACTIVE");
    handlers.put(
        "tok-401",
        () -> {
          throw new UsageProbeException("UNAUTHORIZED", "토큰이 거절됨");
        });

    assertThat(collector.collectAccount(1L, id)).isTrue();

    assertThat(status(id)).isEqualTo("ACTIVE");
    assertThat(usage.findChecks(List.of(id)).get(id).errorCode()).isEqualTo("UNAUTHORIZED");
  }

  @Test
  void undecryptableSecret_recordsBadSecret_withoutProbing() {
    long id =
        accounts.insert(
            "anthropic", "깨진 원문", "not-encrypted", null, null, "ACTIVE", null, null, true, null);

    assertThat(collector.collectAccount(1L, id)).isTrue();

    assertThat(calls).isEmpty();
    assertThat(usage.findChecks(List.of(id)).get(id).errorCode()).isEqualTo("BAD_SECRET");
  }

  @Test
  void revokedAccount_isNotCollected() {
    long revoked = account("anthropic", "tok-revoked", "ACTIVE");
    accounts.revoke(revoked);

    collector.collectTenant(1L);
    assertThat(collector.collectAccount(1L, revoked)).isFalse();

    assertThat(calls).doesNotContain("anthropic:tok-revoked");
    assertThat(usage.findChecks(List.of(revoked))).isEmpty();
  }

  @Test
  void revokedDuringProbe_resultIsNotSaved_andLeaseReleased() {
    long id = account("anthropic", "tok-mid", "NEEDS_CHECK");
    handlers.put(
        "tok-mid",
        () -> {
          // 조회가 도는 사이 관리자가 계정을 폐기한다.
          accounts.revoke(id);
          return reading("90.00");
        });

    assertThat(collector.collectAccount(1L, id)).isFalse();

    assertThat(usage.findSnapshots(List.of(id))).isEmpty();
    UsageCheckRow check = usage.findChecks(List.of(id)).get(id);
    assertThat(check.checkedAt()).isNull();
    assertThat(check.succeededAt()).isNull();
    assertThat(leaseUntil(id)).isNull();
    assertThat(status(id)).isEqualTo("NEEDS_CHECK");
  }

  @Test
  void secretReplacedDuringProbe_resultIsNotSaved() {
    long id = account("anthropic", "tok-old", "NEEDS_CHECK");
    handlers.put(
        "tok-old",
        () -> {
          // 조회가 도는 사이 원문이 교체됐다 — 옛 원문의 결과로 새 원문의 상태를 정하지 않는다.
          accounts.replaceSecret(
              id, encryption.encrypt("tok-new"), null, null, "NEEDS_CHECK", null, null);
          throw new UsageProbeException("UNAUTHORIZED", "토큰이 거절됨");
        });

    assertThat(collector.collectAccount(1L, id)).isFalse();

    assertThat(status(id)).isEqualTo("NEEDS_CHECK");
    assertThat(usage.findChecks(List.of(id)).get(id).errorCode()).isNull();
    assertThat(leaseUntil(id)).isNull();
  }

  @Test
  void oneAccountThrows_othersStillCollected() {
    long boom = account("anthropic", "tok-boom", "ACTIVE");
    long ok = account("chatgpt", "auth-ok", "ACTIVE");
    handlers.put(
        "tok-boom",
        () -> {
          throw new IllegalStateException("예상 못 한 오류");
        });
    handlers.put("auth-ok", () -> reading("12.00"));

    collector.collectTenant(1L);

    assertThat(calls).contains("anthropic:tok-boom", "chatgpt:auth-ok");
    assertThat(usage.findSnapshots(List.of(ok))).containsKey(ok);
    assertThat(usage.findSnapshots(List.of(boom))).isEmpty();
    // 터진 계정의 임대는 풀어 둔다 — 다음 회차가 임대 만료를 기다리지 않게.
    assertThat(leaseUntil(boom)).isNull();
  }

  @Test
  void geniaAndOpencode_areNotProbed() {
    long genia = account("genia", "genia-secret", "ACTIVE");
    long opencode = account("opencode", "opencode-secret", "ACTIVE");

    collector.collectTenant(1L);
    assertThat(collector.collectAccount(1L, genia)).isFalse();
    assertThat(collector.collectAccount(1L, opencode)).isFalse();

    assertThat(calls).noneMatch(c -> c.startsWith("genia:") || c.startsWith("opencode:"));
    assertThat(usage.findChecks(List.of(genia, opencode))).isEmpty();
  }

  @Test
  void networkFailure_retriedOnceInSameRound() {
    long id = account("anthropic", "tok-retry", "ACTIVE");
    int[] n = {0};
    handlers.put(
        "tok-retry",
        () -> {
          if (n[0]++ == 0) throw new UsageProbeException("NETWORK", "연결 실패");
          return reading("20.00");
        });

    assertThat(collector.collectAccount(1L, id)).isTrue();

    assertThat(calls).containsExactly("anthropic:tok-retry", "anthropic:tok-retry");
    assertThat(usage.findChecks(List.of(id)).get(id).errorCode()).isNull();
  }

  @Test
  void nonNetworkFailure_isNotRetried() {
    long id = account("anthropic", "tok-500", "ACTIVE");
    handlers.put(
        "tok-500",
        () -> {
          throw new UsageProbeException("HTTP_500", "응답 오류(500)");
        });

    collector.collectAccount(1L, id);

    assertThat(calls).containsExactly("anthropic:tok-500");
  }

  // ── 실제 설정 클래스(AgentAccountUsageHttpConfig)로 만든 조회기 + 가짜 소켓 서버(WP-1487) ──

  private static final String CHATGPT_SECRET =
      "{\"tokens\":{\"access_token\":\"at\",\"account_id\":\"acc\"}}";

  /** 두 provider 모두 가짜 서버를 보게 한 실제 조회기로 수집기를 만든다. 응답 타임아웃을 짧게 해 결함이 테스트를 오래 붙잡지 않게 한다. */
  private AgentAccountUsageCollector realCollector(FakeUsageServer server) {
    var p =
        new AgentAccountUsageProperties(
            true,
            null,
            null,
            null,
            server.baseUrl(),
            server.baseUrl(),
            Duration.ofSeconds(2),
            Duration.ofSeconds(2),
            null);
    var config = new AgentAccountUsageHttpConfig();
    return new AgentAccountUsageCollector(
        accounts,
        usage,
        encryption,
        List.of(config.claudeUsageProbe(p), config.chatgptUsageProbe(p)),
        props,
        txManager);
  }

  @Test
  void claude_firstConnectionDropped_retriedAndSaved() throws Exception {
    try (var server = new FakeUsageServer()) {
      server.dropFirst = 1;
      server.extraHeaders =
          "anthropic-ratelimit-unified-5h-utilization: 0.25\r\n"
              + "anthropic-ratelimit-unified-5h-reset: 1800000000\r\n";
      long id = account("anthropic", "sk-ant-real", "ACTIVE");

      assertThat(realCollector(server).collectAccount(1L, id)).isTrue();

      assertThat(server.connections.get()).isEqualTo(2);
      assertThat(usage.findChecks(List.of(id)).get(id).errorCode()).isNull();
      assertThat(usage.findSnapshots(List.of(id)).get(id).get(0).usedPercent())
          .isEqualByComparingTo("25.00");
    }
  }

  @Test
  void chatgpt_firstConnectionDropped_retriedAndSaved() throws Exception {
    try (var server = new FakeUsageServer()) {
      server.dropFirst = 1;
      server.body = "{\"rate_limit\":{\"primary_window\":{\"used_percent\":33}}}";
      long id = account("chatgpt", CHATGPT_SECRET, "ACTIVE");

      assertThat(realCollector(server).collectAccount(1L, id)).isTrue();

      assertThat(server.connections.get()).isEqualTo(2);
      assertThat(usage.findChecks(List.of(id)).get(id).errorCode()).isNull();
      assertThat(usage.findSnapshots(List.of(id)).get(id).get(0).usedPercent())
          .isEqualByComparingTo("33.00");
    }
  }

  @Test
  void claude_401_isNotRetried() throws Exception {
    try (var server = new FakeUsageServer()) {
      server.status = 401;
      long id = account("anthropic", "sk-ant-bad", "ACTIVE");

      realCollector(server).collectAccount(1L, id);

      assertThat(server.connections.get()).isEqualTo(1);
      assertThat(usage.findChecks(List.of(id)).get(id).errorCode()).isEqualTo("UNAUTHORIZED");
    }
  }

  @Test
  void chatgpt_401_isNotRetried() throws Exception {
    try (var server = new FakeUsageServer()) {
      server.status = 401;
      long id = account("chatgpt", CHATGPT_SECRET, "ACTIVE");

      realCollector(server).collectAccount(1L, id);

      assertThat(server.connections.get()).isEqualTo(1);
      assertThat(usage.findChecks(List.of(id)).get(id).errorCode()).isEqualTo("TOKEN_EXPIRED");
    }
  }

  /**
   * 근본 원인 회귀 방지(WP-1487): 서버가 연결을 살려 둬도 조회기는 다음 조회에 그 연결을 다시 쓰지 않는다 — 회차 사이 쉬는 동안 상대가 닫은 풀 연결을 집어
   * 멈추는 일이 없게.
   */
  @Test
  void realProbe_doesNotReusePooledConnection() throws Exception {
    try (var server = new FakeUsageServer()) {
      server.keepAlive = true;
      server.body = "{\"rate_limit\":{\"primary_window\":{\"used_percent\":10}}}";
      long first = account("chatgpt", CHATGPT_SECRET, "ACTIVE");
      long second = account("chatgpt", CHATGPT_SECRET, "ACTIVE");
      var collector = realCollector(server);

      assertThat(collector.collectAccount(1L, first)).isTrue();
      assertThat(collector.collectAccount(1L, second)).isTrue();

      assertThat(server.requests.get()).isEqualTo(2);
      assertThat(server.connections.get()).isEqualTo(2);
    }
  }
}
