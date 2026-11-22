package com.workplace.agentaccount.genialogin;

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
import com.workplace.agentaccount.genialogin.GeniaLoginSessionRepository.Row;
import com.workplace.agentaccount.service.AgentAccountService;
import com.workplace.auth.exception.InvalidProviderCredentialException;
import com.workplace.auth.service.AgentProviders;
import com.workplace.auth.sso.SsoTransactionCookie;
import com.workplace.global.json.JsonMappers;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.global.util.Texts;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Gen:iA 브라우저 로그인 진행 서비스(WP-1461) — 관리자가 [로그인] 을 누르면 PKCE 로 Gen:iA 로그인을 시작하고, 웹의 상태 조회(2초마다) 안에서
 * 간격이 됐을 때만 Gen:iA 를 한 번 폴링해, 성공하면 붙여 넣기와 같은 모양의 auth.json 으로 계정을 등록하거나(새 계정) 로그인 정보만 바꾼다(다시 로그인).
 *
 * <p><b>진행 상태는 DB(genia_login_session)에 둔다</b>(WP-1976) — 시작·조회·취소가 서로 다른 파드로 가도 이어진다.
 * code_verifier·state 는 {@link EncryptionService} 로 암호화해 저장하고 진행이 끝나면 NULL 로 지운다. 모든 DB 접근은 {@link
 * TransactionTemplate} 짧은 트랜잭션이며(RLS 의 테넌트 GUC 는 트랜잭션 시작 때만 주입된다), Gen:iA 외부 HTTP·계정 저장 동안에는 트랜잭션을
 * 쥐지 않는다.
 *
 * <p>스케줄러를 두지 않는다 — 창을 닫거나 탭을 떠나면 조회가 멈추므로 폴링도 저절로 멈춘다. 같은 진행의 동시 조회는 <b>폴링 임대</b>(조건부 UPDATE 로
 * poll_lease_token·poll_lease_until 을 잡은 쪽만)로 하나만 폴링하고 나머지는 지금 상태를 그대로 돌려준다(토큰 교환·계정 저장이 두 번 일어나지
 * 않게). 폴링 결과는 임대 토큰이 일치할 때만 반영하고, 임대를 쥔 파드가 죽어도 폴링 임대({@link #MIN_POLL_LEASE} 이상)가 지나면 다른 파드가
 * 이어받는다.
 *
 * <p>한 사람 한 진행: 같은 (워크스페이스, 사용자)가 새로 시작하면 이전 진행을 지운다(유일 제약). 끝난 진행은 만료 시각 + 10분까지 남겨 같은 결과를 다시
 * 돌려주고(멱등), 시작 때 지난 것을 쓸어 낸다. code_verifier·state·access token 은 응답·로그·toString 어디에도 싣지 않는다.
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

  /** 서버가 준 만료 시각의 상한 — 이상한 값이 와도 진행이 오래 남지 않게 한다. */
  private static final Duration MAX_LIFETIME = Duration.ofMinutes(30);

  static final String MSG_BAD_RESPONSE = "Gen:iA 로그인 서버 응답을 읽지 못했어요";
  static final String MSG_ACCOUNT_GONE = "다시 로그인할 계정을 찾지 못했어요";
  static final String MSG_SAVE_FAILED = "Gen:iA 계정을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요";
  static final String MSG_NOT_GENIA = "Gen:iA 로그인 계정만 다시 로그인할 수 있어요";
  static final String MSG_POLL_ERROR = "Gen:iA 로그인을 확인하지 못했어요. 다시 시도해 주세요";

  /** 다시 로그인 창에서 다른 Gen:iA 계정으로 로그인했을 때 — 뒤에 기존 이메일을 넣는다. */
  static final String MSG_OTHER_IDENTITY = "다른 Gen:iA 계정으로 로그인했어요 — %s 로 로그인해 주세요";

  /**
   * 폴링 임대 최소 시간 — 임대를 쥔 파드가 죽어도 이 시간 뒤 다른 파드가 이어받는다. 실제 임대는 Gen:iA HTTP 타임아웃(연결+응답)의 2배와 이 값 중 큰
   * 쪽이라 타임아웃을 늘려도 폴링 중에 임대가 풀려 두 번 폴링하지 않는다(기본 5+10초면 30초).
   */
  static final Duration MIN_POLL_LEASE = Duration.ofSeconds(30);

  private static final ObjectMapper MAPPER = JsonMappers.JACKSON2;

  private final GeniaLoginClient client;
  private final AgentAccountService accountService;
  private final GeniaLoginSessionRepository repo;
  private final EncryptionService encryption;
  private final TransactionTemplate tx;
  private final Clock clock;

  /** 이 서비스가 쓰는 폴링 임대 시간 — 설정된 Gen:iA HTTP 타임아웃에서 구한다. */
  private final Duration pollLease;

  /** 운영 생성자 — 시스템 UTC 시계, 폴링 임대는 설정된 Gen:iA HTTP 타임아웃에서 구한다. */
  @Autowired
  public GeniaLoginService(
      GeniaLoginClient client,
      AgentAccountService accountService,
      GeniaLoginSessionRepository repo,
      EncryptionService encryption,
      PlatformTransactionManager txManager,
      GeniaLoginProperties props) {
    this(client, accountService, repo, encryption, txManager, Clock.systemUTC(), leaseFor(props));
  }

  /** 시각·폴링 임대를 바꿔 끼우는 테스트용 생성자. TransactionTemplate 을 직접 만들어 직접 생성한 인스턴스에도 트랜잭션이 걸린다. */
  GeniaLoginService(
      GeniaLoginClient client,
      AgentAccountService accountService,
      GeniaLoginSessionRepository repo,
      EncryptionService encryption,
      PlatformTransactionManager txManager,
      Clock clock,
      Duration pollLease) {
    this.client = client;
    this.accountService = accountService;
    this.repo = repo;
    this.encryption = encryption;
    this.tx = new TransactionTemplate(txManager);
    this.clock = clock;
    this.pollLease = pollLease;
  }

  /** 폴링 임대 — 폴링(연결+응답) 한 번보다 충분히 길게, 설정 타임아웃의 2배와 최소 30초 중 큰 쪽. */
  static Duration leaseFor(GeniaLoginProperties props) {
    Duration twiceTimeouts = props.connectTimeout().plus(props.readTimeout()).multipliedBy(2);
    return twiceTimeouts.compareTo(MIN_POLL_LEASE) > 0 ? twiceTimeouts : MIN_POLL_LEASE;
  }

  /**
   * 로그인을 시작한다 — 다시 로그인이면 대상 계정을 먼저 검사(없음 404, Gen:iA 아님 400)하고, code_verifier 를 만들어 S256 challenge
   * 로 Gen:iA 로그인을 시작한 뒤 진행을 DB 에 저장한다. 같은 사용자의 이전 진행은 지운다.
   *
   * @throws GeniaLoginUnavailableException Gen:iA 서버에 닿지 못했거나 응답을 쓸 수 없을 때(502)
   */
  public GeniaLoginResponse start(long userId, GeniaLoginStartRequest req) {
    long tenantId = TenantContext.require();
    Instant now = clock.instant();
    Long accountId = req.accountId();
    String expectedEmail = null;
    if (accountId != null) {
      // 대상 계정을 Gen:iA 를 부르기 전에 확인한다 — 없는 계정·다른 종류로 바깥 서버를 부르지 않게(트랜잭션 밖).
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
    Row row =
        new Row(
            randomToken(),
            tenantId,
            userId,
            accountId,
            expectedEmail,
            // 비었으면 null 로 넘겨 기본 라벨은 붙여 넣기와 같은 곳(AgentAccountService)이 정하게 한다.
            label,
            encryption.encrypt(verifier),
            encryption.encrypt(started.state()),
            started.authorizeUrl(),
            expiresAt,
            interval,
            now.plusSeconds(interval),
            PENDING,
            null,
            null,
            null);
    // 동시에 같은 사람이 시작해 유일 제약에 걸리면 한 번 다시(삭제→삽입) 시도한다.
    if (!replaceSession(row, now) && !replaceSession(row, now)) {
      log.warn("Gen:iA 로그인 진행 저장 실패(동시 시작 충돌) userId={}", userId);
      throw new GeniaLoginUnavailableException();
    }
    log.info("Gen:iA 로그인 시작 userId={} relogin={}", userId, accountId != null);
    return toResponse(row);
  }

  /** 지난 진행 쓸기 + 이전 진행 지우기 + 새 진행 넣기를 한 트랜잭션으로 한다. 유일 제약 충돌이면 false. */
  private boolean replaceSession(Row row, Instant now) {
    return Boolean.TRUE.equals(
        tx.execute(
            status -> {
              repo.sweep(now, RETAIN_AFTER_EXPIRY);
              // 창을 닫아 버려진(만료가 지난) 진행의 암호문은 쓸 일이 없으니 쓸기 전이라도 먼저 지운다.
              repo.clearExpiredSecrets(now);
              repo.deleteByUser(row.tenantId(), row.userId());
              return repo.insert(row);
            }));
  }

  /**
   * 진행 상태를 돌려준다. 대기 중이면 만료 시각을 먼저 보고(지났으면 Gen:iA 를 부르지 않고 EXPIRED), 폴링 간격이 됐고 폴링 임대를 얻었을 때만 Gen:iA
   * 를 한 번 부른다. 성공이면 계정을 저장한다. 임대를 못 얻으면(다른 조회·파드가 폴링 중) 지금 행 상태 그대로 돌려준다.
   *
   * @throws GeniaLoginNotFoundException 없음·남의 것·다른 워크스페이스의 진행(404)
   */
  public GeniaLoginResponse status(long userId, String loginId) {
    Row row = read(userId, loginId);
    if (row == null) throw new GeniaLoginNotFoundException();
    Instant now = clock.instant();
    if (!PENDING.equals(row.status())) return toResponse(row);
    // 이 조회가 행을 바꿨을 때만 다시 읽는다(바꾸지 않았으면 처음 읽은 값이 최신이다).
    boolean wrote = false;
    boolean polled = false;
    if (!now.isBefore(row.expiresAt())) {
      // 만료가 지났으면 폴링하지 않고 조건부로 EXPIRED 로 끝낸다.
      wrote = Boolean.TRUE.equals(tx.execute(s -> repo.expireIfPending(loginId, now)));
    } else if (!now.isBefore(row.nextPollAt())) {
      UUID token = UUID.randomUUID();
      Boolean leased =
          tx.execute(s -> repo.tryAcquireLease(loginId, token, now, now.plus(pollLease)));
      polled = Boolean.TRUE.equals(leased);
      if (polled) {
        wrote = true;
        poll(row, token, now);
      }
    }
    if (!wrote) {
      // 만료가 지났는데 다른 파드의 임대가 살아 있어 EXPIRED 로 끝내지 못했으면, 진행은 대기 중으로 두되 이미 만료된 로그인 링크는 내보내지 않는다.
      if (!now.isBefore(row.expiresAt())) return withoutAuthorizeUrl(toResponse(row));
      return toResponse(row);
    }
    // 반영 결과를 다시 읽는다. 그사이 취소돼 행이 없어졌을 때, 폴링한 조회는 취소로 끝난 상태(FAILED)를 돌려주고(이 조회가 시작될 때는 진행이
    // 있었다) 폴링하지 않은 조회는 404 다.
    Row after = read(userId, loginId);
    if (after != null) return toResponse(after);
    if (!polled) throw new GeniaLoginNotFoundException();
    return new GeniaLoginResponse(
        loginId, FAILED, null, row.expiresAt(), row.accountId(), null, null);
  }

  /**
   * 진행을 지운다 — 없거나 남의 것이면 조용히 넘어간다(창 닫기 취소는 멱등). 행을 지우면 되므로 별도 취소 표시는 없다. 지금 폴링 중인 조회가 성공을 받아도 반영
   * 직전의 임대 확인(claimForSave)이 행이 없음을 보고 계정을 저장하지 않는다.
   */
  public void cancel(long userId, String loginId) {
    if (loginId == null) return;
    tx.executeWithoutResult(s -> repo.deleteByLoginId(loginId, userId));
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

  /** 이 사용자의 진행을 읽는다(없음·남의 것·다른 테넌트면 null). */
  private Row read(long userId, String loginId) {
    if (loginId == null) return null;
    return tx.execute(s -> repo.find(loginId, userId).orElse(null));
  }

  /**
   * 임대를 쥔 채 Gen:iA 를 한 번 폴링하고 결과를 반영한다 — 외부 HTTP 는 트랜잭션 밖에서 부른다. 예상하지 못한 예외(복호화 실패·클라이언트 오류 등)는 조회를
   * 500 으로 끝내지 않고 FAILED 로 끝내 임대를 푼다 — 같은 예외를 임대 시간마다 되풀이하며 사용자를 기다리게 하지 않는다.
   */
  private void poll(Row row, UUID token, Instant now) {
    String loginId = row.loginId();
    if (row.verifierEnc() == null || row.stateEnc() == null) {
      // 만료가 지나 다른 파드가 비밀을 지웠다(시계가 조금 어긋난 파드) — 폴링할 수 없으니 만료로 끝낸다.
      end(loginId, token, now, EXPIRED, null, null, null);
      return;
    }
    PollResult result;
    try {
      String verifier = encryption.decrypt(row.verifierEnc());
      String state = encryption.decrypt(row.stateEnc());
      result = client.poll(state, verifier);
    } catch (RuntimeException e) {
      // 복호화·클라이언트의 예상 못 한 예외만 여기서 FAILED 로 끝낸다(문구에 내부 정보가 섞일 수 있어 종류만 남긴다). 계정 저장 뒤의 예외는 잡지
      // 않는다 — 저장된 로그인을 FAILED 로 바꾸면 다시 시도가 중복(409)·두 번째 계정으로 이어진다.
      log.warn("Gen:iA 로그인 폴링 오류 userId={} error={}", row.userId(), e.getClass().getSimpleName());
      fail(loginId, token, clock.instant(), MSG_POLL_ERROR);
      return;
    }
    switch (result) {
      case PollResult.Pending p -> keepWaiting(row, token, now, row.intervalSeconds());
      case PollResult.SlowDown d ->
          keepWaiting(row, token, now, row.intervalSeconds() + SLOW_DOWN_STEP_SECONDS);
      case PollResult.Expired e -> end(loginId, token, now, EXPIRED, null, null, null);
      case PollResult.Unavailable u -> {
        // 일시 장애는 PENDING 으로 두고 다음 간격에 다시 묻는다(만료 시각이 지나면 조회 때 EXPIRED).
        log.info("Gen:iA 로그인 폴링 일시 실패 userId={} code={}", row.userId(), u.code());
        keepWaiting(row, token, now, row.intervalSeconds());
      }
      case PollResult.Failed f -> {
        log.info("Gen:iA 로그인 실패 userId={} code={}", row.userId(), f.code());
        fail(
            loginId,
            token,
            now,
            "bad_response".equals(f.code())
                ? MSG_BAD_RESPONSE
                : "Gen:iA 로그인에 실패했어요 (" + f.code() + ")");
      }
      case PollResult.Success ok -> save(row, token, ok);
    }
  }

  /** 계속 대기 — 다음 폴링 시각·간격을 임대 토큰이 일치할 때만 반영하고 임대를 푼다. */
  private void keepWaiting(Row row, UUID token, Instant now, int intervalSeconds) {
    tx.executeWithoutResult(
        s ->
            repo.continuePending(
                row.loginId(), token, now, now.plusSeconds(intervalSeconds), intervalSeconds));
  }

  /** 실패로 끝낸다 — 사용자에게 보일 문구와 함께. 임대를 잃어 0건이면 남기기만 한다(이어받은 쪽이 끝낸다). */
  private void fail(String loginId, UUID token, Instant now, String errorMessage) {
    if (!end(loginId, token, now, FAILED, errorMessage, null, null)) {
      log.info("Gen:iA 로그인 실패 반영 0건(임대 잃음·취소) — 이어받은 쪽 결과를 둔다");
    }
  }

  /**
   * 성공으로 끝낸다 — 저장된 계정 id·이메일과 함께. 계정은 이미 저장됐으므로, 저장하는 사이 임대가 끊겨 다른 파드가 이어받았으면(토큰 불일치로 0건) 아직 대기 중인
   * 행에 토큰 없이 성공을 반영한다 — 이어받은 쪽이 이미 쓴 device code 로 다시 폴링해 FAILED 를 띄우면 계정은 저장됐는데 화면은 실패인 불일치가 남는다.
   * 행이 없으면(취소) 저장된 계정만 남는다(스펙이 받아들인 한계).
   */
  private void succeed(
      String loginId, long userId, UUID token, Instant now, long accountId, String email) {
    if (end(loginId, token, now, SUCCEEDED, null, accountId, email)) return;
    Boolean recovered =
        tx.execute(s -> repo.finishPendingWithoutLease(loginId, userId, now, accountId, email));
    log.warn(
        "Gen:iA 로그인 성공 반영 0건(임대 잃음·취소) accountId={} 대기 행에 반영={}",
        accountId,
        Boolean.TRUE.equals(recovered));
  }

  /** 진행 끝 반영 — 임대 토큰이 일치할 때만(비밀 NULL·임대 해제 포함). 반영했으면 true. fail·succeed 와 EXPIRED 호출만 쓴다. */
  private boolean end(
      String loginId,
      UUID token,
      Instant now,
      String status,
      String errorMessage,
      Long resultAccountId,
      String resultEmail) {
    return Boolean.TRUE.equals(
        tx.execute(
            s ->
                repo.finish(
                    loginId, token, now, status, errorMessage, resultAccountId, resultEmail)));
  }

  /**
   * 성공한 로그인을 계정으로 저장한다 — 다시 로그인이면 로그인 정보만 바꾸고, 아니면 새 계정을 등록한다. 저장 실패는 FAILED 로 남긴다. 그사이 취소·만료로
   * 끝났으면(행이 없거나 대기 중이 아님) 저장하지 않는다. 다시 로그인인데 다른 Gen:iA 계정(이메일)으로 로그인했으면 기존 로그인 정보를 지키고 FAILED 로
   * 알린다. 계정 저장은 트랜잭션 밖에서(자기 트랜잭션으로) 한다.
   */
  private void save(Row row, UUID token, PollResult.Success ok) {
    String loginId = row.loginId();
    // 임대 연장·끝 반영은 지금 시각으로 한다 — 폴링 전 시각으로 연장하면 Gen:iA 응답을 기다린 만큼 임대가 짧아져 계정 저장 중에 풀릴 수 있다.
    Instant now = clock.instant();
    // 저장 직전에 임대를 다시 확인·연장한다 — 폴링 응답을 기다리는 사이 임대가 끊겨 다른 파드가 이어받았거나 취소·만료로 끝났으면 0건이라 저장하지 않는다
    // (저장하고도 UI 는 FAILED/EXPIRED 를 보거나 두 번 등록되는 불일치를 막는다). 연장한 임대로 아래 계정 저장 동안 임대가 유지된다.
    // 알려진 한계(스펙이 받아들임): 이 확인 뒤 register/update 도중에 오는 취소는 막지 못한다 — 저장은 끝나고 행은 취소로 지워진다.
    // 저장 동안은 다른 파드가 이어받지 못하게 임대를 진행 만료 시각(이미 지났으면 지금) + 폴링 임대까지 늘린다(WP-1976 리뷰 후속) — 저장이 폴링 임대보다
    // 오래 걸려 이어받은 파드가 이미 쓴 device code 로 다시 폴링해 FAILED 를 먼저 내보내면, 계정은 저장됐는데 화면은 실패로 멈춘다. 저장 중 파드가
    // 죽으면 그 시각까지 대기로 남다가(로그인 링크는 만료 뒤 숨김) 임대가 끝나면 EXPIRED 로 끝난다.
    Instant saveLeaseUntil = saveLeaseUntil(row.expiresAt(), now);
    Boolean claimed =
        tx.execute(s -> repo.claimForSave(loginId, row.userId(), token, now, saveLeaseUntil));
    if (!Boolean.TRUE.equals(claimed)) return;
    // 서버가 만료 시각을 주지 않으면 Gen:iA 토큰 수명으로 채운다(실패로 끝내지 않는다).
    Instant tokenExpiresAt =
        ok.expiresAt() != null ? ok.expiresAt() : now.plus(DEFAULT_TOKEN_LIFETIME);
    String loginInfo = toLoginInfo(ok.accessToken(), tokenExpiresAt, ok.email(), ok.role());
    Long accountId = row.accountId();
    try {
      if (accountId != null) {
        // 다시 로그인은 같은 사람의 로그인만 받는다 — 다른 계정으로 덮으면 이 계정을 쓰던 AI 가 다른 사람 권한으로 돈다.
        String expected = row.expectedEmail();
        if (expected != null && (ok.email() == null || !expected.equalsIgnoreCase(ok.email()))) {
          log.info("Gen:iA 다시 로그인 계정 불일치 userId={} accountId={}", row.userId(), accountId);
          fail(loginId, token, clock.instant(), String.format(MSG_OTHER_IDENTITY, expected));
          return;
        }
      }
      AgentAccountResponse saved =
          accountId != null
              ? accountService.update(
                  row.userId(),
                  accountId,
                  new AgentAccountUpdateRequest(null, null, null, loginInfo, null))
              : accountService.register(
                  row.userId(),
                  new AgentAccountRequest(
                      AgentProviders.GENIA, null, null, row.label(), loginInfo, null));
      succeed(loginId, row.userId(), token, clock.instant(), saved.id(), saved.accountEmail());
      log.info("Gen:iA 로그인 계정 저장 userId={} accountId={}", row.userId(), saved.id());
    } catch (AgentAccountNotFoundException e) {
      fail(loginId, token, clock.instant(), MSG_ACCOUNT_GONE);
    } catch (AgentAccountDuplicateException | InvalidProviderCredentialException e) {
      // 같은 계정 409·형식 400 — 사용자에게 보일 문구라 그대로 싣는다(평문을 담지 않는 고정 문구).
      fail(loginId, token, clock.instant(), e.getMessage());
    } catch (RuntimeException e) {
      // 그 밖의 예외 문구에는 SQL·내부 정보가 섞일 수 있어 종류만 남기고 일반 문구로 답한다.
      log.warn(
          "Gen:iA 로그인 계정 저장 실패 userId={} error={}", row.userId(), e.getClass().getSimpleName());
      fail(loginId, token, clock.instant(), MSG_SAVE_FAILED);
    }
  }

  /** 저장 중 임대 만료 — 진행 만료 시각과 지금 중 늦은 쪽 + 폴링 임대. 저장 동안 다른 파드가 이어받아 다시 폴링하지 못하게 한다. */
  Instant saveLeaseUntil(Instant sessionExpiresAt, Instant now) {
    return (sessionExpiresAt.isAfter(now) ? sessionExpiresAt : now).plus(pollLease);
  }

  /** 로그인 링크만 뺀 응답 — 만료가 지난 대기 진행에 쓴다. */
  private static GeniaLoginResponse withoutAuthorizeUrl(GeniaLoginResponse r) {
    return new GeniaLoginResponse(
        r.id(), r.status(), null, r.expiresAt(), r.accountId(), r.accountEmail(), r.errorMessage());
  }

  /** 응답 매핑 — 대기 중일 때만 authorizeUrl, 결과 계정이 없으면 다시 로그인 대상 accountId. */
  private static GeniaLoginResponse toResponse(Row r) {
    boolean pending = PENDING.equals(r.status());
    return new GeniaLoginResponse(
        r.loginId(),
        r.status(),
        pending ? r.authorizeUrl() : null,
        r.expiresAt(),
        r.resultAccountId() != null ? r.resultAccountId() : r.accountId(),
        r.resultEmail(),
        r.errorMessage());
  }

  /** SecureRandom 32바이트 base64url(43자) — code_verifier·진행 id 에 쓴다. */
  private static String randomToken() {
    return CapabilityTokens.generateUrlSafe(32);
  }
}
