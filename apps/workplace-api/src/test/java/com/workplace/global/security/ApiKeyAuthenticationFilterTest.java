package com.workplace.global.security;

import static com.workplace.jooq.Tables.AGENT_API_KEY;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.dto.AgentApiKeyIssueResponse;
import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.UserKind;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

/**
 * Phase 5a — ApiKeyAuthenticationFilter 통합 테스트. RANDOM_PORT 환경에서 실제 HTTP 호출로 필터 동작/SecurityContext
 * 세팅/last_used_at 갱신을 검증한다. 실제 HTTP 요청은 별도 트랜잭션 — @Transactional 사용 시 시드가 보이지 않으므로 수동 cleanup 한다.
 */
class ApiKeyAuthenticationFilterTest extends IntegrationTestBase {

  @Autowired private AgentApiKeyService keyService;
  @Autowired private DSLContext dsl;
  @Autowired private AgentApiKeyRepository agentApiKeyRepository;
  @LocalServerPort private int port;

  private final RestTemplate rest = new RestTemplateBuilder().build();

  private Long adminId;
  private Long agentId;

  @BeforeEach
  void seed() {
    long n = System.nanoTime();
    adminId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "admin-akt-" + n)
            .set(USER.PASSWORD, "x")
            .set(USER.NAME, "Admin")
            .set(USER.EMAIL, "admin-akt-" + n + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    agentId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "agent-akt-" + n)
            .setNull(USER.PASSWORD)
            .set(USER.NAME, "Agent")
            .set(USER.EMAIL, "agent-akt-" + n + "@example.com")
            .set(USER.KIND, UserKind.AGENT)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    // WP-703: 키 발급·회수는 대상 AI 가 지금 워크스페이스 구성원일 때만 된다 — 실제 AI 처럼 tenant#1 멤버로 두고 그 컨텍스트에서 부른다.
    withMembership(agentId);
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    // audit_log 가 user 를 참조하므로 먼저 정리, 이후 user 삭제 (agent_api_key 는 CASCADE)
    // 키 발급 감사 로그가 tenant#1 로 남으므로 그 테넌트 GUC 안에서 지운다(#512 — 밖에서 지우면 RLS 에 가려 남는다).
    cleanupInTenant(
        1L,
        () -> {
          if (agentId != null) {
            dsl.deleteFrom(com.workplace.jooq.Tables.AUDIT_LOG)
                .where(com.workplace.jooq.Tables.AUDIT_LOG.USER_ID.in(agentId, adminId))
                .execute();
            dsl.deleteFrom(USER).where(USER.ID.eq(agentId)).execute();
          }
          if (adminId != null) dsl.deleteFrom(USER).where(USER.ID.eq(adminId)).execute();
        });
  }

  private ResponseEntity<String> callMe(String authValue) {
    HttpHeaders headers = new HttpHeaders();
    if (authValue != null) headers.set("Authorization", authValue);
    try {
      return rest.exchange(
          "http://localhost:" + port + "/api/v1/users/me",
          HttpMethod.GET,
          new HttpEntity<>(headers),
          String.class);
    } catch (org.springframework.web.client.HttpStatusCodeException e) {
      return ResponseEntity.status(e.getStatusCode()).body(e.getResponseBodyAsString());
    }
  }

  @Test
  void valid_ak_authenticates_as_agent_user() {
    AgentApiKeyIssueResponse res =
        keyService.issue(adminId, agentId, new IssueAgentKeyRequest("test"));
    ResponseEntity<String> me = callMe("Bearer " + res.plaintextKey());
    assertThat(me.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(me.getBody()).contains("\"kind\":\"AGENT\"");
  }

  @Test
  void unknown_ak_does_not_authenticate() {
    ResponseEntity<String> me = callMe("Bearer ak_neverexists000000000000");
    assertThat(me.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void revoked_ak_does_not_authenticate() {
    AgentApiKeyIssueResponse res =
        keyService.issue(adminId, agentId, new IssueAgentKeyRequest(null));
    keyService.revoke(adminId, agentId, res.id());
    ResponseEntity<String> me = callMe("Bearer " + res.plaintextKey());
    assertThat(me.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void no_authorization_header_remains_unauthorized() {
    ResponseEntity<String> me = callMe(null);
    assertThat(me.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void jwt_bearer_is_passed_through_to_jwt_filter() {
    // ak_ 가 아닌 임의 토큰 — ApiKeyFilter 는 건드리지 않고 JWT 필터가 무효 처리 → 401
    ResponseEntity<String> me = callMe("Bearer not-a-valid-jwt");
    assertThat(me.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
  }

  @Test
  void last_used_at_updated_after_successful_call() {
    AgentApiKeyIssueResponse res =
        keyService.issue(adminId, agentId, new IssueAgentKeyRequest(null));
    callMe("Bearer " + res.plaintextKey());
    var lastUsed =
        dsl.select(AGENT_API_KEY.LAST_USED_AT)
            .from(AGENT_API_KEY)
            .where(AGENT_API_KEY.ID.eq(res.id()))
            .fetchOne(AGENT_API_KEY.LAST_USED_AT);
    assertThat(lastUsed).isNotNull();
  }

  // WP-1153: 발급을 막기 전에 개인 비서에게 나간 키도 인증하지 않는다 — 그 키로 주인의 개인 작업을 읽을 수 있었다.
  @Test
  void personal_assistant_ak_does_not_authenticate() {
    long n = System.nanoTime();
    Long assistantId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, AgentUsernames.personalAssistantOf(n))
            .setNull(USER.PASSWORD)
            .set(USER.NAME, "개인 비서")
            .set(USER.KIND, UserKind.AGENT)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    try {
      withMembership(assistantId);
      String plaintext = "ak_legacyPersonalAssistant" + n;
      agentApiKeyRepository.insert(
          assistantId,
          plaintext.substring(0, 12),
          CapabilityTokens.sha256Hex(plaintext),
          "legacy",
          adminId);
      ResponseEntity<String> me = callMe("Bearer " + plaintext);
      assertThat(me.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    } finally {
      cleanupInTenant(1L, () -> dsl.deleteFrom(USER).where(USER.ID.eq(assistantId)).execute());
    }
  }
}
