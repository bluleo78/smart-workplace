package com.workplace.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.service.WorkspaceAssistantService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 공용 비서 지정 해제(clear) 통합 테스트. */
@Transactional
class WorkspaceAssistantClearTest extends IntegrationTestBase {

  @Autowired WorkspaceAssistantService service;
  @Autowired DSLContext dsl;

  @Test
  void clear_removesDesignation() {
    // given: 어떤 AGENT 를 공용 비서로 지정
    long admin = TestFixtures.createHuman(dsl);
    long agent = TestFixtures.createAgentNoToken(dsl);
    service.setAgent(admin, agent);
    assertThat(service.get().agentUserId()).isEqualTo(agent);

    // when: 해제
    service.clear();

    // then: 미지정 상태(agentUserId = null)
    assertThat(service.get().agentUserId()).isNull();
  }
}
