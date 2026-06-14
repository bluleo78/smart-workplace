package com.workplace.platform;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.exception.AgentCannotLoginException;
import com.workplace.auth.exception.InvalidCredentialsException;
import com.workplace.auth.exception.InvalidTokenException;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.platform.dto.PlatformLoginRequest;
import com.workplace.platform.exception.PlatformAccessDeniedException;
import com.workplace.platform.service.PlatformAuthService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;

/**
 * PlatformAuthService 단위/통합 테스트 — 운영자 로그인/리프레시의 권한상승 차단·평면 교차 차단을 검증한다.
 *
 * <p>{@code @Transactional} 으로 시드 행·refresh 토큰·브루트포스 카운터를 롤백해 공유 test DB 를 오염시키지 않는다.
 */
@Transactional
class PlatformAuthServiceTest extends IntegrationTestBase {

  private static final String RAW_PASSWORD = "Platform1!";

  @Autowired PlatformAuthService platformAuthService;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired PasswordEncoder passwordEncoder;
  @Autowired DSLContext dsl;

  /** HUMAN 사용자 시드 — 비밀번호는 인코딩해 저장. 반환은 username. */
  private String createHumanUser(String prefix, boolean platformAdmin, boolean active) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    String username = prefix + "-" + suffix;
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, username)
            .set(USER.PASSWORD, passwordEncoder.encode(RAW_PASSWORD))
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, username + "@example.com")
            .set(USER.IS_PLATFORM_ADMIN, platformAdmin)
            .set(USER.IS_ACTIVE, active)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return username;
  }

  /** AGENT 사용자 시드 — password NULL, 반환은 username. */
  private String createAgentUsername(String prefix) {
    Long id = createAgentUser(prefix);
    return dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(id)).fetchOne(USER.USERNAME);
  }

  @Test
  void login_platformAdmin_issuesPlatformToken() {
    String username = createHumanUser("admin", true, true);

    PlatformAuthService.PlatformLoginResult result =
        platformAuthService.login(new PlatformLoginRequest(username, RAW_PASSWORD));

    assertThat(result.accessToken()).isNotBlank();
    // access 토큰은 platform 토큰이고 tenant 클레임이 없어야 한다.
    assertThat(jwtTokenProvider.isPlatformToken(result.accessToken())).isTrue();
    assertThat(jwtTokenProvider.getTenantIdFromToken(result.accessToken())).isNull();
    assertThat(result.refreshToken()).isNotBlank();
    assertThat(jwtTokenProvider.isPlatformToken(result.refreshToken())).isTrue();
  }

  @Test
  void login_nonPlatformAdmin_isDenied() {
    String username = createHumanUser("normal", false, true);

    assertThatThrownBy(
            () -> platformAuthService.login(new PlatformLoginRequest(username, RAW_PASSWORD)))
        .isInstanceOf(PlatformAccessDeniedException.class);
  }

  @Test
  void login_wrongPassword_throwsInvalidCredentials() {
    String username = createHumanUser("admin", true, true);

    assertThatThrownBy(
            () -> platformAuthService.login(new PlatformLoginRequest(username, "wrong-password")))
        .isInstanceOf(InvalidCredentialsException.class);
  }

  @Test
  void login_agentUser_isRejected() {
    String username = createAgentUsername("agent");

    assertThatThrownBy(
            () -> platformAuthService.login(new PlatformLoginRequest(username, RAW_PASSWORD)))
        .isInstanceOf(AgentCannotLoginException.class);
  }

  @Test
  void refresh_platformRefreshToken_issuesNewPlatformToken() throws InterruptedException {
    String username = createHumanUser("admin", true, true);
    PlatformAuthService.PlatformLoginResult login =
        platformAuthService.login(new PlatformLoginRequest(username, RAW_PASSWORD));

    // JWT 는 초 단위 정밀도라 같은 초 안에 재발급하면 토큰이 동일(hash UNIQUE 충돌). 새 토큰을 보장한다.
    Thread.sleep(1100);

    PlatformAuthService.PlatformLoginResult refreshed =
        platformAuthService.refresh(login.refreshToken());

    assertThat(jwtTokenProvider.isPlatformToken(refreshed.accessToken())).isTrue();
    assertThat(jwtTokenProvider.isPlatformToken(refreshed.refreshToken())).isTrue();
  }

  /** 평면 교차 차단: 일반(테넌트) refresh 토큰으로 운영자 refresh 시도 → 거부. */
  @Test
  void refresh_tenantRefreshToken_isRejected() {
    String username = createHumanUser("admin", true, true);
    Long id = dsl.select(USER.ID).from(USER).where(USER.USERNAME.eq(username)).fetchOne(USER.ID);
    // 일반 테넌트 refresh 토큰(platform 클레임 없음). 이 토큰은 validateRefreshToken 은 통과하므로,
    // 평면 교차 가드가 family/reuse 로직 진입 *전* 에 차단함을 증명하려면 가드 고유 메시지("운영자 토큰")로
    // 단언해야 한다(가드 제거 시 existsValidToken 단계의 다른 메시지가 나오므로 단순 타입 단언은 무력).
    String tenantRefresh = jwtTokenProvider.generateRefreshToken(id, 1L);

    assertThatThrownBy(() -> platformAuthService.refresh(tenantRefresh))
        .isInstanceOf(InvalidTokenException.class)
        .hasMessageContaining("운영자 토큰");
  }
}
