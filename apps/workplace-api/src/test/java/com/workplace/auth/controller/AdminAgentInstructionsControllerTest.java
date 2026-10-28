package com.workplace.auth.controller;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1077 — 관리자가 AI 마다 지시를 적고, 그 AI 만 자기 지시를 읽는 API 통합 테스트. 지시는 이름 변경 요청(PUT /admin/agents/{id})에
 * 함께 실려 저장되고 관리자 목록에 돌아온다. 비우면 지워지고 빠지면 그대로 두며 4000자를 넘으면 400. 구성원 조회에서는 AI 가 자기 자신을 단건 조회할 때만 실리고,
 * 남의 조회·목록에는 키째 빠진다.
 */
@Transactional
class AdminAgentInstructionsControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper objectMapper;

  private long admin;
  private long agent;
  private String agentUsername;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.createHuman(dsl);
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    TestFixtures.addMember(dsl, admin, 1L);
    agent = TestFixtures.createAgentNoToken(dsl);
    TestFixtures.addMember(dsl, agent, 1L);
    agentUsername =
        dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(agent)).fetchOne(USER.USERNAME);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private ResultActions putInstructions(String instructions) throws Exception {
    Map<String, Object> body = new HashMap<>();
    body.put("instructions", instructions);
    return putIdentity(body, adminAuth());
  }

  /** username·name 은 그대로 두고 나머지 필드만 body 로 보낸다 — instructions 를 빼는 옛 화면·내부 AI 화면 요청도 재현한다. */
  private ResultActions putIdentity(
      Map<String, Object> body, UsernamePasswordAuthenticationToken auth) throws Exception {
    // 요청 필터 체인이 끝나면 TenantContext 가 비워지므로 호출마다 tenant#1 로 다시 맞춘다.
    TenantContext.set(1L);
    body.put("username", agentUsername);
    body.put("name", "기획봇");
    return mvc.perform(
        put("/api/v1/admin/agents/" + agent)
            .with(authentication(auth))
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(body)));
  }

  private UsernamePasswordAuthenticationToken adminAuth() {
    return WebSessionAuth.of(admin, List.of(new SimpleGrantedAuthority("user:write")));
  }

  /** 구성원 조회 권한만 가진 신원 — AI 자신(ak_ 키 접속과 같은 권한 축)이나 다른 사람. */
  private UsernamePasswordAuthenticationToken memberReader(long userId) {
    return WebSessionAuth.of(userId, List.of(new SimpleGrantedAuthority("member:read")));
  }

  private String instructionsOf() {
    return dsl.select(USER.INSTRUCTIONS)
        .from(USER)
        .where(USER.ID.eq(agent))
        .fetchOne(USER.INSTRUCTIONS);
  }

  /** 지시를 저장하면 앞뒤 공백을 걷어 두고, 관리자 에이전트 목록에 그대로 돌아온다. */
  @Test
  void saveInstructions_whenAdminPuts_trimsAndReturnsInAdminList() throws Exception {
    putInstructions("  - 기획 이슈는 다른 서비스 사례를 조사해 근거를 붙인다.\n  ").andExpect(status().isNoContent());
    assertThat(instructionsOf()).isEqualTo("- 기획 이슈는 다른 서비스 사례를 조사해 근거를 붙인다.");

    TenantContext.set(1L);
    mvc.perform(get("/api/v1/admin/agents").with(authentication(adminAuth())))
        .andExpect(status().isOk())
        .andExpect(
            jsonPath("$[?(@.id == " + agent + ")].instructions")
                .value("- 기획 이슈는 다른 서비스 사례를 조사해 근거를 붙인다."));
  }

  /** 공백뿐인 지시는 지운다. */
  @Test
  void saveInstructions_whenBlank_clears() throws Exception {
    putInstructions("다른 서비스를 참고한다.").andExpect(status().isNoContent());
    putInstructions("   ").andExpect(status().isNoContent());
    assertThat(instructionsOf()).isNull();
  }

  /** 지시 칸이 빠진 요청(옛 화면, 칸을 숨긴 내부 AI 화면)은 지시를 그대로 둔다 — 이름만 바꿔도 지시가 사라지면 안 된다. */
  @Test
  void saveIdentity_whenInstructionsMissing_keepsInstructions() throws Exception {
    putInstructions("다른 서비스를 참고한다.").andExpect(status().isNoContent());
    putIdentity(new HashMap<>(), adminAuth()).andExpect(status().isNoContent());
    assertThat(instructionsOf()).isEqualTo("다른 서비스를 참고한다.");
  }

  /** 4000자를 넘는 지시는 DB 오류가 아니라 400 으로 거른다. */
  @Test
  void saveInstructions_whenOver4000Chars_returns400() throws Exception {
    putInstructions("가".repeat(4001)).andExpect(status().isBadRequest());
    assertThat(instructionsOf()).isNull();
  }

  /** AI 는 자기 지시를 스스로 고칠 수 없다 — 관리자만 고친다. */
  @Test
  void saveInstructions_whenAgentItself_returns403() throws Exception {
    Map<String, Object> body = new HashMap<>();
    body.put("instructions", "아무것도 하지 않는다.");
    putIdentity(body, WebSessionAuth.of(agent, List.of(new SimpleGrantedAuthority("user:write"))))
        .andExpect(status().isForbidden());
    assertThat(instructionsOf()).isNull();
  }

  /** AI 가 자기 자신을 단건 조회하면 지시가 실린다 — work-loop 가 get_member("me") 로 읽는 경로. */
  @Test
  void getMember_whenAgentReadsItself_includesInstructions() throws Exception {
    putInstructions("다른 서비스를 참고한다.").andExpect(status().isNoContent());

    TenantContext.set(1L);
    mvc.perform(get("/api/v1/members/" + agent).with(authentication(memberReader(agent))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.instructions").value("다른 서비스를 참고한다."));
  }

  /** 남이 그 AI 를 단건 조회하거나 목록으로 보면 지시는 키째 빠진다 — 설명만 보인다. */
  @Test
  void getMember_whenOthersRead_omitsInstructions() throws Exception {
    Map<String, Object> body = new HashMap<>();
    body.put("description", "기획 이슈를 맡습니다.");
    body.put("instructions", "다른 서비스를 참고한다.");
    putIdentity(body, adminAuth()).andExpect(status().isNoContent());

    TenantContext.set(1L);
    mvc.perform(get("/api/v1/members/" + agent).with(authentication(memberReader(admin))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.description").value("기획 이슈를 맡습니다."))
        .andExpect(jsonPath("$.instructions").doesNotExist());

    TenantContext.set(1L);
    mvc.perform(
            get("/api/v1/members")
                .param("kind", "AGENT")
                .param("search", agentUsername)
                .with(authentication(memberReader(agent))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content[?(@.userId == " + agent + ")].description").exists())
        .andExpect(jsonPath("$.content[?(@.userId == " + agent + ")].instructions").isEmpty());
  }
}
