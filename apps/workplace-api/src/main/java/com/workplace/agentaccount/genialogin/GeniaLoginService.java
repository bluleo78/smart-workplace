package com.workplace.agentaccount.genialogin;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.agentaccount.dto.AgentAccountRequest;
import com.workplace.agentaccount.dto.AgentAccountResponse;
import com.workplace.agentaccount.dto.AgentAccountUpdateRequest;
import com.workplace.agentaccount.dto.GeniaLoginResponse;
import com.workplace.agentaccount.dto.GeniaLoginStartRequest;
import com.workplace.agentaccount.exception.AgentAccountDuplicateException;
import com.workplace.agentaccount.exception.AgentAccountNotFoundException;
import com.workplace.agentaccount.exception.GeniaLoginNotFoundException;
import com.workplace.agentaccount.exception.GeniaLoginUnavailableException;
import com.workplace.agentaccount.genialogin.GeniaLoginClient.GeniaLoginUnavailable;
import com.workplace.agentaccount.genialogin.GeniaLoginClient.LoginStart;
import com.workplace.agentaccount.genialogin.GeniaLoginClient.PollResult;
import com.workplace.agentaccount.service.AgentAccountService;
import com.workplace.auth.exception.InvalidProviderCredentialException;
import com.workplace.auth.service.AgentProviders;
import com.workplace.auth.sso.SsoTransactionCookie;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.global.util.Texts;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * Gen:iA 브라우저 로그인 진행 서비스(WP-1461) — 관리자가 [로그인] 을 누르면 PKCE 로 Gen:iA 로그인을 시작하고, 웹의 상태 조회(2초마다) 안에서
 * 간격이 됐을 때만 Gen:iA 를 한 번 폴링해, 성공하면 붙여 넣기와 같은 모양의 auth.json 으로 계정을 등록하거나(새 계정) 로그인 정보만 바꾼다(다시 로그인).
 *
 * <p><b>진행 상태는 이 API 프로세스 메모리에만 둔다</b>(DB 테이블 없음). 운영 API 가 replicas=1 이라는 전제다 — 진행 수명이 10분 남짓이고
 * code_verifier·토큰을 DB 에 남기지 않는 장점도 있다. 롤링 배포로 잠깐 두 Pod 가 겹치거나 API 가 다시 뜨면 진행이 사라지는데, 그때 조회는 404 이고
 * 웹은 「만료」와 같은 화면(다시 시도)을 보인다. <b>API replicas 를 2 이상으로 올리는 날에는 진행 상태를 DB 테이블로 옮겨야 한다</b>(다른 Pod 로 간
 * 조회가 404 가 된다).
 *
 * <p>스케줄러를 두지 않는다 — 창을 닫거나 탭을 떠나면 조회가 멈추므로 폴링도 저절로 멈춘다. 같은 진행의 동시 조회는 진행마다 {@link
 * ReentrantLock#tryLock()} 으로 하나만 폴링하고 나머지는 지금 상태를 그대로 돌려준다(토큰 교환·계정 저장이 두 번 일어나지 않게).
 *
 * <p>한 사람 한 진행: 같은 (워크스페이스, 사용자)가 새로 시작하면 이전 진행을 지운다. 끝난 진행은 만료 시각 + 10분까지 남겨 같은 결과를 다시 돌려주고(멱등),
 * 시작 때 지난 것을 쓸어 낸다. code_verifier·state·access token 은 응답·로그·toString 어디에도 싣지 않는다.
 */
@Slf4j
@Service
public class GeniaLoginService {

  /** 진행 상태 값 — 응답 status 로 그대로 나간다. */
  static final String PENDING = "PENDING";

  static final String SUCCEEDED = "SUCCEEDED";
  static final String EXPIRED = "EXPIRED";
  static final String FAILED = "FAILED";

  /** 끝난 진행을 남겨 두는 시간(만료 시각 기준) — 늦게 온 조회에도 같은 결과를 돌려준다. */
  private static final Duration RETAIN_AFTER_EXPIRY = Duration.ofMinutes(10);

  /** Gen:iA 가 slow_down 을 주면 폴링 간격에 더하는 초. */
  private static final int SLOW_DOWN_STEP_SECONDS = 5;

  /** 성공 응답에 expires_at 이 없을 때 쓰는 토큰 수명 — Gen:iA access token 수명(30일)이다. */
  private static final Duration DEFAULT_TOKEN_LIFETIME = Duration.ofDays(30);

  /** 서버가 준 만료 시각의 상한 — 이상한 값이 와도 진행이 메모리에 오래 남지 않게 한다. */
  private static final Duration MAX_LIFETIME = Duration.ofMinutes(30);

  static final String MSG_BAD_RESPONSE = "Gen:iA 로그인 서버 응답을 읽지 못했어요";
  static final String MSG_ACCOUNT_GONE = "다시 로그인할 계정을 찾지 못했어요";
  static final String MSG_SAVE_FAILED = "Gen:iA 계정을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요";
  static final String MSG_NOT_GENIA = "Gen:iA 로그인 계정만 다시 로그인할 수 있어요";

  /** 다시 로그인 창에서 다른 Gen:iA 계정으로 로그인했을 때 — 뒤에 기존 이메일을 넣는다. */
  static final String MSG_OTHER_IDENTITY = "다른 Gen:iA 계정으로 로그인했어요 — %s 로 로그인해 주세요";

  private static final ObjectMapper MAPPER = new ObjectMapper();

  private final GeniaLoginClient client;
  private final AgentAccountService accountService;
  private final Clock clock;

  /** 진행 id → 진행. 한 사람 한 진행이라 크기는 시작한 관리자 수를 넘지 않는다. */
  private final Map<String, Session> sessions = new ConcurrentHashMap<>();

  /** 「이전 진행 지우기 + 새 진행 넣기」를 한 덩어리로 묶는 잠금 — 같은 사람이 동시에 시작해도 진행이 둘 남지 않게(시작은 드물어 서비스 하나에 하나로 충분). */
  private final Object startLock = new Object();

  @Autowired
  public GeniaLoginService(GeniaLoginClient client, AgentAccountService accountService) {
    this(client, accountService, Clock.systemUTC());
  }

  /** 시각을 바꿔 끼우는 테스트용 생성자. */
  GeniaLoginService(GeniaLoginClient client, AgentAccountService accountService, Clock clock) {
    this.client = client;
    this.accountService = accountService;
    this.clock = clock;
  }

  /**
   * 로그인을 시작한다 — 다시 로그인이면 대상 계정을 먼저 검사(없음 404, Gen:iA 아님 400)하고, code_verifier 를 만들어 S256 challenge
   * 로 Gen:iA 로그인을 시작한 뒤 진행을 저장한다. 같은 사용자의 이전 진행은 지운다.
   *
   * @throws GeniaLoginUnavailableException Gen:iA 서버에 닿지 못했거나 응답을 쓸 수 없을 때(502)
   */
  public GeniaLoginResponse start(long userId, GeniaLoginStartRequest req) {
    long tenantId = TenantContext.require();
    Instant now = clock.instant();
    sweep(now);
    Long accountId = req.accountId();
    String expectedEmail = null;
    if (accountId != null) {
      // 대상 계정을 Gen:iA 를 부르기 전에 확인한다 — 없는 계정·다른 종류로 바깥 서버를 부르지 않게.
      AgentAccountResponse target = accountService.get(accountId);
      if (!AgentProviders.GENIA.equals(target.provider())) {
        throw new InvalidProviderCredentialException(MSG_NOT_GENIA);
      }
      // 다시 로그인은 같은 사람만 받는다 — 저장 때 비교할 기존 이메일을 여기서 한 번 읽어 둔다.
      expectedEmail = target.accountEmail();
    }
    String label = Texts.stripToNull(req.label());
    String verifier = randomToken();
    LoginStart started;
    try {
      started = client.start(SsoTransactionCookie.challenge(verifier));
    } catch (GeniaLoginUnavailable e) {
      // 코드만 남긴다(서버 주소·본문 없음).
      log.warn("Gen:iA 로그인 시작 실패 userId={} code={}", userId, e.code());
      throw new GeniaLoginUnavailableException();
    }
    Instant expiresAt = started.expiresAt();
    if (expiresAt.isAfter(now.plus(MAX_LIFETIME))) expiresAt = now.plus(MAX_LIFETIME);
    int interval = started.intervalSeconds();
    Session session =
        new Session(
            randomToken(),
            tenantId,
            userId,
            accountId,
            expectedEmail,
            // 비었으면 null 로 넘겨 기본 라벨은 붙여 넣기와 같은 곳(AgentAccountService)이 정하게 한다.
            label,
            verifier,
            started.state(),
            started.authorizeUrl(),
            expiresAt,
            interval,
            now.plusSeconds(interval));
    // 한 사람 한 진행 — 이전 진행(다시 시도 전의 것)을 지운다. 지우기와 넣기 사이에 다른 시작이 끼지 않게 묶는다.
    synchronized (startLock) {
      sessions.values().removeIf(s -> s.tenantId == tenantId && s.userId == userId);
      sessions.put(session.loginId, session);
    }
    log.info("Gen:iA 로그인 시작 userId={} relogin={}", userId, accountId != null);
    return toResponse(session);
  }

  /**
   * 진행 상태를 돌려준다. 대기 중이면 만료 시각을 먼저 보고(지났으면 Gen:iA 를 부르지 않고 EXPIRED), 폴링 간격이 됐을 때만 Gen:iA 를 한 번 부른다.
   * 성공이면 계정을 저장한다.
   *
   * @throws GeniaLoginNotFoundException 없음·남의 것·다른 워크스페이스의 진행(404)
   */
  public GeniaLoginResponse status(long userId, String loginId) {
    long tenantId = TenantContext.require();
    Instant now = clock.instant();
    // 쓸어 내기는 시작 때만 한다 — 대기 중인 진행의 만료는 advance 가 조회 때 판정한다.
    Session s = owned(tenantId, userId, loginId);
    if (s == null) throw new GeniaLoginNotFoundException();
    // 다른 조회가 이미 폴링 중이면 기다리지 않고 지금 상태를 돌려준다(한 진행에 한 폴링).
    if (s.lock.tryLock()) {
      try {
        advance(s, now);
      } finally {
        s.lock.unlock();
      }
    }
    return toResponse(s);
  }

  /**
   * 진행을 지운다 — 없거나 남의 것이면 조용히 넘어간다(창 닫기 취소는 멱등). 취소 표시를 먼저 남겨 지금 폴링 중인 조회가 성공을 받아도 계정을 저장하지 않게 하고,
   * 진행 잠금을 기다려(tryLock 이 아니다) 그 조회가 끝난 뒤에 지운다.
   */
  public void cancel(long userId, String loginId) {
    long tenantId = TenantContext.require();
    Session s = owned(tenantId, userId, loginId);
    if (s == null) return;
    // 잠금 밖에서 먼저 표시한다 — Gen:iA 응답을 기다리는 조회가 저장 직전에 이 표시를 본다.
    s.canceled = true;
    s.lock.lock();
    try {
      if (PENDING.equals(s.status)) finish(s, FAILED, null);
      sessions.remove(loginId, s);
    } finally {
      s.lock.unlock();
    }
  }

  /**
   * Gen:iA access token 을 붙여 넣기 경로와 같은 모양의 auth.json 으로 만든다 — {@code {"genia":{"type":"oauth",
   * "access":…, "refresh":<access>, "expires":<epoch ms>, "email":…, "role":…}}}. Gen:iA 는 따로 갱신
   * 토큰을 주지 않아 refresh 에 access 를 그대로 둔다(정규화기가 refresh 를 요구한다). email·role 이 null 이면 그 키를 뺀다.
   */
  static String toLoginInfo(String accessToken, Instant expiresAt, String email, String role) {
    ObjectNode genia = MAPPER.createObjectNode();
    genia.put("type", "oauth");
    genia.put("access", accessToken);
    genia.put("refresh", accessToken);
    genia.put("expires", expiresAt.toEpochMilli());
    if (email != null) genia.put("email", email);
    if (role != null) genia.put("role", role);
    ObjectNode root = MAPPER.createObjectNode();
    root.set("genia", genia);
    return root.toString();
  }

  /** 대기 중인 진행을 한 걸음 진행시킨다 — 진행 잠금을 쥔 채로만 부른다. */
  private void advance(Session s, Instant now) {
    if (s.canceled || !PENDING.equals(s.status)) return;
    if (!now.isBefore(s.expiresAt)) {
      finish(s, EXPIRED, null);
      return;
    }
    if (now.isBefore(s.nextPollAt)) return;
    PollResult result = client.poll(s.state, s.verifier);
    switch (result) {
      case PollResult.Pending p -> s.nextPollAt = now.plusSeconds(s.intervalSeconds);
      case PollResult.SlowDown d -> {
        s.intervalSeconds += SLOW_DOWN_STEP_SECONDS;
        s.nextPollAt = now.plusSeconds(s.intervalSeconds);
      }
      case PollResult.Expired e -> finish(s, EXPIRED, null);
      case PollResult.Unavailable u -> {
        // 일시 장애는 PENDING 으로 두고 다음 간격에 다시 묻는다(만료 시각이 지나면 위에서 EXPIRED).
        log.info("Gen:iA 로그인 폴링 일시 실패 userId={} code={}", s.userId, u.code());
        s.nextPollAt = now.plusSeconds(s.intervalSeconds);
      }
      case PollResult.Failed f -> {
        log.info("Gen:iA 로그인 실패 userId={} code={}", s.userId, f.code());
        finish(
            s,
            FAILED,
            "bad_response".equals(f.code())
                ? MSG_BAD_RESPONSE
                : "Gen:iA 로그인에 실패했어요 (" + f.code() + ")");
      }
      case PollResult.Success ok -> save(s, ok, now);
    }
  }

  /**
   * 성공한 로그인을 계정으로 저장한다 — 다시 로그인이면 로그인 정보만 바꾸고, 아니면 새 계정을 등록한다. 저장 실패는 FAILED 로 남긴다. 그사이 취소됐으면 저장하지
   * 않는다. 다시 로그인인데 다른 Gen:iA 계정(이메일)으로 로그인했으면 기존 로그인 정보를 지키고 FAILED 로 알린다.
   */
  private void save(Session s, PollResult.Success ok, Instant now) {
    // 폴링 응답을 기다리는 사이 창이 닫혔으면(취소) 계정을 만들지 않는다 — 저장 직전에 본다.
    if (s.canceled) {
      finish(s, FAILED, null);
      return;
    }
    // 서버가 만료 시각을 주지 않으면 Gen:iA 토큰 수명으로 채운다(실패로 끝내지 않는다).
    Instant tokenExpiresAt =
        ok.expiresAt() != null ? ok.expiresAt() : now.plus(DEFAULT_TOKEN_LIFETIME);
    String loginInfo = toLoginInfo(ok.accessToken(), tokenExpiresAt, ok.email(), ok.role());
    try {
      if (s.accountId != null) {
        // 다시 로그인은 같은 사람의 로그인만 받는다 — 다른 계정으로 덮으면 이 계정을 쓰던 AI 가 다른 사람 권한으로 돈다.
        String expected = s.expectedEmail;
        if (expected != null && (ok.email() == null || !expected.equalsIgnoreCase(ok.email()))) {
          log.info("Gen:iA 다시 로그인 계정 불일치 userId={} accountId={}", s.userId, s.accountId);
          finish(s, FAILED, String.format(MSG_OTHER_IDENTITY, expected));
          return;
        }
      }
      AgentAccountResponse saved =
          s.accountId != null
              ? accountService.update(
                  s.userId,
                  s.accountId,
                  new AgentAccountUpdateRequest(null, null, null, loginInfo, null))
              : accountService.register(
                  s.userId,
                  new AgentAccountRequest(
                      AgentProviders.GENIA, null, null, s.label, loginInfo, null));
      s.resultAccountId = saved.id();
      s.resultEmail = saved.accountEmail();
      finish(s, SUCCEEDED, null);
      log.info("Gen:iA 로그인 계정 저장 userId={} accountId={}", s.userId, saved.id());
    } catch (AgentAccountNotFoundException e) {
      finish(s, FAILED, MSG_ACCOUNT_GONE);
    } catch (AgentAccountDuplicateException | InvalidProviderCredentialException e) {
      // 같은 계정 409·형식 400 — 사용자에게 보일 문구라 그대로 싣는다(평문을 담지 않는 고정 문구).
      finish(s, FAILED, e.getMessage());
    } catch (RuntimeException e) {
      // 그 밖의 예외 문구에는 SQL·내부 정보가 섞일 수 있어 종류만 남기고 일반 문구로 답한다.
      log.warn("Gen:iA 로그인 계정 저장 실패 userId={} error={}", s.userId, e.getClass().getSimpleName());
      finish(s, FAILED, MSG_SAVE_FAILED);
    }
  }

  /** 진행을 끝낸다 — 더는 폴링하지 않으므로 code_verifier·state 를 메모리에서 바로 지운다. */
  private static void finish(Session s, String status, String errorMessage) {
    s.status = status;
    s.errorMessage = errorMessage;
    s.verifier = null;
    s.state = null;
  }

  /** 이 사용자·워크스페이스의 진행이면 돌려주고, 아니면 null(남의 진행이 있는지조차 드러내지 않는다). */
  private Session owned(long tenantId, long userId, String loginId) {
    if (loginId == null) return null;
    Session s = sessions.get(loginId);
    return s != null && s.tenantId == tenantId && s.userId == userId ? s : null;
  }

  /** 만료 시각 + 10분이 지난 진행을 쓸어 낸다. */
  private void sweep(Instant now) {
    sessions.values().removeIf(s -> now.isAfter(s.expiresAt.plus(RETAIN_AFTER_EXPIRY)));
  }

  private static GeniaLoginResponse toResponse(Session s) {
    String status = s.status;
    boolean pending = PENDING.equals(status);
    return new GeniaLoginResponse(
        s.loginId,
        status,
        pending ? s.authorizeUrl : null,
        s.expiresAt,
        s.resultAccountId != null ? s.resultAccountId : s.accountId,
        s.resultEmail,
        s.errorMessage);
  }

  /** SecureRandom 32바이트 base64url(43자) — code_verifier·진행 id 에 쓴다. */
  private static String randomToken() {
    return CapabilityTokens.generateUrlSafe(32);
  }

  /**
   * 진행 하나. 바뀌는 필드는 진행 잠금을 쥔 조회만 쓰고, 잠금을 못 쥔 조회도 읽을 수 있게 volatile 이다. verifier·state 는 비밀이라 toString
   * 에서 뺀다.
   */
  private static final class Session {
    final String loginId;
    final long tenantId;
    final long userId;
    final Long accountId;

    /** 다시 로그인 대상 계정의 기존 이메일 — 시작 때 읽어 둔다. null 이면(새 계정·이메일 모름) 어떤 계정이든 받는다. */
    final String expectedEmail;

    /** 새 계정 라벨 — 비었으면 null(기본 라벨은 AgentAccountService 가 붙인다). */
    final String label;

    final String authorizeUrl;
    final Instant expiresAt;
    final ReentrantLock lock = new ReentrantLock();
    volatile String verifier;
    volatile String state;
    volatile int intervalSeconds;
    volatile Instant nextPollAt;
    volatile String status = PENDING;
    volatile Long resultAccountId;
    volatile String resultEmail;
    volatile String errorMessage;

    /** 창 닫기로 취소됐는지 — 잠금 밖에서 먼저 세워 폴링 중인 조회가 저장 직전에 보게 한다. */
    volatile boolean canceled;

    Session(
        String loginId,
        long tenantId,
        long userId,
        Long accountId,
        String expectedEmail,
        String label,
        String verifier,
        String state,
        String authorizeUrl,
        Instant expiresAt,
        int intervalSeconds,
        Instant nextPollAt) {
      this.loginId = loginId;
      this.tenantId = tenantId;
      this.userId = userId;
      this.accountId = accountId;
      this.expectedEmail = expectedEmail;
      this.label = label;
      this.verifier = verifier;
      this.state = state;
      this.authorizeUrl = authorizeUrl;
      this.expiresAt = expiresAt;
      this.intervalSeconds = intervalSeconds;
      this.nextPollAt = nextPollAt;
    }

    /** 비밀(verifier·state)과 진행 id 를 뺀 메타만. */
    @Override
    public String toString() {
      return "GeniaLoginSession[userId="
          + userId
          + ", accountId="
          + accountId
          + ", status="
          + status
          + ", expiresAt="
          + expiresAt
          + "]";
    }
  }
}
