package com.workplace.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.UpdateAssistantSettingsRequest;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 공용 비서 admin 서비스 통합 테스트. @Transactional 로 workspace_assistant upsert 가 롤백된다. */
@Transactional
class WorkspaceAssistantServiceTest extends IntegrationTestBase {

  @Autowired WorkspaceAssistantService service;
  @Autowired AiAgentCredentialService credentialService;
  @Autowired DSLContext dsl;

  @Test
  void HUMAN_을_공용비서로_지정하면_거부() {
    long admin = TestFixtures.createHuman(dsl);
    long human = TestFixtures.createHuman(dsl);
    assertThatThrownBy(() -> service.setAgent(admin, human))
        .isInstanceOf(com.workplace.auth.exception.KeyTargetMustBeAgentException.class);
  }

  @Test
  void AGENT_지정후_조회_그리고_설정변경() {
    long admin = TestFixtures.createHuman(dsl);
    long agent = TestFixtures.createAgentNoToken(dsl);
    service.setAgent(admin, agent);

    var res = service.get();
    assertThat(res.agentUserId()).isEqualTo(agent);
    assertThat(res.hasActiveToken()).isFalse(); // 토큰 없음 경고용

    service.updateSettings(admin, settings("claude-opus-4-8", "DEEP"));
    assertThat(service.get().model()).isEqualTo("claude-opus-4-8");
  }

  /** 컨트롤러와 같은 부분 갱신 요청 — 모델·생각 깊이 두 키를 보낸 것과 같다. */
  private static UpdateAssistantSettingsRequest settings(String model, String thinkingDepth) {
    var req = new UpdateAssistantSettingsRequest();
    req.setModel(model);
    req.setThinkingDepth(thinkingDepth);
    return req;
  }
}
