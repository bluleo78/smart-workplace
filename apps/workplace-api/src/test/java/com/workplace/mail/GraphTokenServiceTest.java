package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * GraphTokenService 토큰 갱신·회전 통합 테스트.
 *
 * <p>GraphApiClient 는 @MockitoBean 으로 스텁 — 실제 AAD 네트워크 불필요. 테스트 격리를 위해 @Transactional 롤백 사용.
 *
 * <p>⚠️ 이 테스트는 토큰 "회전 저장" 동작만 검증한다. @Transactional이 없을 때의 RLS fail-closed 동작은 Tasks 5/6 라이브 통합에서
 * 검증한다(advisor 권고: 이 테스트에서 RLS-safe 선언 과잉주장 금지).
 */
@Transactional
class GraphTokenServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired GraphTokenService graphTokenService;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EncryptionService encryption;

  /** 실제 AAD 네트워크 대신 스텁으로 대체한다. */
  @MockitoBean GraphApiClient graphApiClient;

  /**
   * M365_GRAPH 계정을 test DB 에 직접 삽입하고 accountId 를 반환한다.
   *
   * <p>V90 이후 IMAP 관련 컬럼(host/port/security/username/encrypted_password)이 nullable 이므로 OAuth 계정은 해당
   * 값 없이 삽입한다. provider='M365_GRAPH', oauth_refresh_token=암호화값, expiresAt 은 호출자 지정.
   *
   * @param userId 계정 소유자(TestFixtures.createHuman 으로 생성한 id)
   * @param plainRefreshToken 평문 refresh_token(삽입 시 암호화 적용)
   * @param expiresAt access_token 만료 시각
   * @return 생성된 accountId
   */
  private long seedGraphAccount(long userId, String plainRefreshToken, OffsetDateTime expiresAt) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "graph-test-" + userId + "@example.com")
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, "Graph 테스트 계정")
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt(plainRefreshToken))
        .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, expiresAt) // 만료 시각(과거 = 갱신 트리거)
        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * access_token 만료 임박 시 graphApiClient.refresh() 가 호출되고, 응답의 새 refresh_token 이 DB 에 회전 저장된다.
   *
   * <p>AAD 는 매 갱신마다 refresh_token 을 회전시키므로, 응답의 새 refresh_token 을 반드시 저장해야 다음 갱신이 정상 동작한다.
   */
  @Test
  void getAccessToken_rotatesAndPersistsNewRefreshToken() {
    // 사용자 생성 (TestFixtures 패턴 — userId 1L 하드코딩 금지, FK 위반 방지)
    long userId = TestFixtures.createHuman(dsl);

    // 만료 시각을 1분 전으로 설정 → 만료 임박 조건 충족(2분 이내)
    long accountId = seedGraphAccount(userId, "OLD_RT", OffsetDateTime.now().minusMinutes(1));

    // AAD refresh 응답: 새 access_token + 회전된 새 refresh_token
    when(graphApiClient.refresh("OLD_RT"))
        .thenReturn(new GraphApiClient.TokenResponse("NEW_AT", "NEW_RT", 3600, null));

    String at = graphTokenService.getAccessToken(userId, accountId);

    // access_token 이 갱신된 값으로 반환됨
    assertThat(at).isEqualTo("NEW_AT");

    // DB 에 저장된 refresh_token 이 회전된 새 값("NEW_RT")임
    var tokens = accountRepo.findOAuthTokens(userId, accountId).orElseThrow();
    assertThat(encryption.decrypt(tokens.refreshToken())).isEqualTo("NEW_RT");
  }

  /** access_token 이 아직 유효하면(만료 2분 이상 남음) refresh 를 호출하지 않고 캐시된 access_token 을 복호화해 반환한다. */
  @Test
  void getAccessToken_returnsCachedTokenWhenNotExpired() {
    long userId = TestFixtures.createHuman(dsl);

    // access_token 만료까지 1시간 남음 → 갱신 불필요
    OffsetDateTime futureExp = OffsetDateTime.now().plusHours(1);
    long accountId = seedGraphAccount(userId, "RT_VALID", futureExp);

    // access_token 도 함께 저장(캐시 상태)
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt("CACHED_AT"))
        .where(EMAIL_ACCOUNT.ID.eq(accountId))
        .execute();

    String at = graphTokenService.getAccessToken(userId, accountId);

    assertThat(at).isEqualTo("CACHED_AT");
    // graphApiClient.refresh 는 호출되지 않아야 함
    org.mockito.Mockito.verifyNoInteractions(graphApiClient);
  }
}
