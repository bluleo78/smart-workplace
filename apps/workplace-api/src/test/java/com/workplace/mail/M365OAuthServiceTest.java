package com.workplace.mail;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.service.M365OAuthService;
import com.workplace.mail.service.OAuthStateStore;
import com.workplace.mail.service.OAuthStateStore.StateData;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.Base64;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * M365 OAuth 서비스·컨트롤러 통합 테스트.
 *
 * <p>⚠️ @Transactional 절대 금지 — 외부 트랜잭션이 connect()의 REQUIRED 에 합류하면
 * TenantAwareTransactionManager.doBegin 이 발화하지 않아 TenantContext 설정 효과가 GUC 에 반영되지 않는다. 시드(INSERT)는
 * TransactionTemplate 으로 커밋, @AfterEach 에서 self-id 스코프로 회수.
 *
 * <p>하버스 세션 GUC=1 마스킹 회피: 블로커 테스트는 테넌트 ID 로 2를 사용한다. 세션 초기화 GUC=1(application-test.yml
 * connection-init-sql)이 설정된 상태에서 TenantContext 를 설정하지 않으면 GUC=1 로 INSERT 된다. TenantContext=2 로 조회하면
 * 해당 행이 보이지 않으므로 테스트가 RED 가 된다 — wrapper 가 있을 때만 GREEN.
 */
class M365OAuthServiceTest extends ExternalClientMockedTestBase {

  private static final String TENANT2_SLUG = "m365-oauth-test-tenant-2";

  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired M365OAuthService oauthService;
  @Autowired OAuthStateStore stateStore;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired PlatformTransactionManager txManager;
  @Autowired JwtTokenProvider jwtTokenProvider;

  /** 실제 AAD 네트워크 대신 스텁으로 대체. */
  @Autowired GraphApiClient graphApiClient;

  /** 테스트에서 생성한 email_account ID (AfterEach 정리용). */
  private Long createdAccountId;

  /** 테스트에서 생성한 user ID (AfterEach 정리용). */
  private Long createdUserId;

  /** createdAccountId 가 속한 테넌트 ID (RLS GUC cleanup용, 0=미설정). */
  private long createdTenantId = 0;

  /** 두 번째 테넌트 ID — 세션 GUC=1 마스킹 회피용. */
  private long ensureSecondTenant() {
    Long existing =
        dsl.select(TENANT.ID).from(TENANT).where(TENANT.SLUG.eq(TENANT2_SLUG)).fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, TENANT2_SLUG)
        .set(TENANT.NAME, "M365 OAuth Test Tenant 2")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** 세션 레벨(false) GUC 설정 — 연결 전체에 적용(트랜잭션 범위 밖). */
  private void setSessionGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', false)");
  }

  /** id_token 더미 생성: header.payload.sig 형태(서명은 junk). */
  private String idTokenFor(String email) {
    String header =
        Base64.getUrlEncoder().withoutPadding().encodeToString("{\"alg\":\"RS256\"}".getBytes());
    String payload =
        Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(("{\"preferred_username\":\"" + email + "\"}").getBytes());
    return header + "." + payload + ".junk-sig";
  }

  @AfterEach
  void cleanup() {
    // 커밋된 시드를 회수한다.
    // RLS FORCE 가 있으므로 올바른 GUC 컨텍스트 없이 삭제하면 0-rows 로 조용히 실패한다.
    // 세션 GUC 를 0(전체 테넌트)으로 변경하는 대신, 슈퍼유저가 아닌 app_tenant 는 RLS 를 우회할 수 없다.
    // 대신: USER 삭제(ON DELETE CASCADE 가 없으므로) → email_account 먼저 삭제.
    // 간편법: dsl 의 세션 GUC 를 1(기본)로 설정하고 테넌트 범위 밖 삭제는 flyway 의 app 유저 로 직접 수행.
    // 실제로는 app 유저(= 소유자)라면 RLS bypass 가 아닌 비소유 app_tenant 가 런타임 유저이므로 — GUC 설정 후 삭제.
    // 가장 간단한 방법: native SQL SET + DELETE in same tx(set_config true = tx-scoped).
    if (createdAccountId != null) {
      final long accId = createdAccountId;
      // 세션 GUC 를 임의의 큰 값 대신 set_config 로 비활성화: DELETE는 전체 삭제(owner bypass)가 아닌 GUC=1 로.
      // 실제 app_tenant 는 비소유자이므로 GUC 없이 DELETE는 0행. 테스트 DB 의 연결 초기화 GUC=1 을 이용한다.
      // (테스트 DB 의 session GUC=1 이 connection-init 으로 항상 설정됨)
      // email_account의 tenant_id=1 이면 세션 GUC=1 로 삭제 가능. tid2 이면 GUC=tid2 필요.
      // 가장 단순한 해법: TransactionTemplate + TenantContext=tid2 로 삭제.
      new TransactionTemplate(txManager)
          .execute(
              status -> {
                // 먼저 tid2 GUC 로 시도
                dsl.execute(
                    "SELECT set_config('app.tenant_id', '"
                        + (createdTenantId != 0 ? createdTenantId : 1)
                        + "', true)");
                dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(accId)).execute();
                return null;
              });
      createdAccountId = null;
    }
    if (createdUserId != null) {
      dsl.deleteFrom(USER).where(USER.ID.eq(createdUserId)).execute();
      createdUserId = null;
    }
    createdTenantId = 0;
    setSessionGuc(1L);
    TenantContext.clear();
  }

  /** 알 수 없는 state 는 거부한다(CSRF 방어). */
  @Test
  void consume_rejectsUnknownState() {
    assertThat(stateStore.consume("bogus")).isEmpty();
  }

  /**
   * 정상 콜백: code 교환 → Graph 계정 생성 + 토큰 암호화 저장.
   *
   * <p>직접 connect() 를 호출하므로 TenantContext 를 수동 설정해 RLS GUC 를 주입한다.
   */
  @Test
  void connect_createsGraphAccountWithEncryptedTokens() {
    long userId = TestFixtures.createHuman(dsl);
    createdUserId = userId;

    // TenantContext 를 tenant=1 로 수동 설정(테스트 세션 GUC=1 과 일치)
    TenantContext.set(1L);
    try {
      when(graphApiClient.exchangeCode("CODE"))
          .thenReturn(
              new GraphApiClient.TokenResponse("AT", "RT", 3600, idTokenFor("dh.yang@iacloud.kr")));

      StateData state = new StateData(userId, 1L, Instant.now().plusSeconds(60));
      long accountId = oauthService.connect("CODE", state);
      createdAccountId = accountId;
      createdTenantId = 1L;

      // 계정이 M365_GRAPH 프로바이더로 생성됐는지 확인
      var acc = accountRepo.findByIdAndUser(userId, accountId).orElseThrow();
      assertThat(acc.provider()).isEqualTo(com.workplace.mail.dto.MailProvider.M365_GRAPH);
      assertThat(acc.emailAddress()).isEqualTo("dh.yang@iacloud.kr");
    } finally {
      TenantContext.clear();
    }
  }

  /** tid2 에 커밋된 사람 사용자를 만든다(TransactionTemplate — connect() 트랜잭션에서 보이게). */
  private long createCommittedUser(String prefix) {
    return new TransactionTemplate(txManager)
        .execute(
            status ->
                (long)
                    (Long)
                        dsl.insertInto(USER)
                            .set(USER.USERNAME, prefix + System.nanoTime())
                            .set(USER.NAME, "M365 Callback User")
                            .set(USER.EMAIL, prefix + System.nanoTime() + "@example.com")
                            .set(USER.KIND, "HUMAN")
                            .set(USER.PASSWORD, "pw")
                            .returning(USER.ID)
                            .fetchOne()
                            .getId());
  }

  /** 그 테넌트 ACTIVE 멤버로 만들고 브라우저 세션과 같은 access token 을 발급한다(JWT 필터가 TenantContext 를 세운다). */
  private String tokenFor(long uid, long tenantId) {
    TestFixtures.ensureActiveMember(dsl, uid, tenantId);
    return jwtTokenProvider.generateAccessToken(uid, "user-" + uid, tenantId);
  }

  private org.springframework.test.web.servlet.ResultActions complete(String token, String state)
      throws Exception {
    var req =
        post("/api/v1/mail/oauth/m365/complete")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"code\":\"CODE\",\"state\":\"" + state + "\"}");
    if (token != null) {
      req = req.header("Authorization", "Bearer " + token);
    }
    return mockMvc.perform(req);
  }

  /**
   * ① 본인 연결(WP-1289): 본인이 시작해 받은 state 로 본인이 완료하면 그 사용자·테넌트로 계정이 생긴다.
   *
   * <p>tid2 사용: JWT 필터가 세운 TenantContext=tid2 가 GUC 로 주입돼야 행이 tid2 에 생긴다 — 세션 GUC=1 로 잘못 들어가면
   * TenantContext=tid2 조회에서 보이지 않아 RED.
   *
   * <p>⚠️ @Transactional 없음: 외부 트랜잭션이 connect()의 REQUIRED 에 합류하면 doBegin 이 발화하지 않는다.
   */
  @Test
  void complete_byStateOwner_createsAccountUnderTenant() throws Exception {
    long tid2 = ensureSecondTenant();
    long userId = createCommittedUser("m365-cb-");
    createdUserId = userId;
    String token = tokenFor(userId, tid2);

    when(graphApiClient.exchangeCode("CODE"))
        .thenReturn(
            new GraphApiClient.TokenResponse("AT", "RT", 3600, idTokenFor("dh.yang@iacloud.kr")));
    String state = stateStore.issue(userId, tid2);
    setSessionGuc(1L);
    TenantContext.clear();

    complete(token, state)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.connected").value(true));

    TenantContext.set(tid2); // 조회 트랜잭션 doBegin 이 읽을 컨텍스트
    var found =
        new TransactionTemplate(txManager)
            .execute(status -> accountRepo.findFirstByUserAndEmail(userId, "dh.yang@iacloud.kr"));
    assertThat(found).isPresent();
    createdAccountId = found.get().id();
    createdTenantId = tid2;
    assertThat(found.get().provider()).isEqualTo(com.workplace.mail.dto.MailProvider.M365_GRAPH);
  }

  /**
   * ② 다른 사용자 state 거부(WP-1289): 공격자가 받은 연결 링크를 피해자가 눌러도 피해자 메일함이 공격자 계정에 연결되지 않는다 — 403, 토큰 교환 없음,
   * 양쪽 모두 계정 없음, 감사 로그 MAIL_OAUTH_STATE_MISMATCH. state 는 소비돼 공격자도 다시 쓰지 못한다.
   */
  @Test
  void complete_withOtherUsersState_isForbidden_andCreatesNothing() throws Exception {
    long tid2 = ensureSecondTenant();
    long attacker = createCommittedUser("m365-attacker-");
    long victim = createCommittedUser("m365-victim-");
    createdUserId = attacker;
    String victimToken = tokenFor(victim, tid2);
    String attackerState = stateStore.issue(attacker, tid2);
    try {
      complete(victimToken, attackerState)
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.connected").value(false))
          .andExpect(jsonPath("$.error").value("state_mismatch"));
      verifyNoInteractions(graphApiClient);
      assertThat(stateStore.consume(attackerState)).isEmpty();

      TenantContext.set(tid2);
      long accounts =
          new TransactionTemplate(txManager)
              .execute(
                  status ->
                      (long)
                          dsl.fetchCount(
                              EMAIL_ACCOUNT, EMAIL_ACCOUNT.USER_ID.in(attacker, victim)));
      assertThat(accounts).isZero();
      long audits =
          new TransactionTemplate(txManager)
              .execute(
                  status ->
                      (long)
                          dsl.fetchCount(
                              AUDIT_LOG,
                              AUDIT_LOG
                                  .USER_ID
                                  .eq(victim)
                                  .and(AUDIT_LOG.ACTION_TYPE.eq("MAIL_OAUTH_STATE_MISMATCH"))
                                  .and(AUDIT_LOG.RESULT.eq("FAILURE"))));
      assertThat(audits).isEqualTo(1);
    } finally {
      // 이 테스트가 남긴 감사 행도 회수한다(공유 테스트 DB 에서 감사 행 수를 세는 다른 테스트를 흔들지 않게).
      cleanupInTenant(
          tid2,
          () ->
              dsl.deleteFrom(AUDIT_LOG)
                  .where(AUDIT_LOG.USER_ID.eq(victim))
                  .and(AUDIT_LOG.ACTION_TYPE.eq("MAIL_OAUTH_STATE_MISMATCH"))
                  .execute());
      TenantContext.clear();
      dsl.deleteFrom(USER).where(USER.ID.eq(victim)).execute();
    }
  }

  /**
   * 같은 사용자라도 다른 워크스페이스에서 발급받은 state 는 받지 않는다 — 시작하지 않은 워크스페이스에 메일함이 붙지 않게. 여러 탭으로 생기는 일이라 공격 감사 로그는
   * 남기지 않는다.
   */
  @Test
  void complete_withStateFromOtherTenant_isForbidden() throws Exception {
    long tid2 = ensureSecondTenant();
    long userId = createCommittedUser("m365-xt-");
    createdUserId = userId;
    String token = tokenFor(userId, tid2);
    String stateForTenant1 = stateStore.issue(userId, 1L);

    complete(token, stateForTenant1)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.error").value("tenant_mismatch"));
    verifyNoInteractions(graphApiClient);
    long audits =
        callInTenant(
            tid2,
            () ->
                (long)
                    dsl.fetchCount(
                        AUDIT_LOG,
                        AUDIT_LOG
                            .USER_ID
                            .eq(userId)
                            .and(AUDIT_LOG.ACTION_TYPE.eq("MAIL_OAUTH_STATE_MISMATCH"))));
    assertThat(audits).isZero();
  }

  /** ③ 비로그인 거부(WP-1289): 유효한 state 가 있어도 토큰 없이 부르면 401 이고 state 도 소비되지 않는다. */
  @Test
  void complete_withoutLogin_isUnauthorized() throws Exception {
    long userId = TestFixtures.createHuman(dsl);
    createdUserId = userId;
    String state = stateStore.issue(userId, 1L);

    complete(null, state).andExpect(status().isUnauthorized());
    verifyNoInteractions(graphApiClient);
    assertThat(stateStore.consume(state)).isPresent();
  }

  /**
   * 유효하지 않은(미발급/만료) state 는 400 + 응답 {connected:false} (CSRF/replay 방어). bogus state 는 consume 에서
   * empty 라 토큰 교환·DB 도달 전에 끝난다.
   */
  @Test
  void complete_rejectsInvalidState() throws Exception {
    long tid2 = ensureSecondTenant();
    long userId = createCommittedUser("m365-bad-");
    createdUserId = userId;

    complete(tokenFor(userId, tid2), "bogus-state")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.connected").value(false))
        .andExpect(jsonPath("$.error").value("invalid_request"));
    verifyNoInteractions(graphApiClient);
  }

  /** 정지·삭제·영구 삭제 중인 테넌트의 토큰으로는 연결하지 않는다(WP-341) — JWT 필터가 그 토큰을 인증하지 않아 401, 토큰 교환도 없다. */
  @ParameterizedTest
  @ValueSource(strings = {"SUSPENDED", "DELETED", "PURGING"})
  void complete_rejectsInactiveTenant(String tenantStatus) throws Exception {
    long tid2 = ensureSecondTenant();
    long userId = createCommittedUser("m365-inactive-");
    createdUserId = userId;
    String token = tokenFor(userId, tid2);
    String state = stateStore.issue(userId, tid2);
    dsl.update(TENANT).set(TENANT.STATUS, tenantStatus).where(TENANT.ID.eq(tid2)).execute();
    try {
      complete(token, state).andExpect(status().isUnauthorized());
      verifyNoInteractions(graphApiClient);
    } finally {
      dsl.update(TENANT).set(TENANT.STATUS, "ACTIVE").where(TENANT.ID.eq(tid2)).execute();
    }
  }
}
