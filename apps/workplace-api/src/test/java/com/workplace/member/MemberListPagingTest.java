package com.workplace.member;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-552 — 구성원 목록(GET /members)의 페이지 파라미터 경계.
 *
 * <p>size 상한이 없어 한 번에 원하는 만큼 받아 갈 수 있었고, page×size 가 int 를 넘으면 음수 offset 이 되어 「음수」라는 영어 400 이 났다.
 * size 는 1~100 으로 막고(한국어 400), 끝을 넘는 page 는 빈 목록으로 답한다. ai-agent 콜백과 같은 Internal 토큰으로 필터→검증 전 구간을
 * 탄다.
 */
class MemberListPagingTest extends IntegrationTestBase {

  /** application-test.yml 의 workplace.ai-agent.internal-token 값. */
  private static final String INTERNAL_TOKEN = "test-token";

  @Autowired private MockMvc mockMvc;

  @Test
  @Transactional
  void list_sizeOver100_returns400WithKoreanMessage() throws Exception {
    Long caller = createAgentUserWithMembership("wp552a");
    mockMvc
        .perform(
            get("/api/v1/members")
                .param("size", "101")
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .header("X-On-Behalf-Of", String.valueOf(caller)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.size", containsString("100")));
  }

  @Test
  @Transactional
  void list_pageBeyondIntRange_returnsEmptyPage() throws Exception {
    Long caller = createAgentUserWithMembership("wp552b");
    mockMvc
        .perform(
            get("/api/v1/members")
                .param("size", "100")
                .param("page", String.valueOf(Integer.MAX_VALUE))
                .header("Authorization", "Internal " + INTERNAL_TOKEN)
                .header("X-On-Behalf-Of", String.valueOf(caller)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content", hasSize(0)));
  }
}
