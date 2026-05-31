package com.workplace.auth.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class PersonalAssistantServiceTest extends IntegrationTestBase {

  @Autowired PersonalAssistantService service;
  @Autowired PersonalAssistantRepository personalRepo;
  @Autowired AiAgentCredentialRepository credentialRepo;
  @Autowired DSLContext dsl;

  private static final String TOKEN = "sk-ant-oat-" + "x".repeat(40);

  @Test
  void 최초_토큰등록시_개인AGENT_자동생성_그리고_상태조회() {
    long human = TestFixtures.createHuman(dsl);
    service.registerToken(human, TOKEN, "내 토큰");

    Long agentId = personalRepo.findAgentId(human).orElseThrow();
    assertThat(credentialRepo.findActive(agentId)).isPresent();

    var status = service.getStatus(human);
    assertThat(status.configured()).isTrue();
    assertThat(status.model()).isEqualTo(AssistantDefaults.MODEL); // config 없음 → 디폴트 표시
  }

  @Test
  void 설정변경_후_상태에_반영() {
    long human = TestFixtures.createHuman(dsl);
    service.registerToken(human, TOKEN, "t");
    service.updateSettings(human, "claude-opus-4-8", "DEEP");

    var status = service.getStatus(human);
    assertThat(status.model()).isEqualTo("claude-opus-4-8");
    assertThat(status.thinkingDepth()).isEqualTo("DEEP");
  }

  @Test
  void 해제하면_토큰revoke_그리고_FK_null() {
    long human = TestFixtures.createHuman(dsl);
    service.registerToken(human, TOKEN, "t");
    Long agentId = personalRepo.findAgentId(human).orElseThrow();

    service.disable(human);

    assertThat(personalRepo.findAgentId(human)).isEmpty();
    assertThat(credentialRepo.findActive(agentId)).isEmpty();
  }

  @Test
  void 미설정이면_configured_false() {
    long human = TestFixtures.createHuman(dsl);
    assertThat(service.getStatus(human).configured()).isFalse();
  }
}
