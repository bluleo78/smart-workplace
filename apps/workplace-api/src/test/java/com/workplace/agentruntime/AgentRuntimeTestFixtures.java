package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.TestFixtures;
import java.util.Map;
import org.jooq.DSLContext;
import org.springframework.test.web.servlet.ResultActions;

/**
 * agentruntime API 통합 테스트들이 함께 쓰는 준비·조회 도우미 — 테넌트 1 에 Works 가 띄우는 AI 를 만들고 켜며, 실행 설정 generation 과
 * 응답 JSON 을 읽는다. 테스트마다 같은 메서드를 되풀이하지 않게 한곳에 둔다.
 */
final class AgentRuntimeTestFixtures {

  private final DSLContext dsl;
  private final ObjectMapper om;
  private final AgentRuntimeSettingService settingService;
  private final long admin;

  /**
   * @param admin 실행 설정을 저장·켜는 관리자
   */
  AgentRuntimeTestFixtures(
      DSLContext dsl, ObjectMapper om, AgentRuntimeSettingService settingService, long admin) {
    this.dsl = dsl;
    this.om = om;
    this.settingService = settingService;
    this.admin = admin;
  }

  /** 테넌트 1 에 AI 를 만들고 claude-code 실행 설정을 둔다(꺼진 채). {@code locationId} 가 null 이면 기본 위치를 따른다. */
  long newAgent(Long locationId) {
    TenantContext.set(1L);
    long agent =
        TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    settingService.put(
        admin, agent, new PutAgentRuntimeSettingRequest("claude-code", locationId, Map.of(), null));
    return agent;
  }

  /** {@link #newAgent} 뒤 켠다. */
  long runningAgent(Long locationId) {
    long agent = newAgent(locationId);
    settingService.start(admin, agent);
    return agent;
  }

  /** 실행 설정의 지금 generation(지금 GUC 의 테넌트에서 보이는 행). */
  long generationOf(long agent) {
    return dsl.select(AGENT_RUNTIME_SETTING.GENERATION)
        .from(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .fetchOne(AGENT_RUNTIME_SETTING.GENERATION);
  }

  /** 응답 본문 JSON. */
  JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }
}
