package com.workplace.agentruntime;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasItems;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** WP-1246 실행 템플릿 조회 API 통합 테스트 — 관리자 목록·단건 조회, 없는 이름 404, 관리자가 아니면 403. */
@Transactional
class AdminAgentTemplateApiTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/admin/agent-templates";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  private Authentication auth(long userId) {
    return new UsernamePasswordAuthenticationToken(
        userId, "n/a", java.util.List.of(new SimpleGrantedAuthority("user:write")));
  }

  /** 테넌트#1 멤버십이 있는 사람 — admin 이면 ADMIN 역할을 준다. */
  private long human(boolean admin) {
    long id = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    if (admin) TestFixtures.grantRole(dsl, id, "ADMIN");
    return id;
  }

  /** 목록에 「기본」·「Claude Code」·「Gen:iA Code」(WP-1296)가 있고, claude-code 의 첫 설정 칸 첫 선택지가 opus. */
  @Test
  void list_asAdmin_returnsBundledTemplates() throws Exception {
    long admin = human(true);

    mvc.perform(get(BASE).with(authentication(auth(admin))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[*].name", hasItems("default", "claude-code", "genia-code")))
        .andExpect(
            jsonPath("$[?(@.name=='claude-code')].config[0].options[0].value").value("opus"));
  }

  /**
   * 목록 JSON 에 템플릿의 AI 계정(account)이 실린다 — claude-code 는 anthropic, genia-code 는 genia, 기본은
   * null(WP-1296·1297).
   */
  @Test
  void list_exposesAccountDerivedFromRequires() throws Exception {
    long admin = human(true);

    mvc.perform(get(BASE).with(authentication(auth(admin))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.name=='claude-code')].account").value("anthropic"))
        .andExpect(jsonPath("$[?(@.name=='default')].account").value(contains(nullValue())))
        .andExpect(jsonPath("$[?(@.name=='genia-code')].account").value("genia"))
        .andExpect(jsonPath("$[?(@.name=='test-chatgpt')].account").value("chatgpt"));
  }

  /** 없는 이름은 404. */
  @Test
  void get_whenUnknown_returns404() throws Exception {
    long admin = human(true);

    mvc.perform(get(BASE + "/nope").with(authentication(auth(admin))))
        .andExpect(status().isNotFound());
  }

  /** 이름으로 한 개를 읽을 수 있다. */
  @Test
  void get_whenKnown_returnsTemplate() throws Exception {
    long admin = human(true);

    mvc.perform(get(BASE + "/claude-code").with(authentication(auth(admin))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.kind").value("WORKSPACE"))
        .andExpect(jsonPath("$.sidecars[0].name").value("dind"));
  }

  /** ADMIN 역할이 없으면(user:write 만 있어도) 403. */
  @Test
  void list_asNonAdmin_returns403() throws Exception {
    long member = human(false);

    mvc.perform(get(BASE).with(authentication(auth(member)))).andExpect(status().isForbidden());
  }
}
