package com.workplace.global.exception;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * JSON 문자열 하나가 Jackson 한도(maxStringLength 2천만 자)를 넘으면 한도 안내 400 으로 거절한다(WP-1387).
 *
 * <p>이 오류는 본문 해석 중에 터져 컨트롤러·검증에 닿기 전에 공통 「요청 본문을 해석할 수 없습니다.」로 나갔다. Jackson 한도는 그대로 두고, 오류 응답 한곳에서
 * 「내용이 너무 깁니다」로 알린다. 해석 단계에서 끝나므로 존재하지 않는 드라이브 파일 id 로도 같은 응답을 확인할 수 있다.
 */
@Transactional
class OversizedJsonValueTest extends IntegrationTestBase {

  private static final String TOO_LONG = "입력한 내용이 너무 깁니다. 내용을 줄여 다시 보내 주세요.";

  /** 한도(20,000,000)를 넘는 문자열 — 클래스 상수로 두면 테스트 JVM 이 끝날 때까지 21MB 가 남아 테스트마다 만든다. */
  private static String huge() {
    return "a".repeat(21_000_000);
  }

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;

  private String token;

  @BeforeEach
  void user() {
    long id = TestFixtures.createHuman(dsl);
    TestFixtures.grantRole(dsl, id, "USER");
    TestFixtures.activeMemberOfCurrentTenant(dsl, id);
    token = jwtTokenProvider.generateAccessToken(id, "big-" + id, 1L);
  }

  @Test
  void 드라이브_텍스트_저장_본문이_한도를_넘으면_너무_길다_400() throws Exception {
    mvc.perform(
            post("/api/v1/drive/files/999999/text")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"" + huge() + "\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(TOO_LONG))
        .andExpect(jsonPath("$.errors.content").value("너무 깁니다"));
  }

  @Test
  void 다른_API_도_같은_문구로_거절한다() throws Exception {
    mvc.perform(
            post("/api/v1/projects")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"key\":\"BIG\",\"name\":\"x\",\"type\":\"TEAM\",\"description\":\""
                        + huge()
                        + "\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(TOO_LONG))
        .andExpect(jsonPath("$.errors.description").value("너무 깁니다"));
  }

  @Test
  void 깨진_JSON_은_기존_문구_그대로() throws Exception {
    mvc.perform(
            post("/api/v1/projects")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"a\":"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("요청 본문을 해석할 수 없습니다."));
  }

  @Test
  void 중첩_깊이_초과는_길다고_하지_않고_기존_문구() throws Exception {
    // 중첩 깊이 한도(1000)도 같은 StreamConstraintsException 이지만 「길다」가 아니라 일반 문구로 둔다.
    String deep = "{\"description\":" + "[".repeat(1100) + "]".repeat(1100) + "}";
    mvc.perform(
            post("/api/v1/projects")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(deep))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("요청 본문을 해석할 수 없습니다."));
  }
}
