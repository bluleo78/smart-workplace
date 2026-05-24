package com.workplace.auth.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.LoginRequest;
import com.workplace.auth.exception.AgentCannotLoginException;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.UserKind;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** Phase 5a — AGENT 유저가 비밀번호 로그인 흐름을 사용하지 못함을 검증. login_attempts 미증가도 확인. */
@Transactional
class AgentLoginRejectTest extends IntegrationTestBase {

  @Autowired private AuthService authService;
  @Autowired private DSLContext dsl;
  @Autowired private LoginAttemptService loginAttemptService;

  @Test
  void agent_cannot_login_returns_401_without_attempt_counter() {
    long n = System.nanoTime();
    String username = "bot-login-" + n;
    dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .setNull(USER.PASSWORD)
        .set(USER.NAME, "Bot")
        .set(USER.EMAIL, username + "@example.com")
        .set(USER.KIND, UserKind.AGENT)
        .execute();

    // loginAttemptService 가 호출되지 않음을 검증하기 위해 spy 로 래핑
    LoginAttemptService spy = Mockito.spy(loginAttemptService);
    org.springframework.test.util.ReflectionTestUtils.setField(
        authService, "loginAttemptService", spy);

    assertThatThrownBy(() -> authService.login(new LoginRequest(username, "anything")))
        .isInstanceOf(AgentCannotLoginException.class);

    Mockito.verify(spy, Mockito.never()).loginFailed(username);

    // 원본 복원
    org.springframework.test.util.ReflectionTestUtils.setField(
        authService, "loginAttemptService", loginAttemptService);
  }
}
