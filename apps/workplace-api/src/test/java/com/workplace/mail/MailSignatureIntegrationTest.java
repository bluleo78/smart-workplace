package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

/**
 * 메일 서명 GET/PUT(WP-1517) 통합 — 처음 조회 기본값, 저장·정리·다시 조회, 사용자별 분리, 내 이미지가 아닌 img 빼기, 크기·null 플래그 400.
 */
@Transactional
class MailSignatureIntegrationTest extends ExternalClientMockedTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired JwtTokenProvider jwtTokenProvider;

  /** 테넌트#1 토큰 — 실제 요청처럼 JwtAuthenticationFilter 가 TenantContext 를 정한다. */
  String bearer(long userId) {
    return "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId, 1L);
  }

  /** 테넌트#1 멤버 사용자. */
  long user() {
    return withMembership(TestFixtures.createHuman(dsl));
  }

  /** MockMvc 요청 — JwtAuthenticationFilter 가 요청 끝에 지운 테스트 스레드의 TenantContext 를 되돌린다. */
  ResultActions http(RequestBuilder rb) throws Exception {
    try {
      return mvc.perform(rb);
    } finally {
      TenantContext.set(1L);
    }
  }

  ResultActions getSignature(long userId) throws Exception {
    return http(get("/api/v1/mail/signature").header("Authorization", bearer(userId)));
  }

  ResultActions putSignature(long userId, Map<String, Object> body) throws Exception {
    return http(
        put("/api/v1/mail/signature")
            .header("Authorization", bearer(userId))
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(body)));
  }

  static Map<String, Object> body(String html, Boolean autoNew, Boolean autoReply) {
    Map<String, Object> b = new HashMap<>();
    b.put("html", html);
    b.put("autoNew", autoNew);
    b.put("autoReply", autoReply);
    return b;
  }

  JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }

  @Test
  void 처음_조회는_빈_서명과_기본_스위치() throws Exception {
    long me = user();

    getSignature(me)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.html").value(""))
        .andExpect(jsonPath("$.autoNew").value(true))
        .andExpect(jsonPath("$.autoReply").value(false))
        .andExpect(jsonPath("$.updatedAt").doesNotExist())
        .andExpect(jsonPath("$.droppedImageCount").value(0));
  }

  @Test
  void 저장하면_정리된_html과_스위치가_돌아오고_다시_조회된다() throws Exception {
    long me = user();

    JsonNode saved =
        json(
            putSignature(
                    me, body("<p style=\"color:#123456\">홍길동<script>x</script></p>", false, true))
                .andExpect(status().isOk()));

    assertThat(saved.get("html").asText())
        .contains("color:#123456")
        .contains("홍길동")
        .doesNotContain("script");
    assertThat(saved.get("autoNew").asBoolean()).isFalse();
    assertThat(saved.get("autoReply").asBoolean()).isTrue();
    assertThat(saved.get("updatedAt").isNull()).isFalse();

    JsonNode again = json(getSignature(me).andExpect(status().isOk()));
    assertThat(again.get("html").asText()).isEqualTo(saved.get("html").asText());
    assertThat(again.get("autoNew").asBoolean()).isFalse();
    assertThat(again.get("autoReply").asBoolean()).isTrue();
  }

  @Test
  void 다시_저장하면_덮어쓴다() throws Exception {
    long me = user();
    putSignature(me, body("<p>처음</p>", true, false)).andExpect(status().isOk());

    putSignature(me, body("<p>나중</p>", true, true)).andExpect(status().isOk());

    getSignature(me)
        .andExpect(jsonPath("$.html").value("<p>나중</p>"))
        .andExpect(jsonPath("$.autoReply").value(true));
  }

  @Test
  void 글자도_이미지도_없으면_빈_서명으로_저장한다() throws Exception {
    long me = user();
    putSignature(me, body("<p>홍길동</p>", true, false)).andExpect(status().isOk());

    putSignature(me, body("<p>&nbsp;</p><p></p>", true, false))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.html").value(""));
  }

  @Test
  void 사용자마다_따로() throws Exception {
    long a = user();
    long b = user();
    putSignature(a, body("<p>A 서명</p>", true, false)).andExpect(status().isOk());

    getSignature(b).andExpect(jsonPath("$.html").value(""));
  }

  @Test
  void 내_이미지가_아닌_img는_빼고_센다() throws Exception {
    long me = user();

    JsonNode saved =
        json(
            putSignature(me, body("<img src=\"file:///C:/a.png\"><p>x</p>", true, false))
                .andExpect(status().isOk()));

    assertThat(saved.get("droppedImageCount").asInt()).isEqualTo(1);
    assertThat(saved.get("html").asText()).doesNotContain("<img").contains("x");
  }

  @Test
  void html_요청_상한_8M자_초과는_400() throws Exception {
    long me = user();
    String big = "<p>" + "a".repeat(8_000_000) + "</p>";

    putSignature(me, body(big, true, false))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("서명이 너무 길어요"));
  }

  @Test
  void 정리_뒤_100KB_초과는_400() throws Exception {
    long me = user();
    String long1 = "<p>" + "가".repeat(60 * 1024) + "</p>";

    putSignature(me, body(long1, true, false))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("서명이 너무 길어요"));
  }

  @Test
  void 플래그_null은_400() throws Exception {
    long me = user();

    putSignature(me, body("<p>x</p>", null, false))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("서명 설정 값이 비어 있어요"));
    putSignature(me, body("<p>x</p>", true, null)).andExpect(status().isBadRequest());
    putSignature(me, body(null, true, false)).andExpect(status().isBadRequest());
  }
}
