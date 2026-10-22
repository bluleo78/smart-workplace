package com.workplace.health;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;

/**
 * /api/v1/health 는 로그인 없이 연다(WP-749). 외부 LB·모니터가 가볍게 부르라고 둔 경로인데(문서·코드 주석도 공개) 인증 필터에 걸려 401 이었다.
 * 응답은 {@code {"status":"ok"}} 뿐이라 열어도 드러나는 정보가 없다. 읽기(GET·HEAD)만 연다.
 */
class HealthEndpointPublicTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;

  @Test
  void 인증_없이_GET_은_200() throws Exception {
    mvc.perform(get("/api/v1/health"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("ok"));
  }

  @Test
  void 인증_없이_HEAD_도_200() throws Exception {
    mvc.perform(head("/api/v1/health")).andExpect(status().isOk());
  }

  @Test
  void 쓰기_메서드는_여전히_인증이_필요하다() throws Exception {
    mvc.perform(post("/api/v1/health")).andExpect(status().isUnauthorized());
  }
}
