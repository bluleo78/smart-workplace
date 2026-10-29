package com.workplace.home.controller;

import static com.workplace.jooq.Tables.AI_MEMORY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.home.service.HomeSessionService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.AiPreferenceService;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Record2;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-55 보안 경계(판정 2): source:'AI'·sessionId·AI_MEMORY_DISABLED 는 Internal 토큰 + X-On-Behalf-Of 대행에만
 * 적용된다. 실제 인증 필터를 거치도록 Authorization 헤더로 부른다 — PAT(swp_)·AGENT API 키(ak_)·브라우저 JWT(+위조한
 * X-On-Behalf-Of) 모두 메모리를 꺼 둔 상태에서 409 없이 USER·세션 없음으로 저장돼야 한다.
 *
 * <p>토큰·키는 발급 서비스(감사 로그를 함께 쓴다) 대신 저장소에 해시를 직접 넣는다 — 필터는 해시만 대조한다.
 */
@Transactional
class AiMemoryAuthBoundaryTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/users/me/ai-memories";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired HomeSessionService sessionService;
  @Autowired AiPreferenceService preferences;
  @Autowired UserApiTokenRepository userTokens;
  @Autowired AgentApiKeyRepository agentKeys;
  @Autowired JwtTokenProvider jwt;

  /** 꺼 둔 HUMAN(+ 테넌트#1 멤버십) — 대행이라면 409 가 났을 상태. */
  private long disabledHuman() {
    long uid = withMembership(TestFixtures.createHuman(dsl));
    preferences.update(uid, null, false);
    return uid;
  }

  /** 대행 요청처럼 꾸민 본문 — source:'AI' + 본인 대화 세션. */
  private String aiBody(UUID sessionId) throws Exception {
    return om.writeValueAsString(
        Map.of(
            "kind",
            "PREFERENCE",
            "content",
            "표 대신 짧은 목록으로 보여 준다",
            "source",
            "AI",
            "sessionId",
            sessionId.toString()));
  }

  /** 실제 필터 체인으로 POST 한다. 필터가 finally 에서 지운 테스트 스레드 TenantContext 를 되돌린다. */
  private ResultActions postAs(String authorization, String onBehalfOf, String body)
      throws Exception {
    var rb =
        post(BASE)
            .header("Authorization", authorization)
            .contentType(MediaType.APPLICATION_JSON)
            .content(body);
    if (onBehalfOf != null) rb.header("X-On-Behalf-Of", onBehalfOf);
    try {
      return mvc.perform(rb);
    } finally {
      TenantContext.set(1L);
    }
  }

  /** 저장된 행의 (user_id, source_session_id). */
  private Record2<Long, UUID> ownerAndSession(ResultActions r) throws Exception {
    long id = om.readTree(r.andReturn().getResponse().getContentAsString()).get("id").asLong();
    return dsl.select(AI_MEMORY.USER_ID, AI_MEMORY.SOURCE_SESSION_ID)
        .from(AI_MEMORY)
        .where(AI_MEMORY.ID.eq(id))
        .fetchOne();
  }

  @Test
  void PAT_요청의_AI_출처와_세션은_무시되고_꺼짐_409_도_없다() throws Exception {
    long uid = disabledHuman();
    UUID sid = sessionService.create(uid).id();
    String pat = "swp_wp55boundary" + UUID.randomUUID().toString().replace("-", "");
    userTokens.insert(uid, 1L, "wp55", pat.substring(0, 12), CapabilityTokens.sha256Hex(pat), null);

    ResultActions r =
        postAs("Bearer " + pat, null, aiBody(sid))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.source").value("USER"));
    Record2<Long, UUID> row = ownerAndSession(r);
    assertThat(row.value1()).isEqualTo(uid);
    assertThat(row.value2()).isNull();
  }

  @Test
  void API_키_요청의_AI_출처와_세션은_무시되고_꺼짐_409_도_없다() throws Exception {
    long agent = createAgentUserWithMembership("wp55-boundary");
    preferences.update(agent, null, false);
    UUID sid = sessionService.create(agent).id();
    String key = "ak_wp55boundary" + UUID.randomUUID().toString().replace("-", "");
    agentKeys.insert(agent, key.substring(0, 12), CapabilityTokens.sha256Hex(key), "wp55", agent);

    ResultActions r =
        postAs("Bearer " + key, null, aiBody(sid))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.source").value("USER"));
    Record2<Long, UUID> row = ownerAndSession(r);
    assertThat(row.value1()).isEqualTo(agent);
    assertThat(row.value2()).isNull();
  }

  @Test
  void 브라우저_JWT_에_대행_헤더를_붙여도_대행이_아니다() throws Exception {
    long uid = disabledHuman();
    long other = withMembership(TestFixtures.createHuman(dsl));
    UUID sid = sessionService.create(uid).id();
    String token = jwt.generateAccessToken(uid, "u" + uid, 1L);

    ResultActions r =
        postAs("Bearer " + token, String.valueOf(other), aiBody(sid))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.source").value("USER"));
    Record2<Long, UUID> row = ownerAndSession(r);
    assertThat(row.value1()).isEqualTo(uid); // 헤더의 다른 사용자가 아니라 JWT 주체
    assertThat(row.value2()).isNull();
  }
}
