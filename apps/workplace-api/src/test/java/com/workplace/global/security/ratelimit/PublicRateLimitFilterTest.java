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
import java.util.concurrent.Callable;
import java.util.concurrent.ThreadLocalRandom;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
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

  /**
   * 한도를 다 쓴 뒤 429 가 올 때까지 같은 요청을 보낸다(최대 {@code maxAttempts} 회).
   *
   * <p>버킷은 실제 시계로 다시 찬다(로그인 3초·공유 6초에 하나). 부하로 요청이 느리면 「한도+1 번째」가 그새 찬 토큰으로 통과해 정확히 그 번째에서 429 를
   * 기대하면 깨진다 — 정확한 한도·재충전은 고정 시계로 {@link TokenBucketLimiterTest} 가 본다. 여기서는 필터 배선(한도까지 통과 → 곧 거절)만
   * 본다. 추가 시도가 모두 통과하려면 1분 넘게 걸려야 해 제한이 빠진 것만 잡힌다.
   */
  private static ResultActions untilLimited(Callable<ResultActions> request, int maxAttempts)
      throws Exception {
    for (int i = 0; i < maxAttempts; i++) {
      ResultActions r = request.call();
      if (r.andReturn().getResponse().getStatus() == 429) return r;
    }
    throw new AssertionError("한도를 넘긴 뒤 " + maxAttempts + "회 안에 429 가 오지 않았다");
  }

  @Test
  void 같은_IP_로그인은_20회까지_받고_넘기면_429와_안내를_돌려준다() throws Exception {
    String ip = randomDocIp();
    for (int i = 0; i < 20; i++) {
      mvc.perform(login("198.51.100.9, " + ip)).andExpect(status().isUnauthorized());
    }
    untilLimited(() -> mvc.perform(login("198.51.100.9, " + ip)), 20)
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
    untilLimited(
            () ->
                mvc.perform(
                    get("/api/v1/public/drive/share/sl_" + UUID.randomUUID() + "/download")
                        .header("X-Forwarded-For", ip)
                        .header("X-Share-Password", "x")),
            10)
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
