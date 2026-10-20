package com.workplace.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.LoginRequest;
import com.workplace.auth.exception.InvalidTokenException;
import com.workplace.auth.service.AuthService;
import com.workplace.global.security.AuthDetails;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.TestFixtures.LoginableHuman;
import com.workplace.user.service.UserService;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-566 — 비밀번호를 바꾸면 그 사용자의 다른 로그인 세션(다른 기기·브라우저)이 refresh 로 더는 연장되지 않아야 한다. 비밀번호가 새어 바꾼 경우 침입자 세션을
 * 끊기 위해서다. 바꾼 브라우저 세션 자신은 새 refresh 토큰을 받아 이어진다.
 */
@Transactional
class PasswordChangeRevokesSessionsTest extends IntegrationTestBase {

  private static final String PASSWORD = "Password123";
  private static final String NEW_PASSWORD = "Password456";

  @Autowired private AuthService authService;
  @Autowired private UserService userService;
  @Autowired private JwtTokenProvider jwtTokenProvider;
  @Autowired private PasswordEncoder passwordEncoder;
  @Autowired private DSLContext dsl;

  private LoginableHuman user;
  private long tenantId;

  @BeforeEach
  void setUp() {
    tenantId = TestFixtures.createTenant(dsl, "ACTIVE");
    user = TestFixtures.createLoginableHuman(dsl, passwordEncoder.encode(PASSWORD));
    TestFixtures.ensureActiveMember(dsl, user.id(), tenantId);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 비밀번호 로그인 한 번 = 세션 하나. 멤버십이 하나라 그 테넌트가 자동 선택된 refresh 토큰을 돌려준다. */
  private String loginRefreshToken() {
    return authService.login(new LoginRequest(user.username(), PASSWORD)).refreshToken();
  }

  @Test
  void changePassword_revokesOtherSessions_andKeepsChangingSession() {
    String changingSession = loginRefreshToken();
    String otherSession = loginRefreshToken();

    // 바꾸는 요청은 tenant 토큰으로 온다 — 필터가 TenantContext 를 그 테넌트로 맞춘 상태를 재현한다.
    TenantContext.set(tenantId);
    String reissued =
        userService.changePassword(user.id(), PASSWORD, NEW_PASSWORD, AuthDetails.PASSWORD);

    // 다른 기기 세션: refresh 가 막혀야 한다(비밀번호 변경 전 발급분).
    assertThatThrownBy(() -> authService.refresh(otherSession))
        .isInstanceOf(InvalidTokenException.class);
    // 바꾼 세션의 옛 refresh 도 폐기 — 대신 새로 받은 토큰으로 이어진다.
    assertThatThrownBy(() -> authService.refresh(changingSession))
        .isInstanceOf(InvalidTokenException.class);
    assertThat(reissued).isNotNull();
    assertThat(jwtTokenProvider.getTenantIdFromToken(reissued)).isEqualTo(tenantId);
    assertThat(authService.refresh(reissued).accessToken()).isNotBlank();
  }

  @Test
  void changePassword_withoutBrowserSession_revokesAllAndIssuesNothing() {
    String session = loginRefreshToken();

    // PAT·Internal 호출은 인증 수단(details)이 없다 — 이어 줄 브라우저 세션이 없으므로 새 토큰을 내지 않는다.
    TenantContext.set(tenantId);
    String reissued = userService.changePassword(user.id(), PASSWORD, NEW_PASSWORD, null);

    assertThat(reissued).isNull();
    assertThatThrownBy(() -> authService.refresh(session))
        .isInstanceOf(InvalidTokenException.class);
  }
}
