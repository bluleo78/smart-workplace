package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.service.M365OAuthService;
import com.workplace.mail.service.OAuthStateStore;
import com.workplace.mail.service.OAuthStateStore.StateData;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.util.Base64;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
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
@AutoConfigureMockMvc
class M365OAuthServiceTest extends IntegrationTestBase {

  private static final String TENANT2_SLUG = "m365-oauth-test-tenant-2";

  @Autowired MockMvc mockMvc;
  @Autowired DSLContext dsl;
  @Autowired M365OAuthService oauthService;
  @Autowired OAuthStateStore stateStore;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired PlatformTransactionManager txManager;

  /** 실제 AAD 네트워크 대신 스텁으로 대체. */
  @MockitoBean GraphApiClient graphApiClient;

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

  /**
   * ⭐ 블로커 테스트: 미인증(JWT 없음) HTTP 콜백 경로에서 TenantContext 가 비어도 컨트롤러가 state.tenantId 로 설정해 FORCE RLS
   * 하에서 계정이 올바른 테넌트로 생성되어야 한다.
   *
   * <p>RED 검증 방법: 컨트롤러의 TenantContext.set/finally-clear 래퍼를 제거하면 GUC=1(세션 기본값)로 INSERT 되어,
   * TenantContext=2 로 조회 시 비가시 → assertThat 실패 → 테스트 RED.
   *
   * <p>⚠️ @Transactional 없음: 외부 트랜잭션이 connect()의 REQUIRED 에 합류하면 doBegin 이 발화하지 않아 wrapper 효과 무력화.
   */
  @Test
  void callback_setsTenantContext_andCreatesAccountUnderTenant() throws Exception {
    // 두 번째 테넌트 확보 — 세션 GUC=1 마스킹 회피 핵심
    long tid2 = ensureSecondTenant();

    // 사용자 생성 — 두 번째 테넌트의 유저로 커밋(TransactionTemplate)
    long userId =
        new TransactionTemplate(txManager)
            .execute(
                status -> {
                  return (long)
                      (Long)
                          dsl.insertInto(USER)
                              .set(USER.USERNAME, "m365-cb-" + System.nanoTime())
                              .set(USER.NAME, "M365 Callback User")
                              .set(USER.EMAIL, "m365-cb-" + System.nanoTime() + "@example.com")
                              .set(USER.KIND, "HUMAN")
                              .set(USER.PASSWORD, "pw")
                              .returning(USER.ID)
                              .fetchOne()
                              .getId();
                });
    createdUserId = userId;

    // graphApiClient 스텁: exchangeCode 호출 시 토큰 반환
    when(graphApiClient.exchangeCode("CODE"))
        .thenReturn(
            new GraphApiClient.TokenResponse("AT", "RT", 3600, idTokenFor("dh.yang@iacloud.kr")));

    // state 발급 — userId/tenantId=tid2 결속
    String state = stateStore.issue(userId, tid2);

    // 세션 GUC 를 1 로 설정 — 래퍼 없으면 INSERT가 tenant=1 로 오스탬프됨
    setSessionGuc(1L);
    // TenantContext 비워 미인증 상태 재현
    TenantContext.clear();

    // 공개 HTTP 경로 호출 — 인증 없음
    mockMvc
        .perform(
            get("/api/v1/mail/oauth/m365/callback").param("code", "CODE").param("state", state))
        .andExpect(status().is3xxRedirection());

    // 검증: TenantContext=tid2 로 (트랜잭션 안에서) 계정이 조회되어야 한다.
    // findFirstByUserAndEmail 이 @Transactional 이 아니므로 TenantAwareTransactionManager.doBegin 이 발화하지
    // 않는다.
    // 따라서 TransactionTemplate 으로 tx 를 열고, doBegin 내에서 TenantContext=tid2 → GUC=tid2 주입 → 조회.
    // 래퍼 없으면 INSERT 가 GUC=1 로 → TenantContext=tid2 tx 에서 비가시 → assertThat 실패(RED).
    TenantContext.set(tid2); // doBegin 이 읽을 컨텍스트 설정
    final long finalUserId = userId;
    final long finalTid2 = tid2;
    var found =
        new TransactionTemplate(txManager)
            .execute(
                status -> accountRepo.findFirstByUserAndEmail(finalUserId, "dh.yang@iacloud.kr"));
    assertThat(found).isPresent();
    createdAccountId = found.get().id();
    createdTenantId = finalTid2;
    assertThat(found.get().provider()).isEqualTo(com.workplace.mail.dto.MailProvider.M365_GRAPH);
  }
}
