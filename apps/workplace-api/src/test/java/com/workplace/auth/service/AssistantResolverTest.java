package com.workplace.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.exception.HomeAssistantNotConfiguredException;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class AssistantResolverTest extends IntegrationTestBase {

  @Autowired AssistantResolver resolver;
  @Autowired WorkspaceAssistantRepository workspaceRepo;
  @Autowired PersonalAssistantRepository personalRepo;
  @Autowired AssistantConfigRepository configRepo;
  @Autowired AiAgentCredentialService credentialService;
  @Autowired DSLContext dsl;

  @Test
  void 둘다_미설정이면_예외() {
    long human = TestFixtures.createHuman(dsl);
    assertThatThrownBy(() -> resolver.resolve(human))
        .isInstanceOf(HomeAssistantNotConfiguredException.class);
  }

  @Test
  void 공용만_있으면_공용_그리고_디폴트_튜닝() {
    long human = TestFixtures.createHuman(dsl);
    long agent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    workspaceRepo.upsert(agent, human);

    AssistantSpec spec = resolver.resolve(human);
    assertThat(spec.agentUserId()).isEqualTo(agent);
    assertThat(spec.model()).isEqualTo(AssistantDefaults.MODEL);
    assertThat(spec.thinkingDepth()).isEqualTo(AssistantDefaults.THINKING_DEPTH);
    assertThat(spec.maxTurns()).isEqualTo(AssistantDefaults.MAX_TURNS);
    assertThat(spec.timeoutMs()).isEqualTo(AssistantDefaults.TIMEOUT_MS);
  }

  @Test
  void 개인이_있으면_공용보다_우선_그리고_config_override() {
    long human = TestFixtures.createHuman(dsl);
    long workspaceAgent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    workspaceRepo.upsert(workspaceAgent, human);

    long personalAgent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    personalRepo.setAgentId(human, personalAgent);
    configRepo.upsert(personalAgent, "claude-opus-4-8", "DEEP", null, null);

    AssistantSpec spec = resolver.resolve(human);
    assertThat(spec.agentUserId()).isEqualTo(personalAgent);
    assertThat(spec.model()).isEqualTo("claude-opus-4-8");
    assertThat(spec.thinkingDepth()).isEqualTo("DEEP");
    assertThat(spec.maxTurns()).isEqualTo(AssistantDefaults.MAX_TURNS); // null override → default
  }

  @Test
  void 개인_지정됐지만_토큰없으면_공용으로_폴백() {
    long human = TestFixtures.createHuman(dsl);
    long workspaceAgent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    workspaceRepo.upsert(workspaceAgent, human);

    long personalAgentNoToken = TestFixtures.createAgentNoToken(dsl);
    personalRepo.setAgentId(human, personalAgentNoToken);

    AssistantSpec spec = resolver.resolve(human);
    assertThat(spec.agentUserId()).isEqualTo(workspaceAgent);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // resolveOrEmpty / resolveWorkspaceOrEmpty — Optional 변형 (이슈 요약 경로용)
  // ──────────────────────────────────────────────────────────────────────────

  @Test
  void resolveOrEmpty_개인비서_토큰있음_present() {
    long human = TestFixtures.createHuman(dsl);
    long agent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    personalRepo.setAgentId(human, agent);

    var result = resolver.resolveOrEmpty(human);

    assertThat(result).isPresent();
    assertThat(result.get().agentUserId()).isEqualTo(agent);
  }

  @Test
  void resolveOrEmpty_토큰없는_후보만_있으면_empty() {
    long human = TestFixtures.createHuman(dsl);
    long agentNoToken = TestFixtures.createAgentNoToken(dsl);
    // 개인 비서만 지정(토큰 없음), 공용 비서 미설정 → 둘 다 pickWithActiveToken 통과 불가
    personalRepo.setAgentId(human, agentNoToken);

    var result = resolver.resolveOrEmpty(human);

    assertThat(result).isEmpty();
  }

  @Test
  void resolveWorkspaceOrEmpty_공용비서_토큰있음_present() {
    long admin = TestFixtures.createHuman(dsl);
    long agent = TestFixtures.createAgentWithToken(dsl, credentialService, admin);
    workspaceRepo.upsert(agent, admin);

    var result = resolver.resolveWorkspaceOrEmpty();

    assertThat(result).isPresent();
    assertThat(result.get().agentUserId()).isEqualTo(agent);
  }

  @Test
  void resolveWorkspaceOrEmpty_공용비서_미설정이면_empty() {
    // 공용 비서 행을 등록하지 않음 → empty
    var result = resolver.resolveWorkspaceOrEmpty();

    assertThat(result).isEmpty();
  }
}
