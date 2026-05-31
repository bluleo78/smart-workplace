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

  @Test
  void 해제후_재등록하면_기존_개인AGENT_재사용_그리고_unique충돌_없음() {
    // disable 은 FK 를 NULL 로 비우되 개인 AGENT row(결정적 username)는 보존한다.
    // 재등록 시 그 row 를 재사용해야 username unique 충돌(500) 없이 동작한다.
    long human = TestFixtures.createHuman(dsl);
    service.registerToken(human, TOKEN, "t1");
    long first = personalRepo.findAgentId(human).orElseThrow();

    service.disable(human);
    assertThat(personalRepo.findAgentId(human)).isEmpty();

    service.registerToken(human, TOKEN, "t2"); // 여기서 새 AGENT 를 INSERT 하면 username 충돌
    long second = personalRepo.findAgentId(human).orElseThrow();

    assertThat(second).isEqualTo(first); // 동일 AGENT 재사용
    assertThat(credentialRepo.findActive(second)).isPresent();
  }
}
