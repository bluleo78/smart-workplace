package com.workplace.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.UpdateAssistantSettingsRequest;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.AssistantLimitWaitRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 공용 비서 admin 서비스 통합 테스트. @Transactional 로 workspace_assistant upsert 가 롤백된다. */
@Transactional
class WorkspaceAssistantServiceTest extends IntegrationTestBase {

  @Autowired WorkspaceAssistantService service;
  @Autowired AiAgentCredentialService credentialService;
  @Autowired AiAgentCredentialRepository credentialRepo;
  @Autowired AssistantLimitWaitRepository waitRepo;
  @Autowired AssistantResolver resolver;
  @Autowired DSLContext dsl;

  @Test
  void HUMAN_을_공용비서로_지정하면_거부() {
    long admin = TestFixtures.createHuman(dsl);
    long human = withMembership(TestFixtures.createHuman(dsl));
    assertThatThrownBy(() -> service.setAgent(admin, human))
        .isInstanceOf(com.workplace.auth.exception.KeyTargetMustBeAgentException.class);
  }

  @Test
  void AGENT_지정후_조회_그리고_설정변경() {
    long admin = TestFixtures.createHuman(dsl);
    long agent = withMembership(TestFixtures.createAgentNoToken(dsl));
    service.setAgent(admin, agent);

    var res = service.get();
    assertThat(res.agentUserId()).isEqualTo(agent);
    assertThat(res.hasActiveToken()).isFalse(); // 토큰 없음 경고용

    service.updateSettings(admin, settings("claude-opus-4-8", "MAX"));
    assertThat(service.get().model()).isEqualTo("claude-opus-4-8");
  }

  /** 자격 있는 AGENT 를 공용 비서로 지정하고 활성 자격 id 를 돌려준다. */
  private long assignWithCredential(long admin) {
    long agent = withMembership(TestFixtures.createAgentNoToken(dsl));
    long credId = credentialRepo.insert(agent, "anthropic", "iv:ct", "t", admin);
    service.setAgent(admin, agent);
    return credId;
  }

  @Test
  void 대기중이면_limitWaitUntil_을_돌려준다() {
    long admin = TestFixtures.createHuman(dsl);
    long credId = assignWithCredential(admin);
    Instant until = Instant.now().plus(2, ChronoUnit.HOURS).truncatedTo(ChronoUnit.MILLIS);
    waitRepo.upsert(credId, service.get().agentUserId(), until, null);

    assertThat(service.get().limitWaitUntil()).isEqualTo(until);
  }

  @Test
  void 대기가_없으면_limitWaitUntil_은_null() {
    long admin = TestFixtures.createHuman(dsl);
    assignWithCredential(admin);

    assertThat(service.get().limitWaitUntil()).isNull();
  }

  @Test
  void 모델을_바꾸면_대기가_풀린다() {
    long admin = TestFixtures.createHuman(dsl);
    long credId = assignWithCredential(admin);
    waitRepo.upsert(
        credId, service.get().agentUserId(), Instant.now().plus(2, ChronoUnit.HOURS), null);
    assertThat(resolver.resolveWorkspaceOrEmpty()).isEmpty();

    service.updateSettings(admin, settings("claude-opus-4-8", "MAX"));

    assertThat(service.get().limitWaitUntil()).isNull();
    assertThat(resolver.resolveWorkspaceOrEmpty()).isPresent();
  }

  @Test
  void 모델이_같으면_대기는_그대로() {
    long admin = TestFixtures.createHuman(dsl);
    long credId = assignWithCredential(admin);
    service.updateSettings(admin, settings("claude-opus-4-8", "MAX"));
    waitRepo.upsert(
        credId, service.get().agentUserId(), Instant.now().plus(2, ChronoUnit.HOURS), null);

    service.updateSettings(admin, settings("claude-opus-4-8", "HIGH"));

    assertThat(service.get().limitWaitUntil()).isNotNull();
  }

  /** 컨트롤러와 같은 부분 갱신 요청 — 모델·생각 깊이 두 키를 보낸 것과 같다. */
  private static UpdateAssistantSettingsRequest settings(String model, String thinkingDepth) {
    var req = new UpdateAssistantSettingsRequest();
    req.setModel(model);
    req.setThinkingDepth(thinkingDepth);
    return req;
  }
}
