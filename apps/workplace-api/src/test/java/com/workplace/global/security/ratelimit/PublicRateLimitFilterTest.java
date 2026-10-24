package com.workplace.global.security.ratelimit;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 공개 경로 IP 속도 제한(WP-763) — 실제 보안 필터 체인을 거쳐 한도를 넘긴 요청이 429·Retry-After·한국어 안내로 거절되는지 본다.
 *
 * <p>버킷은 애플리케이션 컨텍스트에 하나라 테스트마다 다른 문서용 IP(203.0.113.x)를 쓴다. MockMvc 접속 주소는 127.0.0.1(내부)이라
 * X-Forwarded-For 마지막 값이 클라이언트 IP 가 된다.
 */
@Transactional
class PublicRateLimitFilterTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;

  private static String randomDocIp() {
    return "203.0.113." + ThreadLocalRandom.current().nextInt(1, 255);
  }

  private static MockHttpServletRequestBuilder login(String forwardedFor) {
    MockHttpServletRequestBuilder b =
        post("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            // 아이디는 매번 바꾼다 — 같은 아이디면 계정 잠금(5회, 역시 429)이 먼저 걸려 IP 제한과 구분되지 않는다.
            .content(
                "{\"username\":\"rl-"
                    + UUID.randomUUID()
                    + "@example.com\",\"password\":\"wrong\"}");
    return forwardedFor == null ? b : b.header("X-Forwarded-For", forwardedFor);
  }

  @Test
  void 같은_IP_로그인은_20회까지_받고_21번째는_429와_안내를_돌려준다() throws Exception {
    String ip = randomDocIp();
    for (int i = 0; i < 20; i++) {
      mvc.perform(login("198.51.100.9, " + ip)).andExpect(status().isUnauthorized());
    }
    mvc.perform(login("198.51.100.9, " + ip))
        .andExpect(status().isTooManyRequests())
        .andExpect(header().exists("Retry-After"))
        .andExpect(jsonPath("$.message").value(PublicRateLimitFilter.MESSAGE));
    // 다른 IP 는 따로 센다 — 앞단이 붙인 마지막 값이 다르면 막히지 않는다.
    mvc.perform(login("198.51.100.9, 192.0.2.77")).andExpect(status().isUnauthorized());
  }

  @Test
  void 프록시를_거치지_않은_루프백_요청은_제한하지_않는다() throws Exception {
    for (int i = 0; i < 25; i++) mvc.perform(login(null)).andExpect(status().isUnauthorized());
  }

  // 토큰도 매번 바꾼다 — 같은 공유 링크면 비밀번호 잠금(#700, 역시 429)과 구분되지 않는다.
  @Test
  void 비밀번호를_실은_공유_다운로드는_10회까지_받는다() throws Exception {
    String ip = randomDocIp();
    for (int i = 0; i < 10; i++) {
      mvc.perform(
              get("/api/v1/public/drive/share/sl_" + UUID.randomUUID() + "/download")
                  .header("X-Forwarded-For", ip)
                  .header("X-Share-Password", "x"))
          .andExpect(
              result -> {
                if (result.getResponse().getStatus() == 429) throw new AssertionError("한도 전 429");
              });
    }
    mvc.perform(
            get("/api/v1/public/drive/share/sl_" + UUID.randomUUID() + "/download")
                .header("X-Forwarded-For", ip)
                .header("X-Share-Password", "x"))
        .andExpect(status().isTooManyRequests())
        .andExpect(content().string(containsString("요청이 너무 많습니다")));
    // 비밀번호 없는 다운로드는 세지 않는다
    mvc.perform(
            get("/api/v1/public/drive/share/sl_" + UUID.randomUUID() + "/download")
                .header("X-Forwarded-For", ip))
        .andExpect(
            result -> {
              if (result.getResponse().getStatus() == 429)
                throw new AssertionError("비밀번호 없는 요청이 제한됨");
            });
  }
}
