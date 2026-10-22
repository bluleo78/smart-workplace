package com.workplace.user;

import static com.workplace.jooq.Tables.PERMISSION;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.ROLE_PERMISSION;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import org.hamcrest.Matchers;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 계정 아이디·이메일은 영문·숫자·기호(ASCII 출력 문자)만 받는다(WP-780).
 *
 * <p>제로폭 공백(U+200B)·점자 빈칸(U+2800)·키릴 「к」(U+043A)처럼 눈에 같아 보이는 글자를 끼우면 기존 구성원과 구분되지 않는 계정을 만들거나, 자기
 * 프로필 이메일을 남의 이메일과 똑같아 보이게 바꿀 수 있었다(대소문자만 다른 값은 409 로 막혔다). 관리자 구성원 추가·가입·본인 프로필·에이전트 추가/이름 변경이 모두
 * 같은 규칙을 쓴다.
 */
@Transactional
class AccountIdentifierAsciiTest extends IntegrationTestBase {

  private static final long TENANT_ID = 1L;
  private static final String ZWSP = "kim​7604@t.local";
  private static final String BRAILLE = "kim⠀7604@t.local";
  private static final String CYRILLIC = "кim7604@t.local";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;

  private long admin;
  private long member;

  @BeforeEach
  void seed() {
    TenantContext.set(TENANT_ID);
    admin = TestFixtures.createHuman(dsl);
    TestFixtures.addMember(dsl, admin, TENANT_ID);
    grant(admin, "ADMIN");
    member = TestFixtures.createHuman(dsl);
    TestFixtures.addMember(dsl, member, TENANT_ID);
    grant(member, "USER");
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  void 관리자_구성원_추가는_보이지_않는_글자나_다른_문자_체계_아이디_이메일을_거절한다() throws Exception {
    for (String id : List.of(ZWSP, BRAILLE, CYRILLIC)) {
      as(admin, post("/api/v1/users").content(member(id, null)))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.errors.username", Matchers.containsString("영문")));
      as(admin, post("/api/v1/users").content(member("ok7604@t.local", id)))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.errors.email", Matchers.containsString("영문")));
    }
    assertThat(dsl.fetchCount(USER, USER.USERNAME.like("%7604@t.local"))).isZero();
    // 대조: 영문 아이디는 그대로 만든다.
    as(admin, post("/api/v1/users").content(member("kim7604@t.local", "kim7604@t.local")))
        .andExpect(status().isCreated());
  }

  @Test
  void 본인_프로필_이메일도_같은_규칙() throws Exception {
    as(member, put("/api/v1/users/me").content("{\"name\":\"나\",\"email\":\"" + ZWSP + "\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.email", Matchers.containsString("영문")));
    as(member, put("/api/v1/users/me").content("{\"name\":\"나\",\"email\":\"me7604@t.local\"}"))
        .andExpect(status().is2xxSuccessful());
  }

  @Test
  void 에이전트_추가와_이름_변경의_아이디_이메일도_같은_규칙() throws Exception {
    as(
            admin,
            post("/api/v1/admin/agents")
                .content(
                    "{\"username\":\"" + CYRILLIC + "\",\"name\":\"봇\",\"email\":\"b@t.local\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.username", Matchers.containsString("영문")));
    as(
            admin,
            post("/api/v1/admin/agents")
                .content("{\"username\":\"bot7604\",\"name\":\"봇\",\"email\":\"" + ZWSP + "\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.email", Matchers.containsString("영문")));
    long agent = TestFixtures.createAgentNoToken(dsl);
    TestFixtures.addMember(dsl, agent, TENANT_ID);
    as(
            admin,
            put("/api/v1/admin/agents/" + agent)
                .content("{\"username\":\"" + BRAILLE + "\",\"name\":\"봇\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.username", Matchers.containsString("영문")));
  }

  @Test
  void 가입도_같은_규칙() throws Exception {
    mvc.perform(
            post("/api/v1/auth/signup")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"username\":\"" + ZWSP + "\",\"password\":\"Password123\",\"name\":\"가입\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.username", Matchers.containsString("영문")));
  }

  private static String member(String username, String email) {
    return "{\"username\":\""
        + username
        + "\","
        + (email == null ? "" : "\"email\":\"" + email + "\",")
        + "\"name\":\"김\",\"password\":\"Password123\",\"role\":\"USER\"}";
  }

  private void grant(long userId, String roleName) {
    Long roleId =
        dsl.select(ROLE.ID)
            .from(ROLE)
            .where(ROLE.NAME.eq(roleName).and(ROLE.IS_SYSTEM.isTrue()))
            .fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
  }

  /** 인증 필터가 실어 주는 것처럼 호출자의 실제 권한을 authority 로 싣는다. */
  private ResultActions as(long caller, MockHttpServletRequestBuilder req) throws Exception {
    TenantContext.set(TENANT_ID);
    List<SimpleGrantedAuthority> authorities =
        dsl
            .selectDistinct(PERMISSION.CODE)
            .from(USER_ROLE)
            .join(ROLE_PERMISSION)
            .on(ROLE_PERMISSION.ROLE_ID.eq(USER_ROLE.ROLE_ID))
            .join(PERMISSION)
            .on(PERMISSION.ID.eq(ROLE_PERMISSION.PERMISSION_ID))
            .where(USER_ROLE.USER_ID.eq(caller))
            .fetch(PERMISSION.CODE)
            .stream()
            .map(SimpleGrantedAuthority::new)
            .toList();
    return mvc.perform(
        req.with(
                authentication(new UsernamePasswordAuthenticationToken(caller, "n/a", authorities)))
            .contentType(MediaType.APPLICATION_JSON));
  }
}
