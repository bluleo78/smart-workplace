package com.workplace.messaging.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** 메시징 AI 실행 임대 내부 엔드포인트(WP-1979) — 내부 토큰 + X-On-Behalf-Of 만 200, 사람 JWT 는 403. */
@Transactional
class MessagingAgentRunInternalControllerTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/internal/messaging/agent-runs/";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;

  private long agent;

  /** 내부 호출이 대행할 실제 AI 구성원을 만든다(없는 id 면 인증이 401). */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    agent = withMembership(TestFixtures.createAgentNoToken(dsl));
  }

  private ResultActions internal(String path, Map<String, Object> body) throws Exception {
    ResultActions r =
        mvc.perform(
            post(BASE + path)
                .header("Authorization", "Internal test-token")
                .header("X-On-Behalf-Of", String.valueOf(agent))
                .header("X-On-Behalf-Of-Tenant", "1")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body)));
    TenantContext.set(1L);
    return r;
  }

  @Test
  void 내부_호출은_획득_반납이_200() throws Exception {
    dsl.execute("set app.tenant_id = '1'");
    String res =
        internal(
                "acquire",
                Map.of(
                    "channelId",
                    -3101,
                    "agentId",
                    agent,
                    "messageId",
                    10,
                    "leaseMs",
                    60000,
                    "event",
                    Map.of("a", 1)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("ACQUIRED"))
            .andReturn()
            .getResponse()
            .getContentAsString();
    String token = om.readTree(res).get("token").asText();
    internal(
            "release",
            Map.of("channelId", -3101, "agentId", agent, "token", token, "leaseMs", 60000))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.next").doesNotExist());
  }

  /** ai-agent 가 보낸 토큰을 그대로 소유 토큰으로 쓰고 돌려준다 — 그 토큰으로 반납이 된다. */
  @Test
  void 보낸_토큰으로_획득하고_반납한다() throws Exception {
    dsl.execute("set app.tenant_id = '1'");
    String token = java.util.UUID.randomUUID().toString();
    internal(
            "acquire",
            Map.of(
                "channelId",
                -3103,
                "agentId",
                agent,
                "messageId",
                10,
                "leaseMs",
                60000,
                "event",
                Map.of("a", 1),
                "token",
                token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("ACQUIRED"))
        .andExpect(jsonPath("$.token").value(token));
    internal(
            "release",
            Map.of("channelId", -3103, "agentId", agent, "token", token, "leaseMs", 60000))
        .andExpect(status().isOk());
    internal(
            "acquire",
            Map.of(
                "channelId",
                -3103,
                "agentId",
                agent,
                "messageId",
                11,
                "leaseMs",
                60000,
                "event",
                Map.of("a", 2)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("ACQUIRED"));
  }

  /** UUID 가 아닌 토큰·빠진 event·JSON null event 는 400. */
  @Test
  void 잘못된_토큰이나_빠진_event는_400() throws Exception {
    dsl.execute("set app.tenant_id = '1'");
    internal(
            "acquire",
            Map.of(
                "channelId",
                -3104,
                "agentId",
                agent,
                "messageId",
                10,
                "leaseMs",
                60000,
                "event",
                Map.of("a", 1),
                "token",
                "nope"))
        .andExpect(status().isBadRequest());
    internal(
            "acquire",
            Map.of("channelId", -3104, "agentId", agent, "messageId", 10, "leaseMs", 60000))
        .andExpect(status().isBadRequest());
    java.util.Map<String, Object> nullEvent = new java.util.HashMap<>();
    nullEvent.put("channelId", -3104);
    nullEvent.put("agentId", agent);
    nullEvent.put("messageId", 10);
    nullEvent.put("leaseMs", 60000);
    nullEvent.put("event", null);
    internal("acquire", nullEvent).andExpect(status().isBadRequest());
  }

  @Test
  void 본문_agentId가_대행_AI와_다르면_403() throws Exception {
    dsl.execute("set app.tenant_id = '1'");
    internal(
            "acquire",
            Map.of("channelId", -3102, "agentId", agent + 1, "messageId", 10, "leaseMs", 60000))
        .andExpect(status().isForbidden());
    internal(
            "release",
            Map.of("channelId", -3102, "agentId", agent + 1, "token", "x", "leaseMs", 60000))
        .andExpect(status().isForbidden());
  }

  @Test
  void 사람_JWT는_403() throws Exception {
    long human = withMembership(TestFixtures.createHuman(dsl));
    mvc.perform(
            post(BASE + "acquire")
                .header(
                    "Authorization", "Bearer " + jwt.generateAccessToken(human, "u-" + human, 1L))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"channelId\":-3101,\"agentId\":7,\"messageId\":10,\"leaseMs\":60000}"))
        .andExpect(status().isForbidden());
    TenantContext.set(1L);
  }
}
