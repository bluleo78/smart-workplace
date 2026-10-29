package com.workplace.auth;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.LOGIN_ATTEMPTS;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.util.ClientIpExtractor;
import com.workplace.support.AsyncPools;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
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
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-1152·WP-1161 — 아이디·비밀번호 로그인 실패가 감사 로그 「로그인 실패」(LOGIN_FAILED/FAILURE)로 그 계정의 워크스페이스에 남는다. 없는
 * 아이디는 남기지 않고, 잠기는 실패는 「잠김」으로 한 번만, 잠긴 뒤의 시도는 남기지 않는다.
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

  private static final String BAD = "로그인 실패: 비밀번호가 올바르지 않음";
  private static final String LOCKED = "로그인 실패: 비밀번호를 여러 번 틀려 잠김";

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
    // 워크스페이스 없는 행(운영자 로그인 실패) — 워크스페이스 없는 GUC 로 지운다.
    inGlobal(() -> dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(userId)).execute());
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(userId)).execute();
          dsl.deleteFrom(LOGIN_ATTEMPTS).where(LOGIN_ATTEMPTS.USERNAME.eq(username)).execute();
          dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
        });
  }

  /**
   * 워크스페이스 없는 감사 행(운영자 열람)을 본다 — 테스트 DB 는 커넥션마다 GUC 를 워크스페이스 1 로 고정해 두어(connection-init-sql), 트랜잭션
   * 안에서 GUC 를 비워야 그 행이 보인다(RLS: tenant_id IS NOT DISTINCT FROM GUC).
   */
  private <T> T inGlobal(Supplier<T> body) {
    return new TransactionTemplate(txManager)
        .execute(
            status -> {
              dsl.execute("select set_config('app.tenant_id', '', true)");
              return body.get();
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
    assertThat(failures.subList(0, 4)).containsOnly(BAD);
    assertThat(failures.get(4)).isEqualTo(LOCKED);
  }

  @Test
  void 잠금이_풀린_뒤에는_다시_다섯_번을_세고_그때_잠김으로_한_번_남는다() throws Exception {
    for (int i = 0; i < 5; i++) login(username, "wrong-" + i, status().isUnauthorized());
    // 잠금 시간이 지났지만 정리 스케줄러가 아직 행을 지우지 않은 상태 — 카운터는 5 그대로다.
    dsl.execute(
        "update login_attempts set expires_at = now() - interval '1 minute' where username = ?",
        username);
    // WP-1161: 만료된 카운터는 1부터 다시 센다 — 한 번 틀렸다고 바로 다시 잠기지 않고, 다섯 번째에 한 번만 잠김으로 남는다.
    for (int i = 0; i < 5; i++) login(username, "again-" + i, status().isUnauthorized());
    login(username, "again-locked", status().is4xxClientError());

    List<String> failures = failuresInTenant1();
    assertThat(failures).hasSize(10);
    assertThat(failures.subList(5, 9)).containsOnly(BAD);
    assertThat(failures.get(9)).isEqualTo(LOCKED);
  }

  @Test
  void 잠금_직전에_동시에_틀려도_잠김은_한_번만_남는다() throws Exception {
    // WP-1161: 카운터가 4일 때 실패가 동시에 들어오면 카운터가 5·6·7 로 오른다 — 기준에 막 닿은 한 건만 잠김이다.
    for (int i = 0; i < 4; i++) login(username, "wrong-" + i, status().isUnauthorized());
    int parallel = 4;
    CountDownLatch start = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(parallel);
    try {
      List<Future<?>> futures = new ArrayList<>();
      for (int i = 0; i < parallel; i++) {
        String pw = "race-" + i;
        futures.add(
            pool.submit(
                () -> {
                  start.await();
                  login(username, pw, status().is4xxClientError());
                  return null;
                }));
      }
      start.countDown();
      for (Future<?> f : futures) f.get(30, TimeUnit.SECONDS);
    } finally {
      pool.shutdownNow();
    }

    // 잠금 확인을 함께 지나와 카운터를 6·7 로 올린 요청도 「잠긴 뒤의 시도」라 남지 않는다 — 잠그기 전 4건 + 잠김 1건.
    List<String> failures = failuresInTenant1();
    assertThat(failures).hasSize(5);
    assertThat(failures.get(4)).isEqualTo(LOCKED);
  }

  @Test
  void 비밀번호_없는_SSO_전용_계정은_그_사유로_남는다() throws Exception {
    // WP-1161: 비밀번호가 없는 계정을 「비밀번호가 올바르지 않음」으로 남기면 SSO 전용 계정이 두드려지는 것을 알아볼 수 없다.
    dsl.update(USER).setNull(USER.PASSWORD).where(USER.ID.eq(userId)).execute();
    login(username, "anything", status().isUnauthorized());

    assertThat(failuresInTenant1()).containsExactly("로그인 실패: 비밀번호 로그인을 쓰지 않는 계정(SSO 전용)");
    assertThat(
            callInTenant(
                1L,
                () ->
                    dsl.select(AUDIT_LOG.ERROR_MESSAGE)
                        .from(AUDIT_LOG)
                        .where(AUDIT_LOG.USER_ID.eq(userId))
                        .and(AUDIT_LOG.ACTION_TYPE.eq("LOGIN_FAILED"))
                        .fetchOne(AUDIT_LOG.ERROR_MESSAGE)))
        .isEqualTo("PASSWORD_LOGIN_DISABLED");
  }

  @Test
  void 운영자_로그인_실패는_운영자_감사와_그_계정의_워크스페이스에_남는다() throws Exception {
    // WP-1161: 운영자 로그인은 전에 실패를 남기지 않았다 — 성공(PLATFORM_LOGIN)과 같은 워크스페이스 없는 행으로 남긴다.
    mvc.perform(
            post("/api/platform/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .header("User-Agent", "wp1161-platform")
                .content("{\"username\":\"" + username + "\",\"password\":\"wrong\"}"))
        .andExpect(status().isUnauthorized());
    AsyncPools.awaitIdle(loginAuditExecutor);

    var rows =
        inGlobal(
            () ->
                dsl.selectFrom(AUDIT_LOG)
                    .where(AUDIT_LOG.USER_ID.eq(userId))
                    .and(AUDIT_LOG.ACTION_TYPE.eq("PLATFORM_LOGIN_FAILED"))
                    .fetch());
    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).getTenantId()).isNull();
    assertThat(rows.get(0).getResult()).isEqualTo("FAILURE");
    assertThat(rows.get(0).getDescription()).isEqualTo(BAD);
    assertThat(rows.get(0).getUserAgent()).isEqualTo("wp1161-platform");
    // 잠금 카운터를 일반 로그인과 함께 쓰므로 그 계정의 워크스페이스 관리자도 본다 — 운영자 화면에서 온 것임을 붙여.
    assertThat(failuresInTenant1()).containsExactly(BAD + " (운영자 로그인)");
  }

  @Test
  void 긴_X_Forwarded_For_도_감사_열_길이로_잘려_로그인이_깨지지_않는다() throws Exception {
    // WP-1161: 일반 로그인 감사는 IP 를 자르지 않고 넣어, 45자를 넘는 X-Forwarded-For 면 감사 INSERT 가 실패해 로그인이 깨졌다.
    String longIp = "1".repeat(60);
    mvc.perform(
            post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .header("X-Forwarded-For", longIp + ", 10.0.0.1")
                .content("{\"username\":\"" + username + "\",\"password\":\"Password123\"}"))
        .andExpect(status().isOk());

    String ip =
        dsl.select(AUDIT_LOG.IP_ADDRESS)
            .from(AUDIT_LOG)
            .where(AUDIT_LOG.USER_ID.eq(userId))
            .and(AUDIT_LOG.ACTION_TYPE.eq("LOGIN"))
            .fetchOne(AUDIT_LOG.IP_ADDRESS);
    assertThat(ip).isEqualTo("1".repeat(ClientIpExtractor.AUDIT_IP_MAX));
  }
}
