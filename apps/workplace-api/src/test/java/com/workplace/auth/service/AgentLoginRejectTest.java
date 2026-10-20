package com.workplace.auth.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.LoginRequest;
import com.workplace.auth.exception.InvalidCredentialsException;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.UserKind;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Transactional;

/**
 * 비밀번호 로그인 실패가 계정 존재를 드러내지 않는지 검증(WP-623). AGENT·없는 아이디·비밀번호 없는(SSO 전용) 계정 모두 같은 문구로 거절하고, 비밀번호 해시
 * 비교를 한 번씩 거쳐 응답 시간이 갈리지 않는다. AGENT 는 login_attempts 카운터를 올리지 않는다(Phase 5a).
 */
@Transactional
class AgentLoginRejectTest extends IntegrationTestBase {

  private static final String INVALID = "아이디 또는 비밀번호가 올바르지 않습니다.";

  @Autowired private AuthService authService;
  @Autowired private PasswordLoginVerifier verifier;
  @Autowired private DSLContext dsl;
  @Autowired private LoginAttemptService loginAttemptService;
  @Autowired private PasswordEncoder passwordEncoder;

  private LoginAttemptService attemptSpy;
  private PasswordEncoder encoderSpy;

  @BeforeEach
  void spy() {
    attemptSpy = Mockito.spy(loginAttemptService);
    encoderSpy = Mockito.spy(passwordEncoder);
    ReflectionTestUtils.setField(verifier, "loginAttemptService", attemptSpy);
    ReflectionTestUtils.setField(verifier, "passwordEncoder", encoderSpy);
  }

  @AfterEach
  void restore() {
    ReflectionTestUtils.setField(verifier, "loginAttemptService", loginAttemptService);
    ReflectionTestUtils.setField(verifier, "passwordEncoder", passwordEncoder);
  }

  private String insertUser(String prefix, String kind, String password) {
    String username = prefix + "-" + System.nanoTime() + "@example.com";
    dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.PASSWORD, password)
        .set(USER.NAME, "사용자")
        .set(USER.EMAIL, username)
        .set(USER.KIND, kind)
        .execute();
    return username;
  }

  @Test
  void agent_login_looks_like_unknown_account_without_attempt_counter() {
    String username = insertUser("bot-login", UserKind.AGENT, null);

    assertThatThrownBy(() -> authService.login(new LoginRequest(username, "anything")))
        .isInstanceOf(InvalidCredentialsException.class)
        .hasMessage(INVALID);

    Mockito.verify(attemptSpy, Mockito.never()).loginFailed(username);
    Mockito.verify(encoderSpy, Mockito.times(1))
        .matches(Mockito.eq("anything"), Mockito.anyString());
  }

  @Test
  void unknown_account_still_spends_one_hash_comparison() {
    String username = "nobody-" + System.nanoTime() + "@example.com";

    assertThatThrownBy(() -> authService.login(new LoginRequest(username, "anything")))
        .isInstanceOf(InvalidCredentialsException.class)
        .hasMessage(INVALID);

    Mockito.verify(encoderSpy, Mockito.times(1))
        .matches(Mockito.eq("anything"), Mockito.anyString());
    Mockito.verify(attemptSpy).loginFailed(username);
  }

  @Test
  void sso_only_account_still_spends_one_hash_comparison() {
    String username = insertUser("sso-only", UserKind.HUMAN, null);

    assertThatThrownBy(() -> authService.login(new LoginRequest(username, "anything")))
        .isInstanceOf(InvalidCredentialsException.class)
        .hasMessage(INVALID);

    Mockito.verify(encoderSpy, Mockito.times(1))
        .matches(Mockito.eq("anything"), Mockito.anyString());
  }
}
