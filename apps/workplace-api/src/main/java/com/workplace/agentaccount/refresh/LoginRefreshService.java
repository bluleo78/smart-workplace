package com.workplace.agentaccount.refresh;

import static com.workplace.agentaccount.service.AgentAccountService.STATUS_ACTIVE;
import static com.workplace.agentaccount.service.AgentAccountService.STATUS_RELOGIN_REQUIRED;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.agentaccount.dto.AgentAccountRow;
import com.workplace.agentaccount.refresh.ChatgptTokenClient.ChatgptTokens;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentaccount.service.AgentAccountService;
import com.workplace.auth.service.AgentProviders;
import com.workplace.auth.service.LoginInfoNormalizer;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.tenant.repository.TenantRepository;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * ChatGPT 로그인 계정 서버 갱신 서비스(WP-1450). 서버가 team AI 계정에 보관한 Codex auth.json 의 access token 이 만료되기 전에
 * 갱신 토큰으로 새 토큰을 받아 저장한다 — 같은 계정을 여러 AI Pod 가 함께 쓰므로 갱신 토큰(1회용)을 서버 한 곳만 돌려야 로그인이 풀리지 않는다.
 *
 * <ul>
 *   <li><b>트랜잭션 밖 네트워크</b> — 갱신 호출(외부 HTTPS)은 어떤 트랜잭션에도 싸이지 않는다. 계정 읽기·결과 저장만 짧은 트랜잭션으로 연다.
 *   <li><b>한 번에 한 쪽만</b> — 여러 대·여러 회차가 같은 계정을 잡아도 {@link LoginRefreshRepository#tryClaim}(DB 시계
 *       임대)이 한쪽만 통과시킨다. 임대를 잡은 뒤 계정을 다시 읽어 아직 갱신할 때인지 확인하므로, 목록을 읽은 뒤 다른 쪽이 먼저 갱신했어도 다시 호출하지 않는다.
 *   <li><b>갱신 대상</b> — ACTIVE 이면서 {@code server_refresh_ready}(서버 보관본이 신선하다고 확인됨: 사람이 넣음·교체함, Pod 가
 *       더 새 로그인을 올림)인 계정만. 이관 백필 계정은 Pod 가 이미 갱신 토큰을 돌렸을 수 있어(1회용) 서버가 낡은 토큰으로 갱신하면 reused 로 로그인이
 *       죽는다 — Pod 가 올리기 전까지 건드리지 않는다. 신선함을 상태(ACTIVE)로 가리지 않는 이유: 다른 코드(사용량 확인 등)가 상태를 ACTIVE 로 돌려도
 *       신선함은 보증되지 않기 때문이다. RELOGIN_REQUIRED(갱신 토큰 무효)도 상태로 걸러진다. 영구 실패는 같은 저장에서
 *       server_refresh_ready 도 내린다 — 사용량 조회 성공이 상태를 ACTIVE 로 되돌려도 죽은 갱신 토큰으로 매 주기 다시 호출하지 않게.
 *   <li><b>최소 간격</b> — 만료 전 토큰은 마지막 갱신(last_refreshed_at) 뒤 min-interval 이 지나야 다시 갱신한다(수명이
 *       refresh-before 보다 짧은 토큰을 매 주기 갱신하지 않게).
 *   <li><b>경합 방어</b> — 저장할 때 계정 행을 잠가 다시 읽는다. 그 사이 폐기·원문 교체(secret_version)·내용 변경이 있었으면 결과를 버린다 —
 *       사람이 넣은 새 로그인을 옛 갱신 결과로 덮지 않는다. 성공해도 secret_version 은 그대로라 Pod 가 갈리지 않고, login_revision 만
 *       오른다.
 *   <li><b>Gen:iA</b> — 갱신 수단이 없어 호출하지 않는다. {@code genia.expires}(epoch ms)가 지났으면 「다시 로그인 필요」로 표시만
 *       한다.
 *   <li><b>평문 금지</b> — 복호화한 원문·토큰은 지역 변수로만 다루고 저장 외에 기록·로그에 싣지 않는다(실패는 코드만).
 * </ul>
 *
 * <p><b>알려진 위험</b> — 갱신 호출이 오가는 사이 Pod 가 더 새 로그인을 올려 암호문이 바뀌면, 저장 때 경합 방어가 방금 받은 새 토큰 쌍을 버린다. 갱신
 * 토큰이 1회용이라 서버가 이미 돌린 옛 갱신 토큰을 Pod 쪽 원문이 들고 있을 수 있어, 다음 갱신(어느 쪽이든)이 reused 로 실패해 다시 로그인이 필요해질 수 있다.
 * 갱신 주기·간격상 드물어 지금은 받아들인다.
 */
@Slf4j
@Service
public class LoginRefreshService {

  private static final ObjectMapper JSON = new ObjectMapper();

  /** 갱신을 하는 종류 — ChatGPT(갱신)와 Gen:iA(만료 표시). 목록 조회는 SQL 에서 이 종류만 읽는다. */
  private static final List<String> REFRESHED_PROVIDERS =
      List.of(AgentProviders.CHATGPT, AgentProviders.GENIA);

  private final TenantRepository tenantRepository;
  private final AgentAccountRepository accounts;
  private final LoginRefreshRepository refreshes;
  private final EncryptionService encryption;
  private final ChatgptTokenClient client;
  private final LoginRefreshProperties props;

  /** 계정 읽기·결과 저장용 짧은 트랜잭션 — 이미 트랜잭션 안이면 합류한다(테스트). 네트워크 호출은 이 밖에서. */
  private final TransactionTemplate tx;

  public LoginRefreshService(
      TenantRepository tenantRepository,
      AgentAccountRepository accounts,
      LoginRefreshRepository refreshes,
      EncryptionService encryption,
      ChatgptTokenClient client,
      LoginRefreshProperties props,
      PlatformTransactionManager txManager) {
    this.tenantRepository = tenantRepository;
    this.accounts = accounts;
    this.refreshes = refreshes;
    this.encryption = encryption;
    this.client = client;
    this.props = props;
    this.tx = new TransactionTemplate(txManager);
  }

  /**
   * 모든 활성 테넌트의 갱신 대상 계정을 갱신한다. 한 계정·한 테넌트의 실패는 로그만 남기고 다음으로 넘어간다(메시지 없이 종류만 — 평문 방지).
   *
   * @return 이번 회차에 갱신을 시도한 ChatGPT 계정 수(임대를 못 잡았거나 갱신할 때가 아니면 세지 않는다)
   */
  public int refreshDue() {
    int attempted = 0;
    for (Long tenantId : tenantRepository.findActiveTenantIds()) {
      try {
        attempted += refreshTenant(tenantId);
      } catch (RuntimeException e) {
        log.warn("로그인 갱신 — 테넌트 {} 건너뜀: {}", tenantId, e.getClass().getSimpleName());
      }
    }
    return attempted;
  }

  /** 테넌트 하나를 그 테넌트로 세우고(GUC 는 짧은 트랜잭션마다 주입) 돌린다. */
  private int refreshTenant(long tenantId) {
    return TenantContext.callAs(
        tenantId,
        () -> {
          List<AgentAccountRow> targets =
              tx.execute(s -> accounts.findAllActiveByProviders(REFRESHED_PROVIDERS));
          int attempted = 0;
          for (AgentAccountRow a : targets) {
            try {
              if (refresh(tenantId, a)) attempted++;
            } catch (RuntimeException e) {
              log.warn(
                  "로그인 갱신 실패 — 테넌트 {} 계정 {} 건너뜀: {}",
                  tenantId,
                  a.id(),
                  e.getClass().getSimpleName());
            }
          }
          return attempted;
        });
  }

  /**
   * 계정 하나를 갱신할 때면 갱신한다(아니면 아무것도 하지 않는다). 갱신 대상이 아니거나(폐기·ACTIVE 아님·다른 종류) 아직 때가 아니거나 임대를 못 잡았으면 호출
   * 없이 끝난다. 현재 테넌트는 이 메서드가 tenantId 로 세운다.
   */
  public void refreshOne(long tenantId, long accountId) {
    TenantContext.runAs(
        tenantId,
        () -> {
          Optional<AgentAccountRow> row = tx.execute(s -> accounts.findActive(accountId));
          if (row.isPresent() && isLoginRefreshed(row.get().provider())) {
            refresh(tenantId, row.get());
          }
        });
  }

  /** 갱신을 하는 종류인가 — ChatGPT(갱신)와 Gen:iA(만료 표시). */
  private static boolean isLoginRefreshed(String provider) {
    return REFRESHED_PROVIDERS.contains(provider);
  }

  /** 갱신 시도 결과 한 번 — 성공(tokens) 또는 실패(예외) 중 하나. 원문은 담지 않는다. */
  private record Outcome(ChatgptTokens tokens, ChatgptTokenRefreshException failure) {}

  /**
   * 이미 읽은 계정 행으로 갱신한다.
   *
   * @return 갱신 호출까지 갔는가(ChatGPT 에서 임대를 잡고 때가 맞아 외부 호출을 했으면 true)
   */
  private boolean refresh(long tenantId, AgentAccountRow listed) {
    if (!STATUS_ACTIVE.equals(listed.status())) return false;
    if (AgentProviders.GENIA.equals(listed.provider())) {
      expireGeniaIfPast(listed);
      return false;
    }
    // 서버 보관본의 신선함이 확인되지 않은 계정(이관 백필 등)은 서버가 갱신하지 않는다 — 클래스 javadoc 의 「갱신 대상」.
    if (!listed.serverRefreshReady()) return false;
    // 임대(쓰기)를 잡기 전에 목록 행으로 때가 아닌 계정을 거른다 — 매 시간 모든 계정이 임대 upsert 를 쓰지 않게.
    // 읽을 수 없는 원문은 BAD_SECRET 기록을 위해 그대로 통과시키고, 임대 뒤의 재확인은 그대로 둔다(그 사이 다른 쪽이 갱신했을 수 있다).
    String listedSecret = decryptOrNull(listed);
    if (listedSecret != null && !isDue(listed, listedSecret)) return false;
    if (!refreshes.tryClaim(tenantId, listed.id(), props.lease())) return false;
    // 임대를 잡은 뒤의 단계에서 예상 못 한 예외가 나면 임대만 풀어 다음 회차가 임대 만료를 기다리지 않게 하고, 호출자가 로그를 남긴다.
    try {
      return refreshClaimed(listed.id());
    } catch (RuntimeException e) {
      releaseQuietly(listed.id());
      throw e;
    }
  }

  /**
   * 임대를 잡은 계정을 갱신한다 — 다시 읽어 아직 갱신할 때인지 확인하고(목록을 읽은 뒤 다른 쪽이 먼저 갱신·교체·폐기했을 수 있다), 갱신 호출(트랜잭션 밖) 뒤 결과를
   * 저장한다. 갱신하지 않고 끝나면 임대를 풀거나(때가 아님) 실패로 남긴다(읽을 수 없는 원문). 예외는 호출자가 임대를 풀고 다시 던진다.
   *
   * @return 갱신 호출까지 갔는가
   */
  private boolean refreshClaimed(long accountId) {
    AgentAccountRow account = tx.execute(s -> accounts.findActive(accountId)).orElse(null);
    if (account == null
        || !STATUS_ACTIVE.equals(account.status())
        || !account.serverRefreshReady()) {
      refreshes.releaseLease(accountId);
      return false;
    }
    String secret = decryptOrNull(account);
    if (secret == null) {
      // 읽을 수 없는 원문 — 실패로 남겨 관리자가 보게 한다(상태는 건드리지 않는다).
      refreshes.recordFailure(accountId, "BAD_SECRET", "저장된 로그인 정보를 읽을 수 없음");
      return false;
    }
    if (!isDue(account, secret)) {
      refreshes.releaseLease(accountId);
      return false;
    }
    Outcome outcome = callRefresh(secret);
    tx.executeWithoutResult(s -> save(account, secret, outcome));
    return true;
  }

  /** 갱신 토큰으로 새 토큰을 받는다(네트워크 호출 — 트랜잭션 밖). 갱신 토큰이 없거나 서버가 거절하면 실패 결과로 돌려준다. */
  private Outcome callRefresh(String secret) {
    String refreshToken = refreshTokenOf(secret);
    if (refreshToken == null) {
      return new Outcome(null, new ChatgptTokenRefreshException(false, "no_refresh_token"));
    }
    try {
      return new Outcome(client.refresh(refreshToken), null);
    } catch (ChatgptTokenRefreshException e) {
      return new Outcome(null, e);
    }
  }

  /** catch 블록에서 임대를 푼다 — 푸는 데 실패해도 원래 예외를 가리지 않게 삼킨다(임대는 만료로 풀린다). */
  private void releaseQuietly(long accountId) {
    try {
      refreshes.releaseLease(accountId);
    } catch (RuntimeException e) {
      log.warn("로그인 갱신 임대 해제 실패 — 계정 {}: {}", accountId, e.getClass().getSimpleName());
    }
  }

  /** 원문을 복호화한다 — 실패하면 null(암호문·키 문제, 원인 메시지는 싣지 않는다). */
  private String decryptOrNull(AgentAccountRow account) {
    try {
      return encryption.decrypt(account.encryptedSecret());
    } catch (RuntimeException e) {
      return null;
    }
  }

  /**
   * 결과를 저장한다(트랜잭션 안). 계정 행을 잠가 다시 읽어, 그 사이 폐기·원문 교체·내용 변경이 있었으면 결과를 버리고 임대만 푼다.
   *
   * <ul>
   *   <li>성공 — tokens 의 받은 칸만 덮고 last_refresh 를 지금으로, 암호화해 저장(secret_version 유지·login_revision +1).
   *   <li>영구 실패 — 계정을 「다시 로그인 필요」로 두고 서버 갱신 준비(server_refresh_ready)를 내린다, 실패 기록. 원문은 그대로.
   *   <li>일시 실패 — 실패 기록만.
   * </ul>
   */
  private void save(AgentAccountRow read, String readSecret, Outcome outcome) {
    Optional<AgentAccountRow> current = accounts.findActiveForUpdate(read.id());
    if (current.isEmpty()
        || current.get().secretVersion() != read.secretVersion()
        || !current.get().encryptedSecret().equals(read.encryptedSecret())) {
      refreshes.releaseLease(read.id());
      return;
    }
    if (outcome.tokens() != null) {
      Instant now = Instant.now();
      String merged = merge(readSecret, outcome.tokens(), now);
      boolean saved =
          accounts.updateLoginContent(
              read.id(),
              read.secretVersion(),
              encryption.encrypt(merged),
              now.atOffset(ZoneOffset.UTC));
      if (saved) refreshes.recordSuccess(read.id());
      else refreshes.releaseLease(read.id());
      return;
    }
    ChatgptTokenRefreshException failure = outcome.failure();
    if (failure.permanent()) {
      // 상태와 함께 서버 갱신 준비도 내린다 — 다른 코드(사용량 조회)가 ACTIVE 로 되돌려도 죽은 갱신 토큰으로 다시 호출하지 않게.
      accounts.markRefreshFailedPermanently(read.id(), STATUS_RELOGIN_REQUIRED);
      refreshes.recordFailure(read.id(), failure.code(), "갱신 토큰이 더는 통하지 않음 — 다시 로그인 필요");
    } else {
      refreshes.recordFailure(read.id(), failure.code(), "갱신 실패 — 다음 주기에 다시 시도");
    }
  }

  /**
   * auth.json 에 갱신 결과를 합친다 — Jackson 트리로 tokens 의 받은 칸(id·access·refresh)만 덮고 응답에 없던
   * 칸(account_id·갱신 토큰 등)과 다른 최상위 칸은 그대로 둔다. last_refresh 는 ISO-8601(UTC)로 지금.
   */
  private static String merge(String secret, ChatgptTokens tokens, Instant now) {
    try {
      ObjectNode root = (ObjectNode) JSON.readTree(secret);
      ObjectNode t = (ObjectNode) root.get("tokens");
      if (tokens.idToken() != null) t.put("id_token", tokens.idToken());
      t.put("access_token", tokens.accessToken());
      if (tokens.refreshToken() != null) t.put("refresh_token", tokens.refreshToken());
      root.put("last_refresh", now.toString());
      return JSON.writeValueAsString(root);
    } catch (Exception e) {
      // 원문 조각이 메시지에 섞이지 않게 종류만 — 위에서 읽을 수 있음을 확인한 원문이라 사실상 일어나지 않는다.
      throw new IllegalStateException("로그인 정보를 합칠 수 없음");
    }
  }

  /** auth.json 의 tokens.refresh_token — 없거나 읽지 못하면 null. */
  private static String refreshTokenOf(String secret) {
    try {
      return LoginInfoNormalizer.textOrNull(
          JSON.readTree(secret).path("tokens").get("refresh_token"));
    } catch (Exception e) {
      return null;
    }
  }

  /**
   * 지금 갱신할 때인가 — access token(JWT) exp 가 refresh-before 안쪽이면(이미 지났어도) 참. 다만 아직 만료 전이고 계정의
   * last_refreshed_at 이 min-interval 안이면 거짓 — access token 수명이 refresh-before 보다 짧으면 갱신 직후에도 exp 가
   * refresh-before 안쪽이라 매 주기 갱신하게 되기 때문이다(이미 만료됐으면 Pod 가 못 쓰니 바로 갱신한다). exp 를 못 읽으면
   * last_refresh(없으면 계정의 last_refreshed_at)가 refresh-before 이상 지났을 때. 둘 다 모르면 거짓(알 수 없는 원문을 함부로 쓰지
   * 않는다).
   */
  boolean isDue(AgentAccountRow account, String secret) {
    Instant now = Instant.now();
    Instant exp = accessExpiry(secret);
    if (exp != null) {
      if (exp.isAfter(now.plus(props.refreshBefore()))) return false;
      if (!exp.isAfter(now)) return true;
      Instant lastRefreshed = account.lastRefreshedAt();
      return lastRefreshed == null || !lastRefreshed.isAfter(now.minus(props.minInterval()));
    }
    Instant last = AgentAccountService.lastRefreshOf(secret);
    if (last == null) last = account.lastRefreshedAt();
    return last != null && !last.isAfter(now.minus(props.refreshBefore()));
  }

  /** access token JWT 의 exp — 서명은 검증하지 않고 payload 만 디코드한다(만료 시각을 읽을 뿐). 읽지 못하면 null. */
  private static Instant accessExpiry(String secret) {
    try {
      JsonNode claims =
          LoginInfoNormalizer.jwtClaims(
              LoginInfoNormalizer.textOrNull(
                  JSON.readTree(secret).path("tokens").get("access_token")));
      if (claims == null) return null;
      JsonNode exp = claims.path("exp");
      return exp.isNumber() ? Instant.ofEpochSecond(exp.asLong()) : null;
    } catch (Exception e) {
      return null;
    }
  }

  /** Gen:iA 계정의 genia.expires(epoch ms)가 지났으면 「다시 로그인 필요」로 표시한다(호출 없음). 읽지 못하거나 아직이면 그대로. */
  private void expireGeniaIfPast(AgentAccountRow listed) {
    String secret = decryptOrNull(listed);
    if (secret == null) return;
    long expires;
    try {
      JsonNode v = JSON.readTree(secret).path("genia").path("expires");
      if (!v.isNumber()) return;
      expires = v.asLong();
    } catch (Exception e) {
      return;
    }
    if (expires > System.currentTimeMillis()) return;
    tx.executeWithoutResult(
        s ->
            accounts
                .findActiveForUpdate(listed.id())
                .filter(c -> c.secretVersion() == listed.secretVersion())
                .filter(c -> STATUS_ACTIVE.equals(c.status()))
                .ifPresent(c -> accounts.updateStatus(c.id(), STATUS_RELOGIN_REQUIRED)));
  }
}
