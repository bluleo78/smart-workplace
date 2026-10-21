package com.workplace.auth;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.LOGIN_ATTEMPTS;
import static com.workplace.jooq.Tables.PLATFORM_USER_ROLE;
import static com.workplace.jooq.Tables.REFRESH_TOKEN;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.LoginRequest;
import com.workplace.auth.exception.InvalidCredentialsException;
import com.workplace.auth.service.AuthService;
import com.workplace.global.security.AuthDetails;
import com.workplace.global.tenant.TenantContext;
import com.workplace.platform.dto.PlatformLoginRequest;
import com.workplace.platform.repository.PlatformRoleRepository;
import com.workplace.platform.service.PlatformAuthService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.exception.CurrentPasswordMismatchException;
import com.workplace.user.service.UserService;
import java.sql.Connection;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * 로그인·비밀번호 확인이 커넥션을 둘 겹쳐 쥐지 않는지(WP-752).
 *
 * <p>로그인 트랜잭션이 커넥션을 쥔 채 실패 카운터를 REQUIRES_NEW(두 번째 커넥션)로 기록하면, 풀 크기만큼 틀린 로그인이 동시에 들어올 때 모두가 두 번째
 * 커넥션을 기다려 풀 타임아웃(30초)까지 API 전체가 멈췄다 — 인증 없이 누구나 부를 수 있는 경로라 서비스 거부가 된다. 테스트 풀(2개) 중 하나를 테스트가 쥔 채
 * 로그인을 부르면 「남은 하나로 끝나는지」가 결정적으로 드러난다. 교착이면 그 하나를 바깥 트랜잭션이 쥐고 두 번째를 기다리며 멈춘다.
 */
class LoginConnectionPoolTest extends IntegrationTestBase {

  private static final String PASSWORD = "Password123";

  /** 정상이면 1초 안에 끝난다. 교착이면 풀 타임아웃(30초)까지 멈추므로 그보다 넉넉히 짧게 둔다. */
  private static final long DEADLINE_SECONDS = 10;

  @Autowired private AuthService authService;
  @Autowired private PlatformAuthService platformAuthService;
  @Autowired private UserService userService;
  @Autowired private PasswordEncoder passwordEncoder;
  @Autowired private PlatformRoleRepository platformRoleRepository;
  @Autowired private DataSource dataSource;

  private final List<Long> userIds = new ArrayList<>();
  private final List<String> usernames = new ArrayList<>();
  private TestFixtures.LoginableHuman user;

  @BeforeEach
  void seed() {
    user = TestFixtures.createLoginableHuman(baseDsl, passwordEncoder.encode(PASSWORD));
    userIds.add(user.id());
    usernames.add(user.username());
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    baseDsl.deleteFrom(LOGIN_ATTEMPTS).where(LOGIN_ATTEMPTS.USERNAME.in(usernames)).execute();
    baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(userIds)).execute();
    baseDsl.deleteFrom(REFRESH_TOKEN).where(REFRESH_TOKEN.USER_ID.in(userIds)).execute();
    baseDsl.deleteFrom(PLATFORM_USER_ROLE).where(PLATFORM_USER_ROLE.USER_ID.in(userIds)).execute();
    baseDsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
  }

  /** 풀의 커넥션 하나를 테스트가 쥔 채, 다른 스레드에서 작업이 남은 하나만으로 끝나는지 본다. */
  private <T> T withOneConnectionLeft(Callable<T> work) throws Exception {
    ExecutorService pool = Executors.newSingleThreadExecutor();
    try (Connection held = dataSource.getConnection()) {
      held.createStatement().execute("SELECT 1");
      return pool.submit(work).get(DEADLINE_SECONDS, TimeUnit.SECONDS);
    } catch (ExecutionException e) {
      if (e.getCause() instanceof Exception cause) throw cause;
      throw e;
    } finally {
      pool.shutdownNow();
      pool.awaitTermination(40, TimeUnit.SECONDS);
    }
  }

  private int attempts(String username) {
    Integer n =
        baseDsl
            .select(LOGIN_ATTEMPTS.ATTEMPTS)
            .from(LOGIN_ATTEMPTS)
            .where(LOGIN_ATTEMPTS.USERNAME.eq(username))
            .fetchOne(LOGIN_ATTEMPTS.ATTEMPTS);
    return n == null ? 0 : n;
  }

  @Test
  void 없는_아이디로_틀린_로그인은_커넥션_하나로_끝나고_실패를_센다() throws Exception {
    String nobody = "nobody-" + System.nanoTime() + "@t.local";
    usernames.add(nobody);
    assertThatThrownBy(
            () ->
                withOneConnectionLeft(() -> authService.login(new LoginRequest(nobody, "Wrong1"))))
        .isInstanceOf(InvalidCredentialsException.class);
    assertThat(attempts(nobody)).isEqualTo(1);
  }

  @Test
  void 있는_계정의_틀린_로그인도_커넥션_하나로_끝나고_실패를_센다() throws Exception {
    assertThatThrownBy(
            () ->
                withOneConnectionLeft(
                    () -> authService.login(new LoginRequest(user.username(), "Wrong1"))))
        .isInstanceOf(InvalidCredentialsException.class);
    assertThat(attempts(user.username())).isEqualTo(1);
  }

  @Test
  void 맞는_로그인도_커넥션_하나로_끝나고_실패_카운터를_지운다() throws Exception {
    baseDsl
        .insertInto(LOGIN_ATTEMPTS)
        .set(LOGIN_ATTEMPTS.USERNAME, user.username())
        .set(LOGIN_ATTEMPTS.ATTEMPTS, 2)
        .set(LOGIN_ATTEMPTS.EXPIRES_AT, java.time.LocalDateTime.now().plusMinutes(15))
        .execute();
    var result =
        withOneConnectionLeft(() -> authService.login(new LoginRequest(user.username(), PASSWORD)));
    assertThat(result.accessToken()).isNotBlank();
    assertThat(attempts(user.username())).isZero();
  }

  @Test
  void 운영자_로그인의_틀린_비밀번호도_커넥션_하나로_끝난다() throws Exception {
    platformRoleRepository.assignSuperAdmin(user.id());
    assertThatThrownBy(
            () ->
                withOneConnectionLeft(
                    () ->
                        platformAuthService.login(
                            new PlatformLoginRequest(user.username(), "Wrong1"))))
        .isInstanceOf(InvalidCredentialsException.class);
    assertThat(attempts(user.username())).isEqualTo(1);
    var ok =
        withOneConnectionLeft(
            () -> platformAuthService.login(new PlatformLoginRequest(user.username(), PASSWORD)));
    assertThat(ok.accessToken()).isNotBlank();
    assertThat(attempts(user.username())).isZero();
  }

  @Test
  void 비밀번호_변경의_현재_비밀번호_불일치도_커넥션_하나로_끝나고_실패를_센다() throws Exception {
    assertThatThrownBy(
            () ->
                withOneConnectionLeft(
                    () ->
                        userService.changePassword(
                            user.id(), "Wrong1", "Password456", AuthDetails.PASSWORD)))
        .isInstanceOf(CurrentPasswordMismatchException.class);
    assertThat(attempts(user.username())).isEqualTo(1);
  }
}
