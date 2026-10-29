package com.workplace.auth.controller;

import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.WORKSPACE_ASSISTANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.outbound.PersonalAssistantCredentialRevokedEvent;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.global.tenant.TenantContext;
import com.workplace.notify.service.NotificationService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1163 — 개인 비서는 주인의 자격증명으로 주인만을 위해 움직인다. 관리자가 공통 비서로 지정하거나 AI 연결을 등록·재발급하면 주인 모르게 그 토큰으로 모두의 대화가
 * 돌거나 주인의 대화가 관리자 연결로 나갔다 — 둘 다 403 이고, 막기 전에 들어간 공통 비서 지정은 V235 가 지운다. 회수는 정리 수단으로 남는다.
 */
@Transactional
@RecordApplicationEvents
class PersonalAssistantAdminChangeTest extends IntegrationTestBase {

  private static final String TOKEN = "sk-ant-oat-" + "x".repeat(40);
  private static final String MIGRATION =
      "db/migration/V235__clear_personal_workspace_assistant.sql";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired AiAgentCredentialService credentialService;
  @Autowired AiAgentCredentialRepository credentialRepo;
  @Autowired WorkspaceAssistantRepository workspaceRepo;
  @Autowired AssistantResolver resolver;
  @Autowired NotificationService notificationService;
  @Autowired ApplicationEvents events;

  private long admin;
  private long owner;
  private long assistant;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.createHuman(dsl);
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    TestFixtures.addMember(dsl, admin, 1L);
    owner = TestFixtures.createHuman(dsl);
    TestFixtures.addMember(dsl, owner, 1L);
    // 주인(owner)의 개인 비서 — 결정적 username 이 곧 개인 비서 표시다.
    assistant = TestFixtures.createPersonalAssistant(dsl, owner);
    TestFixtures.addMember(dsl, assistant, 1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private ResultActions asAdmin(MockHttpServletRequestBuilder req) throws Exception {
    // 요청 필터 체인이 끝나면 TenantContext 가 비워지므로 호출마다 tenant#1 로 다시 맞춘다.
    TenantContext.set(1L);
    return mvc.perform(
        req.with(
                authentication(
                    WebSessionAuth.of(admin, List.of(new SimpleGrantedAuthority("user:write")))))
            .contentType(MediaType.APPLICATION_JSON));
  }

  @Test
  void 관리자는_개인_비서를_공통_비서로_지정하지_못한다() throws Exception {
    credentialService.register(owner, assistant, "anthropic", TOKEN, "주인 토큰", null);

    asAdmin(put("/api/v1/admin/workspace-assistant").content("{\"agentUserId\":" + assistant + "}"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value("개인 비서는 공통 비서로 지정할 수 없습니다"));

    assertThat(dsl.fetchCount(WORKSPACE_ASSISTANT)).isZero();
  }

  @Test
  void 관리자는_개인_비서의_AI_연결을_등록하거나_바꾸지_못한다() throws Exception {
    credentialService.register(owner, assistant, "anthropic", TOKEN, "주인 토큰", null);
    String cred = "/api/v1/admin/agents/" + assistant + "/provider-credential";

    asAdmin(
            post(cred)
                .content(
                    "{\"provider\":\"anthropic\",\"token\":\""
                        + TOKEN
                        + "\",\"label\":\"관리자가 바꿈\"}"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value("개인 비서의 AI 연결은 주인만 등록할 수 있습니다"));

    // 주인의 연결이 그대로 살아 있다.
    assertThat(credentialRepo.findActive(assistant))
        .get()
        .extracting(r -> r.label())
        .isEqualTo("주인 토큰");
  }

  @Test
  void 개인_비서의_AI_연결은_관리자가_회수할_수_있다() throws Exception {
    credentialService.register(owner, assistant, "anthropic", TOKEN, "주인 토큰", null);
    String cred = "/api/v1/admin/agents/" + assistant + "/provider-credential";

    asAdmin(get(cred)).andExpect(status().isOk());
    asAdmin(delete(cred)).andExpect(status().isNoContent());

    assertThat(credentialRepo.findActive(assistant)).isEmpty();
    assertThat(
            dsl.fetchCount(
                AI_AGENT_CREDENTIAL,
                AI_AGENT_CREDENTIAL
                    .USER_ID
                    .eq(assistant)
                    .and(AI_AGENT_CREDENTIAL.REVOKED_AT.isNull())))
        .isZero();
  }

  /**
   * WP-1170 — 관리 경로는 관리자 자기 개인 비서도 등록·재발급하지 않는다(화면이 모든 개인 비서에서 버튼을 숨기는 규칙과 맞춘다). 주인은 내 설정 경로를 쓴다.
   */
  @Test
  void 관리_경로는_관리자_자기_개인_비서도_등록하지_못한다() throws Exception {
    long mine = TestFixtures.createPersonalAssistant(dsl, admin);
    TestFixtures.addMember(dsl, mine, 1L);

    asAdmin(
            post("/api/v1/admin/agents/" + mine + "/provider-credential")
                .content("{\"provider\":\"anthropic\",\"token\":\"" + TOKEN + "\"}"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value("개인 비서의 AI 연결은 주인만 등록할 수 있습니다"));

    assertThat(credentialRepo.findActive(mine)).isEmpty();
  }

  /** WP-1170 — 주인 확인 없이 부르면(callerId 없음) NPE 대신 막는다. */
  @Test
  void 호출자가_없으면_개인_비서_연결을_등록하지_못한다() {
    org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> credentialService.register(null, assistant, "anthropic", TOKEN, null, null))
        .isInstanceOf(
            com.workplace.auth.exception.PersonalAssistantAdminChangeForbiddenException.class);
  }

  /**
   * WP-1170 — 관리자가 개인 비서 연결을 회수하면 감사 로그에 「개인 비서 정리」 사유가 남고 주인에게 알릴 이벤트가 나간다. 주인이 스스로 회수(비서 해제)할 때는
   * 나가지 않는다.
   */
  @Test
  void 관리자가_개인_비서_연결을_회수하면_주인에게_알리고_사유를_남긴다() throws Exception {
    credentialService.register(owner, assistant, "anthropic", TOKEN, "주인 토큰", null);

    asAdmin(delete("/api/v1/admin/agents/" + assistant + "/provider-credential"))
        .andExpect(status().isNoContent());

    assertThat(events.stream(PersonalAssistantCredentialRevokedEvent.class))
        .containsExactly(new PersonalAssistantCredentialRevokedEvent(1L, owner, admin));
    var audit =
        dsl.selectFrom(AUDIT_LOG)
            .where(AUDIT_LOG.ACTION_TYPE.eq("AGENT_OAUTH_TOKEN_REVOKED"))
            .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(assistant)))
            .fetchOne();
    assertThat(audit).isNotNull();
    assertThat(audit.getMetadata().data()).contains("개인 비서 정리");
  }

  @Test
  void 주인이_스스로_회수하면_알리지_않는다() {
    credentialService.register(owner, assistant, "anthropic", TOKEN, "주인 토큰", null);

    credentialService.revoke(owner, assistant);

    assertThat(events.stream(PersonalAssistantCredentialRevokedEvent.class)).isEmpty();
  }

  /** WP-1170 — 회수 알림은 알림 설정과 무관하게 주인 인박스에 들어가고 목록에 보인다(가리킬 이슈·일정이 없어도). */
  @Test
  void 회수_알림은_주인_인박스에_들어간다() {
    notificationService.createPersonalAssistantRevokedAndFanOut(owner, admin);

    assertThat(notificationService.listRecent(owner, 10, 0))
        .anySatisfy(
            n -> {
              assertThat(n.type()).isEqualTo("PERSONAL_ASSISTANT_REVOKED");
              assertThat(n.actorId()).isEqualTo(admin);
            });
    // 스스로 한 회수(actor==owner)는 알림을 만들지 않는다.
    notificationService.createPersonalAssistantRevokedAndFanOut(owner, owner);
    assertThat(
            dsl.fetchCount(
                NOTIFICATION,
                NOTIFICATION
                    .RECIPIENT_ID
                    .eq(owner)
                    .and(NOTIFICATION.TYPE.eq("PERSONAL_ASSISTANT_REVOKED"))))
        .isEqualTo(1);
  }

  /**
   * WP-1170 V241 — 막기 전에 관리자가 바꿔 둔 개인 비서 연결(created_by ≠ 주인)은 회수하고, 둘이 함께 속한 워크스페이스에서 주인에게 알린다. 주인이
   * 등록한 연결과 일반 AI 의 연결은 그대로 둔다.
   */
  @Test
  void 관리자가_바꿔_둔_개인_비서_연결은_마이그레이션이_회수하고_주인에게_알린다() throws Exception {
    // 막기 전 상태를 그대로 재현한다 — 관리자 토큰으로 바뀐 주인의 비서 연결.
    credentialRepo.insert(assistant, "anthropic", "enc", "관리자가 바꿈", admin);
    long other = TestFixtures.createHuman(dsl);
    TestFixtures.addMember(dsl, other, 1L);
    long othersAssistant = TestFixtures.createPersonalAssistant(dsl, other);
    credentialRepo.insert(othersAssistant, "anthropic", "enc", "주인 토큰", other);
    long agent = TestFixtures.createAgentNoToken(dsl);
    credentialRepo.insert(agent, "anthropic", "enc", "관리자 등록", admin);

    dsl.execute(
        new ClassPathResource(
                "db/migration/V241__revoke_overwritten_personal_assistant_credentials.sql")
            .getContentAsString(StandardCharsets.UTF_8));

    assertThat(credentialRepo.findActive(assistant)).isEmpty();
    assertThat(credentialRepo.findActive(othersAssistant)).isPresent();
    assertThat(credentialRepo.findActive(agent)).isPresent();
    var notes =
        dsl.selectFrom(NOTIFICATION)
            .where(NOTIFICATION.TYPE.eq("PERSONAL_ASSISTANT_REVOKED"))
            .fetch();
    assertThat(notes).hasSize(1);
    assertThat(notes.get(0).getRecipientId()).isEqualTo(owner);
    assertThat(notes.get(0).getActorId()).isNull();
    assertThat(notes.get(0).getTenantId()).isEqualTo(1L);
  }

  @Test
  void 막기_전에_공통_비서로_지정된_개인_비서는_마이그레이션이_지운다() throws Exception {
    credentialService.register(owner, assistant, "anthropic", TOKEN, "주인 토큰", null);
    // 지정을 막기 전에 들어간 지정을 그대로 재현한다.
    workspaceRepo.upsert(assistant, admin);
    long other = TestFixtures.createHuman(dsl);
    TestFixtures.addMember(dsl, other, 1L);
    assertThat(resolver.resolveOrEmpty(other)).isPresent(); // 지우기 전: 남의 대화가 주인 토큰으로 돈다

    dsl.execute(new ClassPathResource(MIGRATION).getContentAsString(StandardCharsets.UTF_8));

    // 개인 비서가 없는 구성원의 대화가 주인의 토큰으로 돌지 않고, 관리 화면도 미지정이라 다른 AI 를 지정할 수 있다.
    assertThat(dsl.fetchCount(WORKSPACE_ASSISTANT)).isZero();
    assertThat(resolver.resolveOrEmpty(other)).isEmpty();
    asAdmin(get("/api/v1/admin/workspace-assistant"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.agentUserId").doesNotExist());
  }

  @Test
  void 마이그레이션은_일반_AI_공통_비서_지정을_건드리지_않는다() throws Exception {
    long agent = TestFixtures.createAgentNoToken(dsl);
    TestFixtures.addMember(dsl, agent, 1L);
    workspaceRepo.upsert(agent, admin);

    dsl.execute(new ClassPathResource(MIGRATION).getContentAsString(StandardCharsets.UTF_8));

    assertThat(workspaceRepo.findAgentId()).contains(agent);
  }
}
