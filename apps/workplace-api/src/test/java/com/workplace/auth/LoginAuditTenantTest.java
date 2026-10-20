package com.workplace.auth;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.AuthDetails;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.jooq.Record2;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-598 — 로그인·로그아웃 감사는 실제로 들어간 워크스페이스에 남아 그 워크스페이스 관리자의 감사 로그에 보인다.
 *
 * <ul>
 *   <li>소속이 하나라 로그인하며 바로 들어가면 로그인 시점에 그 워크스페이스로 기록.
 *   <li>여럿이면 로그인 행은 지금처럼 워크스페이스 없음(운영자용), 고르는 순간(select-tenant) 그 워크스페이스에 「로그인」.
 *   <li>로그아웃은 토큰의 워크스페이스로 기록.
 * </ul>
 *
 * <p>테스트 하버스는 세션 GUC 를 1 로 박으므로, 운영의 「테넌트 고르기 전」 요청을 재현하려고 트랜잭션-로컬 GUC 를 비운 뒤 호출한다. 클래스 전체가 롤백되는 한
 * 트랜잭션이고 MockMvc 도 같은 스레드·커넥션이라 그 설정이 요청까지 이어진다.
 */
@Transactional
class LoginAuditTenantTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired PasswordEncoder passwordEncoder;
  @Autowired ObjectMapper objectMapper;

  private Long userId;
  private String username;

  @BeforeEach
  void setUp() {
    username = "audit-login-" + System.nanoTime() + "@example.com";
    userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, username)
            .set(USER.PASSWORD, passwordEncoder.encode("Password123"))
            .set(USER.NAME, "감사 로그인")
            .returning(USER.ID)
            .fetchOne()
            .getId();
  }

  private Long newTenantWithMembership(String name) {
    Long tid =
        dsl.insertInto(TENANT)
            .set(TENANT.NAME, name)
            .set(TENANT.SLUG, "audit-login-" + System.nanoTime())
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, tid)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return tid;
  }

  /** 운영의 「테넌트 고르기 전」 요청 재현 — 트랜잭션-로컬 GUC 를 비운다. */
  private void clearGuc() {
    dsl.execute("select set_config('app.tenant_id', '', true)");
  }

  /** 이 사용자의 감사 행(action, tenant_id) — RLS 를 피해 GUC 를 보고 싶은 테넌트로 바꿔 읽는다(null 이면 워크스페이스 없음 행). */
  private List<String> actionsSeenBy(Long tenantId) {
    dsl.execute(
        "select set_config('app.tenant_id', ?, true)", tenantId == null ? "" : tenantId.toString());
    List<Record2<String, String>> rows =
        dsl.select(
                field(name("audit_log", "action_type"), String.class),
                field(name("audit_log", "description"), String.class))
            .from(table(name("audit_log")))
            .where(field(name("audit_log", "user_id")).eq(userId))
            .orderBy(field(name("audit_log", "id")))
            .fetch();
    return rows.stream().map(r -> r.value1() + ":" + r.value2()).toList();
  }

  private String login() throws Exception {
    String body =
        mvc.perform(
                post("/api/v1/auth/login")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"username\":\"" + username + "\",\"password\":\"Password123\"}"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return objectMapper.readTree(body).get("accessToken").asText();
  }

  @Test
  void 소속이_하나면_로그인이_그_워크스페이스_감사에_남는다() throws Exception {
    Long tid = newTenantWithMembership("한곳회사");
    clearGuc();

    login();

    assertThat(actionsSeenBy(tid)).containsExactly("LOGIN:로그인 성공");
    assertThat(actionsSeenBy(null)).isEmpty();
  }

  @Test
  void 소속이_여럿이면_고르는_순간_그_워크스페이스에_로그인이_남는다() throws Exception {
    Long a = newTenantWithMembership("가회사");
    Long b = newTenantWithMembership("나회사");
    clearGuc();

    login();
    // 고르기 전 로그인 행은 워크스페이스 없음(운영자용) — 어느 워크스페이스에도 보이지 않는다.
    assertThat(actionsSeenBy(null)).containsExactly("LOGIN:로그인 성공");
    assertThat(actionsSeenBy(a)).isEmpty();

    clearGuc();
    var auth = new UsernamePasswordAuthenticationToken(userId, "n/a", List.of());
    auth.setDetails(new AuthDetails(AuthDetails.PASSWORD));
    mvc.perform(
            post("/api/v1/auth/select-tenant")
                .with(authentication(auth))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"tenantId\":" + b + "}"))
        .andExpect(status().isOk());

    assertThat(actionsSeenBy(b)).containsExactly("LOGIN:워크스페이스 선택으로 로그인");
    assertThat(actionsSeenBy(a)).isEmpty();
  }

  @Test
  void 로그아웃은_토큰의_워크스페이스_감사에_남는다() throws Exception {
    Long tid = newTenantWithMembership("한곳회사");
    clearGuc();
    String token = login();

    clearGuc();
    mvc.perform(post("/api/v1/auth/logout").header("Authorization", "Bearer " + token))
        .andExpect(status().is2xxSuccessful());

    assertThat(actionsSeenBy(tid)).containsExactly("LOGIN:로그인 성공", "LOGOUT:로그아웃");
  }
}
