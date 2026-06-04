package com.workplace.mail.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.SendResult;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.service.MailComposeService;
import com.workplace.permission.service.PermissionService;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** MailComposeController 라우팅·인증·검증응답 테스트. 서비스는 Mockito. */
@SuppressWarnings("null")
@WebMvcTest(controllers = MailComposeController.class)
@Import({
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  MailExceptionHandler.class
})
class MailComposeControllerTest {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper objectMapper;

  @MockitoBean MailComposeService composeService;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of("project:read"));
  }

  @Test
  void send_returnsSendResult() throws Exception {
    when(composeService.send(eq(1L), eq(10L), any()))
        .thenReturn(new SendResult(100L, "gen@test.local"));
    MailSendRequest body =
        new MailSendRequest(
            List.of("rcpt@test.local"), List.of(), List.of(), "안녕", "<p>본문</p>", "본문", null);

    mockMvc
        .perform(
            post("/api/v1/mail/accounts/{id}/send", 10L)
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.messageId").value("gen@test.local"))
        .andExpect(jsonPath("$.localMessageId").value(100));
  }

  @Test
  void send_validationError_returns400() throws Exception {
    when(composeService.send(eq(1L), eq(10L), any()))
        .thenThrow(new MailValidationException("수신자를 한 명 이상 입력하세요"));
    MailSendRequest body =
        new MailSendRequest(List.of(), List.of(), List.of(), "x", "<p>x</p>", "x", null);

    mockMvc
        .perform(
            post("/api/v1/mail/accounts/{id}/send", 10L)
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("수신자를 한 명 이상 입력하세요"));
  }
}
