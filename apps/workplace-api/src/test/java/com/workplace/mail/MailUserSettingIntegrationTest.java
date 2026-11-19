package com.workplace.mail;

import static com.workplace.jooq.Tables.MAIL_USER_SETTING;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.util.HashMap;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * 메일 작성 방식 설정 GET/PUT(WP-1744) 통합 — 처음 조회 DOCK, 저장·덮어쓰기, 잘못된 값·빈 값 400, 사용자·테넌트 분리.
 *
 * <p>@Transactional 이라 MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고, 끝나면 롤백된다. 다른 테넌트 요청은 {@link #useTenant} 로
 * GUC 를 바꾼 뒤 그 테넌트 토큰으로 보낸다.
 */
@Transactional
class MailUserSettingIntegrationTest extends ExternalClientMockedTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired JwtTokenProvider jwtTokenProvider;

  /** 지정 테넌트 토큰 — 실제 요청처럼 JwtAuthenticationFilter 가 TenantContext 를 정한다. */
  String bearer(long userId, long tenantId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId, tenantId);
  }

  /** 테넌트#1 멤버 사용자. */
  long user() {
    return withMembership(TestFixtures.createHuman(dsl));
  }

  /** MockMvc 요청 — JwtAuthenticationFilter 가 요청 끝에 지운 테스트 스레드의 TenantContext 를 그 테넌트로 되돌린다. */
  ResultActions http(RequestBuilder rb, long tenantId) throws Exception {
    try {
      return mvc.perform(rb);
    } finally {
      TenantContext.set(tenantId);
    }
  }

  ResultActions getSetting(long userId, long tenantId) throws Exception {
    return http(
        get("/api/v1/mail/settings").header("Authorization", bearer(userId, tenantId)), tenantId);
  }

  ResultActions getSetting(long userId) throws Exception {
    return getSetting(userId, 1L);
  }

  ResultActions putSetting(long userId, long tenantId, Map<String, Object> body) throws Exception {
    return http(
        put("/api/v1/mail/settings")
            .header("Authorization", bearer(userId, tenantId))
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(body)),
        tenantId);
  }

  ResultActions putSetting(long userId, Map<String, Object> body) throws Exception {
    return putSetting(userId, 1L, body);
  }

  /** 요청 본문 — null 값도 그대로 싣는다(Map.of 는 null 을 받지 않는다). */
  static Map<String, Object> body(Object composeMode) {
    Map<String, Object> b = new HashMap<>();
    b.put("composeMode", composeMode);
    return b;
  }

  @Test
  void 처음_조회하면_DOCK() throws Exception {
    long me = user();

    getSetting(me).andExpect(status().isOk()).andExpect(jsonPath("$.composeMode").value("DOCK"));
  }

  @Test
  void PUT_뒤_GET_은_고른_값() throws Exception {
    long me = user();

    putSetting(me, body("PANE"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.composeMode").value("PANE"));

    getSetting(me).andExpect(status().isOk()).andExpect(jsonPath("$.composeMode").value("PANE"));
  }

  @Test
  void 다시_PUT_하면_덮어쓴다() throws Exception {
    long me = user();
    putSetting(me, body("PANE")).andExpect(status().isOk());

    putSetting(me, body("WINDOW")).andExpect(status().isOk());

    getSetting(me).andExpect(jsonPath("$.composeMode").value("WINDOW"));
    // 한 사람에 한 행만 남는다(upsert).
    assertThat(dsl.fetchCount(MAIL_USER_SETTING, MAIL_USER_SETTING.USER_ID.eq(me))).isEqualTo(1);
  }

  @Test
  void 알_수_없는_값은_400() throws Exception {
    long me = user();

    putSetting(me, body("FULLSCREEN")).andExpect(status().isBadRequest());
    putSetting(me, body("pane")).andExpect(status().isBadRequest());

    // 거절된 요청은 아무것도 남기지 않는다.
    getSetting(me).andExpect(jsonPath("$.composeMode").value("DOCK"));
  }

  @Test
  void composeMode_없으면_400() throws Exception {
    long me = user();

    putSetting(me, body(null)).andExpect(status().isBadRequest());
    putSetting(me, new HashMap<>()).andExpect(status().isBadRequest());
  }

  @Test
  void 다른_사용자의_설정은_보이지_않는다() throws Exception {
    long a = user();
    long b = user();
    putSetting(a, body("WINDOW")).andExpect(status().isOk());

    getSetting(b).andExpect(jsonPath("$.composeMode").value("DOCK"));
    getSetting(a).andExpect(jsonPath("$.composeMode").value("WINDOW"));
  }

  @Test
  void 다른_테넌트의_설정은_보이지_않는다() throws Exception {
    // 같은 사람이 두 워크스페이스(테넌트)에 속한다 — 설정은 테넌트마다 따로다.
    long me = user();
    putSetting(me, body("PANE")).andExpect(status().isOk());

    long other = ensureFixtureTenant("wp1744-other");
    TestFixtures.ensureActiveMember(dsl, me, other);
    useTenant(other);
    // 다른 테넌트에서는 테넌트#1 의 행이 보이지 않는다(RLS) — 조회는 기본값 DOCK.
    assertThat(dsl.fetchCount(MAIL_USER_SETTING, MAIL_USER_SETTING.USER_ID.eq(me))).isZero();
    getSetting(me, other)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.composeMode").value("DOCK"));
    // 다른 테넌트에서 바꿔도 테넌트#1 값은 그대로다.
    putSetting(me, other, body("WINDOW")).andExpect(status().isOk());
    getSetting(me, other).andExpect(jsonPath("$.composeMode").value("WINDOW"));

    useTenant(1L);
    getSetting(me).andExpect(jsonPath("$.composeMode").value("PANE"));
  }
}
