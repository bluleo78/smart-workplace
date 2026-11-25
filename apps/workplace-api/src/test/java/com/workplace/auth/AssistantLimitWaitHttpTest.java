package com.workplace.auth;

import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;
import static com.workplace.jooq.Tables.ASSISTANT_LIMIT_WAIT;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKSPACE_ASSISTANT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.dto.IssueUserTokenRequest;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.auth.service.AssistantLimitWaitService;
import com.workplace.auth.service.UserApiTokenService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.restclient.RestTemplateBuilder;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

/**
 * WP-2108: 공통 비서가 사용 한도 대기 중일 때 직접 요청(채팅)은 503 즉답이고 세션을 남기지 않으며, 「AI 가능」 표시(/users/me)는 그대로 켜져
 * 있다(대기는 설정이 아니라 일시 상태). 실제 HTTP 호출이라 별도 트랜잭션 — 시드는 커밋하고 직접 정리한다.
 */
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class AssistantLimitWaitHttpTest extends IntegrationTestBase {

  @Autowired UserApiTokenService tokenService;
  @Autowired AiAgentCredentialRepository credentialRepo;
  @Autowired WorkspaceAssistantRepository workspaceRepo;
  @Autowired AssistantLimitWaitService waitService;
  @LocalServerPort int port;

  private final RestTemplate rest = new RestTemplateBuilder().build();

  private long human;
  private long agent;
  private long credential;
  private String bearer;

  @BeforeEach
  void seed() {
    human = createHumanWithRole();
    agent = TestFixtures.createAgentNoToken(baseDsl);
    credential = credentialRepo.insert(agent, "anthropic", "iv:ct", "t", human);
    callInTenant(
        1L,
        () -> {
          workspaceRepo.upsert(agent, human);
          return null;
        });
    TenantContext.set(1L);
    try {
      bearer =
          "Bearer "
              + tokenService.issue(human, new IssueUserTokenRequest("t", null)).plaintextToken();
      waitService.mark(credential, agent, Instant.now().plus(Duration.ofHours(2)));
    } finally {
      TenantContext.clear();
    }
  }

  private long createHumanWithRole() {
    long id = TestFixtures.createHuman(baseDsl);
    grantUserRole(id);
    baseDsl
        .insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          baseDsl
              .deleteFrom(ASSISTANT_LIMIT_WAIT)
              .where(ASSISTANT_LIMIT_WAIT.CREDENTIAL_ID.eq(credential))
              .execute();
          baseDsl
              .deleteFrom(WORKSPACE_ASSISTANT)
              .where(WORKSPACE_ASSISTANT.AGENT_USER_ID.eq(agent))
              .execute();
          baseDsl.deleteFrom(HOME_SESSION).where(HOME_SESSION.USER_ID.eq(human)).execute();
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.eq(human)).execute();
          baseDsl.deleteFrom(PROJECT).where(PROJECT.OWNER_ID.eq(human)).execute();
          baseDsl
              .deleteFrom(AI_AGENT_CREDENTIAL)
              .where(AI_AGENT_CREDENTIAL.ID.eq(credential))
              .execute();
          baseDsl.deleteFrom(USER).where(USER.ID.in(human, agent)).execute();
        });
  }

  private ResponseEntity<String> exchange(HttpMethod method, String path, String json) {
    HttpHeaders headers = new HttpHeaders();
    headers.set("Authorization", bearer);
    headers.setContentType(MediaType.APPLICATION_JSON);
    try {
      return rest.exchange(
          "http://localhost:" + port + path, method, new HttpEntity<>(json, headers), String.class);
    } catch (HttpStatusCodeException e) {
      return ResponseEntity.status(e.getStatusCode()).body(e.getResponseBodyAsString());
    }
  }

  @Test
  void 공용비서_대기중이면_채팅은_503_즉답_세션없음_그리고_aiAvailable_true() {
    ResponseEntity<String> chat =
        exchange(HttpMethod.POST, "/api/v1/ai/chat", "{\"query\":\"안녕\"}");

    assertThat(chat.getStatusCode().value()).isEqualTo(503);
    assertThat(chat.getBody()).contains("\"message\":\"사용 한도에 걸렸어요(");
    assertThat(
            callInTenant(
                1L,
                () ->
                    baseDsl.fetchCount(
                        baseDsl.selectFrom(HOME_SESSION).where(HOME_SESSION.USER_ID.eq(human)))))
        .isZero();

    ResponseEntity<String> me = exchange(HttpMethod.GET, "/api/v1/users/me", null);
    assertThat(me.getStatusCode().value()).isEqualTo(200);
    assertThat(me.getBody()).contains("\"aiAvailable\":true");
  }
}
