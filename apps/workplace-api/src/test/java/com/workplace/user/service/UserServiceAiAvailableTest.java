package com.workplace.user.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * /users/me 의 aiAvailable 신호 검증 — 개인·공통 비서 가용 여부에 따라 true/false 가 올바르게 반환되는지 확인한다.
 *
 * <p>픽스처는 AssistantResolverTest 와 동일 패턴(TestFixtures.createAgentWithToken, personalRepo,
 * workspaceRepo)을 재사용한다.
 */
@Transactional
class UserServiceAiAvailableTest extends IntegrationTestBase {

  @Autowired private UserService userService;
  @Autowired private PersonalAssistantRepository personalRepo;
  @Autowired private WorkspaceAssistantRepository workspaceRepo;
  @Autowired private AiAgentCredentialService credentialService;
  @Autowired private DSLContext dsl;

  @Test
  void getUserById_aiAvailableTrue_whenPersonalAssistantWithToken() {
    // 개인 비서(active token)가 있을 때 → true
    long human = TestFixtures.createHuman(dsl);
    long agent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    personalRepo.setAgentId(human, agent);

    assertThat(userService.getUserById(human).aiAvailable()).isTrue();
  }

  @Test
  void getUserById_aiAvailableTrue_whenWorkspaceAssistantWithToken() {
    // 공통 비서(active token)가 있을 때 → true
    long human = TestFixtures.createHuman(dsl);
    long agent = TestFixtures.createAgentWithToken(dsl, credentialService, human);
    workspaceRepo.upsert(agent, human);

    assertThat(userService.getUserById(human).aiAvailable()).isTrue();
  }

  @Test
  void getUserById_aiAvailableFalse_whenNoAssistant() {
    // 비서가 없는 사용자 → false
    long human = TestFixtures.createHuman(dsl);

    assertThat(userService.getUserById(human).aiAvailable()).isFalse();
  }
}
