package com.workplace.auth.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * /users/me/provider-credential — ApiKeyAuthenticationFilter 가 principal 을 Long 으로 세팅하는 흐름이 본질이라
 * mockMvc 만으로는 재현 까다로움. 본 테스트는 인증 없이 4xx 만 검증하고 (실제 동작은 service 통합 테스트 + ai-agent nock 기반 테스트 + 수동
 * e2e 로 갈음).
 */
@AutoConfigureMockMvc
@Transactional
class MyProviderCredentialControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;

  @Test
  void without_auth_returns_4xx() throws Exception {
    mvc.perform(get("/api/v1/users/me/provider-credential")).andExpect(status().is4xxClientError());
  }
}
