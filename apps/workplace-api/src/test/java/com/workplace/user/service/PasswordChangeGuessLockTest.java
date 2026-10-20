package com.workplace.user.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.LoginRequest;
import com.workplace.auth.exception.AccountLockedException;
import com.workplace.auth.service.AuthService;
import com.workplace.auth.service.LoginAttemptService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.exception.CurrentPasswordMismatchException;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-626: 비밀번호 변경의 현재 비밀번호 확인이 대입 창구가 되지 않는다 — 로그인과 같은 계정별 실패 카운터(5회·15분)를 함께 쓰고, 실패를 감사 로그에 남긴다.
 * 카운터는 별도 트랜잭션에 커밋되므로 테스트마다 다른 아이디를 쓴다.
 */
@Transactional
class PasswordChangeGuessLockTest extends IntegrationTestBase {

  private static final String RIGHT = "Password123";

  @Autowired private UserService userService;
  @Autowired private AuthService authService;
  @Autowired private LoginAttemptService loginAttemptService;
  @Autowired private PasswordEncoder passwordEncoder;
  @Autowired private MembershipRepository membershipRepository;
  @Autowired private DSLContext dsl;

  private Long userId;
  private String username;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    username = "pw-guess-" + System.nanoTime() + "@example.com";
    userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, username)
            .set(USER.PASSWORD, passwordEncoder.encode(RIGHT))
            .set(USER.NAME, "비밀번호 주인")
            .set(USER.EMAIL, username)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    membershipRepository.create(userId, 1L, "ACTIVE");
  }

  @AfterEach
  void clear() {
    loginAttemptService.loginSucceeded(username);
    TenantContext.clear();
  }

  @Test
  void five_wrong_current_passwords_lock_change_and_login_and_are_audited() {
    for (int i = 1; i <= 5; i++) {
      String guess = "Wrong" + i;
      assertThatThrownBy(() -> userService.changePassword(userId, guess, "NewPassw0rd9", null))
          .isInstanceOf(CurrentPasswordMismatchException.class)
          .hasMessage("현재 비밀번호가 올바르지 않습니다");
    }

    // 6번째는 맞는 비밀번호여도 막힌다(429).
    assertThatThrownBy(() -> userService.changePassword(userId, RIGHT, "NewPassw0rd9", null))
        .isInstanceOf(AccountLockedException.class)
        .hasMessage("비밀번호를 여러 번 틀려 잠시 막았습니다. 15분 뒤 다시 시도해 주세요.");
    // 같은 계정 카운터라 로그인도 잠긴다 — 로그인 잠금을 우회하는 추측 창구가 아니다.
    assertThatThrownBy(() -> authService.login(new LoginRequest(username, RIGHT)))
        .isInstanceOf(AccountLockedException.class);
    // 비밀번호는 바뀌지 않았다.
    String stored =
        dsl.select(USER.PASSWORD).from(USER).where(USER.ID.eq(userId)).fetchOne(USER.PASSWORD);
    assertThat(passwordEncoder.matches(RIGHT, stored)).isTrue();
    // 실패 5번이 감사 로그에 남는다.
    assertThat(
            dsl.fetchCount(
                AUDIT_LOG,
                AUDIT_LOG
                    .USER_ID
                    .eq(userId)
                    .and(AUDIT_LOG.ACTION_TYPE.eq("PASSWORD_CHANGE_FAILED"))
                    .and(AUDIT_LOG.RESULT.eq("FAILURE"))))
        .isEqualTo(5);
  }

  @Test
  void success_clears_failed_count() {
    for (int i = 1; i <= 4; i++) {
      String guess = "Wrong" + i;
      assertThatThrownBy(() -> userService.changePassword(userId, guess, "NewPassw0rd9", null))
          .isInstanceOf(CurrentPasswordMismatchException.class);
    }
    userService.changePassword(userId, RIGHT, "NewPassw0rd9", null);

    // 맞히면 실패 카운터를 지운다(로그인 성공과 같다). 같은 테스트 트랜잭션 안에서 다시 틀리게 하면 지운 행을 잡은 채 별도 트랜잭션 카운터가
    // 기다리게 되므로 여기서는 지워졌는지만 본다.
    assertThat(loginAttemptService.isBlocked(username)).isFalse();
    assertThat(dsl.fetchCount(dsl.selectFrom("login_attempts").where("username = ?", username)))
        .isZero();
  }
}
