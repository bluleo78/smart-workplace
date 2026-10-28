package com.workplace.auth;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.LOGIN_ATTEMPTS;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.support.AsyncPools;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.concurrent.Executor;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultMatcher;

/**
 * WP-1152 — 아이디·비밀번호 로그인 실패가 감사 로그 「로그인 실패」(LOGIN_FAILED/FAILURE)로 그 계정의 워크스페이스에 남는다. 없는 아이디는 남기지
 * 않고, 잠기는 실패는 「잠김」으로 한 번만, 잠긴 뒤의 시도는 남기지 않는다.
 *
 * <p>기록은 요청 스레드 밖 전용 풀에서 쓰므로(응답 시간으로 계정 존재가 드러나지 않게) 커밋된 데이터가 필요하다 — 트랜잭션 없이 시드하고 풀이 빌 때까지 기다린 뒤
 * 본다.
 */
class LoginFailureAuditTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired PasswordEncoder passwordEncoder;

  @Autowired
  @Qualifier("loginAuditExecutor")
  Executor loginAuditExecutor;

  private Long userId;
  private String username;

  @BeforeEach
  void seed() {
    username = "login-fail-" + System.nanoTime() + "@example.com";
    userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, username)
            .set(USER.PASSWORD, passwordEncoder.encode("Password123"))
            .set(USER.NAME, "실패 감사")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    withMembership(userId);
  }

  @AfterEach
  void cleanup() {
    AsyncPools.awaitIdle(loginAuditExecutor);
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(userId)).execute();
          dsl.deleteFrom(LOGIN_ATTEMPTS).where(LOGIN_ATTEMPTS.USERNAME.eq(username)).execute();
          dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
        });
  }

  private void login(String user, String password, ResultMatcher expected) throws Exception {
    mvc.perform(
            post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .header("User-Agent", "wp1152-test")
                .content("{\"username\":\"" + user + "\",\"password\":\"" + password + "\"}"))
        .andExpect(expected);
  }

  /** 이 계정의 실패 감사(설명) — 워크스페이스 1 에서 보이는 것. */
  private List<String> failuresInTenant1() {
    AsyncPools.awaitIdle(loginAuditExecutor);
    return callInTenant(
        1L,
        () ->
            dsl.select(AUDIT_LOG.DESCRIPTION)
                .from(AUDIT_LOG)
                .where(AUDIT_LOG.USER_ID.eq(userId))
                .and(AUDIT_LOG.ACTION_TYPE.eq("LOGIN_FAILED"))
                .and(AUDIT_LOG.RESULT.eq("FAILURE"))
                .orderBy(AUDIT_LOG.ID)
                .fetch(AUDIT_LOG.DESCRIPTION));
  }

  @Test
  void 틀린_비밀번호는_그_계정의_워크스페이스에_로그인_실패로_남는다() throws Exception {
    login(username, "wrong-1", status().isUnauthorized());

    assertThat(failuresInTenant1()).containsExactly("로그인 실패: 비밀번호가 올바르지 않음");
    var row =
        callInTenant(
            1L,
            () ->
                dsl.selectFrom(AUDIT_LOG)
                    .where(AUDIT_LOG.USER_ID.eq(userId))
                    .and(AUDIT_LOG.ACTION_TYPE.eq("LOGIN_FAILED"))
                    .fetchOne());
    assertThat(row.getUsername()).isEqualTo(username);
    assertThat(row.getUserAgent()).isEqualTo("wp1152-test");
    assertThat(row.getIpAddress()).isNotBlank();
  }

  @Test
  void 없는_아이디는_남기지_않는다() throws Exception {
    String ghost = "no-such-" + System.nanoTime() + "@example.com";
    login(ghost, "whatever", status().isUnauthorized());
    AsyncPools.awaitIdle(loginAuditExecutor);
    assertThat(
            callInTenant(
                1L,
                () ->
                    dsl.fetchCount(
                        AUDIT_LOG,
                        AUDIT_LOG
                            .USERNAME
                            .eq(ghost)
                            .and(AUDIT_LOG.ACTION_TYPE.eq("LOGIN_FAILED")))))
        .isZero();
    cleanupInTenant(
        1L,
        () -> dsl.deleteFrom(LOGIN_ATTEMPTS).where(LOGIN_ATTEMPTS.USERNAME.eq(ghost)).execute());
  }

  @Test
  void 다섯_번째_실패는_잠김으로_한_번_남고_잠긴_뒤의_시도는_남지_않는다() throws Exception {
    for (int i = 0; i < 5; i++) login(username, "wrong-" + i, status().isUnauthorized());
    // 잠긴 뒤의 시도 — 거절되지만 기록은 늘지 않는다.
    login(username, "wrong-locked", status().is4xxClientError());

    List<String> failures = failuresInTenant1();
    assertThat(failures).hasSize(5);
    assertThat(failures.subList(0, 4)).containsOnly("로그인 실패: 비밀번호가 올바르지 않음");
    assertThat(failures.get(4)).isEqualTo("로그인 실패: 비밀번호를 여러 번 틀려 잠김");
  }

  @Test
  void 잠금이_풀린_뒤_다시_잠기면_그때도_잠김으로_남는다() throws Exception {
    for (int i = 0; i < 5; i++) login(username, "wrong-" + i, status().isUnauthorized());
    // 잠금 시간이 지났지만 정리 스케줄러가 아직 행을 지우지 않은 상태 — 카운터는 5 그대로다.
    dsl.execute(
        "update login_attempts set expires_at = now() - interval '1 minute' where username = ?",
        username);
    login(username, "wrong-again", status().isUnauthorized());

    List<String> failures = failuresInTenant1();
    assertThat(failures).hasSize(6);
    assertThat(failures.get(5)).isEqualTo("로그인 실패: 비밀번호를 여러 번 틀려 잠김");
  }
}
