package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.agentruntime.config.AgentRuntimeProperties;
import com.workplace.auth.dto.AgentApiKeyIssueResponse;
import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.dto.UserKind;
import java.time.OffsetDateTime;
import java.util.List;
import org.jooq.DSLContext;
import org.jooq.Record2;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.restclient.RestTemplateBuilder;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

/**
 * WP-1707 — 외부 AI 의 플러그인 버전 보고(X-Genia-Plugin-Version) 통합 테스트.
 *
 * <p>AI 키 인증 요청의 헤더를 키마다 기록하고(값이 바뀔 때만 시각을 고친다), 형식이 아니거나 헤더가 없거나 사람 요청이면 기록하지 않으며, 에이전트 관리 목록·상세
 * 응답에 보고 버전·보고 시각·최신 버전(workplace.agent-runtime.plugin-version)을 싣는지 본다. 실제 HTTP 로 필터를 지나야 하므로 트랜잭션
 * 없이 돌리고 손으로 정리한다(ApiKeyAuthenticationFilterTest 와 같은 방식).
 */
@TestPropertySource(properties = "workplace.agent-runtime.plugin-version= 0.1.53 ")
class AgentPluginVersionApiTest extends IntegrationTestBase {

  private static final String HEADER = "X-Genia-Plugin-Version";

  @Autowired private AgentApiKeyService keyService;
  @Autowired private DSLContext dsl;
  @Autowired private MockMvc mvc;
  @Autowired private AgentRuntimeProperties properties;
  @LocalServerPort private int port;

  private final RestTemplate rest = new RestTemplateBuilder().build();

  private Long adminId;
  private Long agentId;

  @BeforeEach
  void seed() {
    long n = System.nanoTime();
    adminId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "admin-apv-" + n)
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, "Admin")
            .set(USER.EMAIL, "admin-apv-" + n + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    TestFixtures.grantRole(dsl, adminId, "ADMIN");
    withMembership(adminId);
    // 외부 실행 AI — 관리 목록의 runMode 가 EXTERNAL 이 된다.
    agentId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "agent-apv-" + n)
            .setNull(USER.PASSWORD)
            .set(USER.NAME, "Agent")
            .set(USER.EMAIL, "agent-apv-" + n + "@example.com")
            .set(USER.KIND, UserKind.AGENT)
            .set(USER.AGENT_RUNTIME, "EXTERNAL")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    withMembership(agentId);
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    // 키 발급 감사 로그가 tenant#1 로 남으므로 그 테넌트 GUC 안에서 지운다. agent_api_key 는 user 삭제 CASCADE.
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(agentId, adminId)).execute();
          // 키가 발급한 관리자를 created_by 로 가리키므로 AI(키 CASCADE)를 먼저 지운다.
          dsl.deleteFrom(USER).where(USER.ID.eq(agentId)).execute();
          dsl.deleteFrom(USER).where(USER.ID.eq(adminId)).execute();
        });
  }

  /** 실제 HTTP 로 /users/me 를 부른다 — 필터 체인(AI 키 인증)을 지나게. version 이 null 이면 헤더를 싣지 않는다. */
  private HttpStatus callMe(String plaintextKey, String version) {
    HttpHeaders headers = new HttpHeaders();
    headers.set("Authorization", "Bearer " + plaintextKey);
    if (version != null) headers.set(HEADER, version);
    try {
      ResponseEntity<String> r =
          rest.exchange(
              "http://localhost:" + port + "/api/v1/users/me",
              HttpMethod.GET,
              new HttpEntity<>(headers),
              String.class);
      return HttpStatus.valueOf(r.getStatusCode().value());
    } catch (HttpStatusCodeException e) {
      return HttpStatus.valueOf(e.getStatusCode().value());
    }
  }

  /** 키 한 개의 (plugin_version, plugin_version_at). */
  private Record2<String, OffsetDateTime> stored(long keyId) {
    return dsl.select(AGENT_API_KEY.PLUGIN_VERSION, AGENT_API_KEY.PLUGIN_VERSION_AT)
        .from(AGENT_API_KEY)
        .where(AGENT_API_KEY.ID.eq(keyId))
        .fetchOne();
  }

  private AgentApiKeyIssueResponse issueKey() {
    return keyService.issue(adminId, agentId, new IssueAgentKeyRequest("apv"));
  }

  private UsernamePasswordAuthenticationToken admin() {
    return new UsernamePasswordAuthenticationToken(
        adminId, "n/a", List.of(new SimpleGrantedAuthority("user:write")));
  }

  @Test
  void latestVersion_isTrimmedFromProperty() {
    assertThat(properties.pluginVersion()).isEqualTo("0.1.53");
  }

  @Test
  void blankLatestVersion_isNull() {
    // 로컬처럼 env 가 비면 null — 웹은 최신을 모르면 판정하지 않는다.
    var empty = new AgentRuntimeProperties(null, null, null, null, null, "  ");
    assertThat(empty.pluginVersion()).isNull();
    assertThat(new AgentRuntimeProperties(null, null, null, null, null, null).pluginVersion())
        .isNull();
  }

  @Test
  void aiKeyRequest_recordsVersion_onlyWhenChanged() {
    AgentApiKeyIssueResponse key = issueKey();

    assertThat(callMe(key.plaintextKey(), "0.1.49")).isEqualTo(HttpStatus.OK);
    var first = stored(key.id());
    assertThat(first.value1()).isEqualTo("0.1.49");
    assertThat(first.value2()).isNotNull();

    // 같은 값이 다시 오면 시각을 고치지 않는다(매 요청 쓰기 없음).
    assertThat(callMe(key.plaintextKey(), "0.1.49")).isEqualTo(HttpStatus.OK);
    assertThat(stored(key.id()).value2()).isEqualTo(first.value2());

    // 바뀐 값은 기록하고 시각도 옮긴다.
    assertThat(callMe(key.plaintextKey(), "0.1.50")).isEqualTo(HttpStatus.OK);
    var changed = stored(key.id());
    assertThat(changed.value1()).isEqualTo("0.1.50");
    assertThat(changed.value2()).isAfterOrEqualTo(first.value2());
  }

  @Test
  void missingOrMalformedHeader_keepsStoredVersion_andRequestStillSucceeds() {
    AgentApiKeyIssueResponse key = issueKey();
    // 보고한 적이 없고 헤더도 없으면 비어 있다.
    assertThat(callMe(key.plaintextKey(), null)).isEqualTo(HttpStatus.OK);
    assertThat(stored(key.id()).value1()).isNull();

    callMe(key.plaintextKey(), "0.1.49");
    var before = stored(key.id());

    // 헤더 없음·숫자.점 아님·주입 시도·32자 초과 — 요청은 그대로 되고 기록은 남은 값 그대로.
    for (String bad :
        new String[] {null, "", "latest", "0.1.49; drop", "1." + "1".repeat(31), ".1", "1..2"}) {
      assertThat(callMe(key.plaintextKey(), bad)).isEqualTo(HttpStatus.OK);
      var now = stored(key.id());
      assertThat(now.value1()).as("헤더 %s", bad).isEqualTo("0.1.49");
      assertThat(now.value2()).isEqualTo(before.value2());
    }
  }

  @Test
  void humanRequest_isNotRecorded() throws Exception {
    AgentApiKeyIssueResponse key = issueKey();
    // 사람(관리자) 인증 요청에 헤더가 실려도 AI 키 행에는 아무것도 남지 않는다 — 기록은 AI 키 인증에서만 한다.
    TenantContext.set(1L);
    mvc.perform(get("/api/v1/users/me").with(authentication(admin())).header(HEADER, "0.1.49"))
        .andExpect(status().isOk());
    assertThat(stored(key.id()).value1()).isNull();
  }

  @Test
  void adminList_andDetail_carryReportedAndLatestVersion() throws Exception {
    AgentApiKeyIssueResponse key = issueKey();
    callMe(key.plaintextKey(), "0.1.49");

    TenantContext.set(1L);
    mvc.perform(get("/api/v1/admin/agents/" + agentId).with(authentication(admin())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.runMode").value("EXTERNAL"))
        .andExpect(jsonPath("$.pluginVersion").value("0.1.49"))
        .andExpect(jsonPath("$.pluginVersionAt").isNotEmpty())
        .andExpect(jsonPath("$.latestPluginVersion").value("0.1.53"));

    TenantContext.set(1L);
    mvc.perform(get("/api/v1/admin/agents").with(authentication(admin())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id == " + agentId + ")].pluginVersion").value("0.1.49"))
        .andExpect(jsonPath("$[?(@.id == " + agentId + ")].latestPluginVersion").value("0.1.53"));
  }

  @Test
  void severalKeys_reportTheMostRecentlyUsedKeysVersion() throws Exception {
    AgentApiKeyIssueResponse oldPc = issueKey();
    AgentApiKeyIssueResponse newPc = issueKey();
    callMe(newPc.plaintextKey(), "0.1.53");
    // 옛 버전 컴퓨터가 더 나중에 접속했다 — 지금 돌고 있는 쪽이라 그 버전을 보인다.
    callMe(oldPc.plaintextKey(), "0.1.49");

    TenantContext.set(1L);
    mvc.perform(get("/api/v1/admin/agents/" + agentId).with(authentication(admin())))
        .andExpect(jsonPath("$.pluginVersion").value("0.1.49"));

    callMe(newPc.plaintextKey(), null);
    TenantContext.set(1L);
    mvc.perform(get("/api/v1/admin/agents/" + agentId).with(authentication(admin())))
        .andExpect(jsonPath("$.pluginVersion").value("0.1.53"));
  }

  @Test
  void neverReported_hasNoVersion_butCarriesLatest() throws Exception {
    issueKey();
    TenantContext.set(1L);
    mvc.perform(get("/api/v1/admin/agents/" + agentId).with(authentication(admin())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.pluginVersion").value(org.hamcrest.Matchers.nullValue()))
        .andExpect(jsonPath("$.pluginVersionAt").value(org.hamcrest.Matchers.nullValue()))
        .andExpect(jsonPath("$.latestPluginVersion").value("0.1.53"));
  }
}
