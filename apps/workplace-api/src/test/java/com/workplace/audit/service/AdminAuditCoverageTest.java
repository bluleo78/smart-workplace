package com.workplace.audit.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.dto.UpdateAssistantSettingsRequest;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.auth.service.WorkspaceAssistantService;
import com.workplace.jooq.tables.records.AuditLogRecord;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/** 관리자의 AI 관련 작업 감사 기록 빈틈(WP-706) — 공용 비서 지정·설정·해제 기록, 키·AI 연결 기록의 대상 AI 아이디, 관리 작업의 요청 IP. */
@Transactional
class AdminAuditCoverageTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired WorkspaceAssistantService assistantService;
  @Autowired AgentApiKeyService agentApiKeyService;
  @Autowired AiAgentCredentialService credentialService;
  @Autowired AuditLogService auditLogService;
  @Autowired ObjectMapper objectMapper;

  @AfterEach
  void clearRequest() {
    RequestContextHolder.resetRequestAttributes();
  }

  private AuditLogRecord latest(String actionType) {
    return dsl.selectFrom(AUDIT_LOG)
        .where(AUDIT_LOG.ACTION_TYPE.eq(actionType))
        .orderBy(AUDIT_LOG.ID.desc())
        .limit(1)
        .fetchOne();
  }

  private String usernameOf(long id) {
    return dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(id)).fetchOne(USER.USERNAME);
  }

  /** 공용 비서 지정·설정 변경·해제가 각각 대상 AI 아이디와 함께 남는다. */
  @Test
  void workspaceAssistant_setSettingsClear_areAudited() throws Exception {
    long admin = withMembership(TestFixtures.createHuman(dsl));
    long agent = withMembership(TestFixtures.createAgentNoToken(dsl));
    String agentName = usernameOf(agent);

    assistantService.setAgent(admin, agent);
    var set = latest("WORKSPACE_ASSISTANT_SET");
    assertThat(set).isNotNull();
    assertThat(set.getUserId()).isEqualTo(admin);
    assertThat(set.getResource()).isEqualTo("workspace_assistant");
    assertThat(set.getResourceId()).isEqualTo(String.valueOf(agent));
    assertThat(set.getDescription()).isEqualTo("공용 비서 지정: " + agentName);

    var req =
        objectMapper.readValue(
            "{\"thinkingDepth\":\"DEEP\"}", UpdateAssistantSettingsRequest.class);
    assistantService.updateSettings(admin, req);
    var settings = latest("WORKSPACE_ASSISTANT_SETTINGS_CHANGED");
    assertThat(settings).isNotNull();
    assertThat(settings.getDescription()).isEqualTo("공용 비서 설정 변경: " + agentName);
    assertThat(settings.getMetadata().data()).contains("\"thinkingDepth\": \"DEEP\"");
    assertThat(settings.getMetadata().data()).doesNotContain("model");

    assistantService.clear(admin);
    var cleared = latest("WORKSPACE_ASSISTANT_CLEARED");
    assertThat(cleared).isNotNull();
    assertThat(cleared.getDescription()).isEqualTo("공용 비서 해제: " + agentName);
  }

  /** 지정된 공용 비서가 없을 때의 해제는 아무 기록도 남기지 않는다. */
  @Test
  void workspaceAssistant_clearWhenUnset_notAudited() {
    long admin = withMembership(TestFixtures.createHuman(dsl));
    assistantService.clear(admin);
    assertThat(latest("WORKSPACE_ASSISTANT_CLEARED")).isNull();
  }

  /** 키 발급·회수 기록 설명에 대상 AI 아이디가 들어간다. */
  @Test
  void agentKey_issueRevoke_nameTargetAgent() {
    long admin = withMembership(TestFixtures.createHuman(dsl));
    long agent = withMembership(TestFixtures.createAgentNoToken(dsl));
    String agentName = usernameOf(agent);

    var issued = agentApiKeyService.issue(admin, agent, new IssueAgentKeyRequest("감사용"));
    assertThat(latest("AGENT_KEY_ISSUED").getDescription()).isEqualTo("AGENT 키 발급: " + agentName);

    agentApiKeyService.revoke(admin, agent, issued.id());
    assertThat(latest("AGENT_KEY_REVOKED").getDescription()).isEqualTo("AGENT 키 회수: " + agentName);
  }

  /** AI 연결(프로바이더 자격증명) 등록·회수 기록 설명에 대상 AI 아이디가 들어간다. */
  @Test
  void providerCredential_registerRevoke_nameTargetAgent() {
    long admin = withMembership(TestFixtures.createHuman(dsl));
    long agent = withMembership(TestFixtures.createAgentNoToken(dsl));
    String agentName = usernameOf(agent);

    credentialService.register(admin, agent, "anthropic", "X".repeat(64), "main", null);
    assertThat(latest("AGENT_OAUTH_TOKEN_REGISTERED").getDescription())
        .isEqualTo("AGENT 프로바이더 자격증명 등록: " + agentName);

    credentialService.revoke(admin, agent);
    assertThat(latest("AGENT_OAUTH_TOKEN_REVOKED").getDescription())
        .isEqualTo("AGENT 프로바이더 자격증명 회수: " + agentName);
  }

  /** IP 를 넘기지 않은 기록은 처리 중인 요청의 클라이언트 IP(X-Forwarded-For 첫 값)를 쓴다. */
  @Test
  void log_withoutIp_usesCurrentRequestIp() {
    var request = new MockHttpServletRequest();
    request.setRemoteAddr("10.0.0.1");
    request.addHeader("X-Forwarded-For", "203.0.113.7, 10.0.0.1");
    RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

    Long id =
        auditLogService.log(
            null,
            "system",
            "ROLE_UPDATED",
            "role",
            "1",
            "역할 수정",
            null,
            null,
            "SUCCESS",
            null,
            null);
    assertThat(
            dsl.select(AUDIT_LOG.IP_ADDRESS)
                .from(AUDIT_LOG)
                .where(AUDIT_LOG.ID.eq(id))
                .fetchOne(AUDIT_LOG.IP_ADDRESS))
        .isEqualTo("203.0.113.7");
  }

  /** 넘긴 IP 는 그대로, 요청 밖(스케줄러 등)에서는 비어 있다. */
  @Test
  void log_explicitIpKept_andNoRequestStaysNull() {
    var request = new MockHttpServletRequest();
    request.setRemoteAddr("10.0.0.1");
    RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    Long explicit =
        auditLogService.log(
            null,
            "system",
            "LOGIN",
            "auth",
            "1",
            "로그인",
            "198.51.100.2",
            null,
            "SUCCESS",
            null,
            null);
    RequestContextHolder.resetRequestAttributes();
    Long noRequest =
        auditLogService.log(
            null, "system", "LOGIN", "auth", "1", "로그인", null, null, "SUCCESS", null, null);

    assertThat(
            dsl.select(AUDIT_LOG.IP_ADDRESS)
                .from(AUDIT_LOG)
                .where(AUDIT_LOG.ID.eq(explicit))
                .fetchOne(AUDIT_LOG.IP_ADDRESS))
        .isEqualTo("198.51.100.2");
    assertThat(
            dsl.select(AUDIT_LOG.IP_ADDRESS)
                .from(AUDIT_LOG)
                .where(AUDIT_LOG.ID.eq(noRequest))
                .fetchOne(AUDIT_LOG.IP_ADDRESS))
        .isNull();
  }
}
