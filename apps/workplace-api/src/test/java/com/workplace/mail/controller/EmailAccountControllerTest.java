package com.workplace.mail.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
import com.workplace.mail.dto.ConnectionTestResult;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailConnectionException;
import com.workplace.mail.service.EmailAccountService;
import com.workplace.permission.service.PermissionService;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
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

/** EmailAccountController 라우팅·인증·연결실패 응답 테스트. 서비스는 Mockito. */
@SuppressWarnings("null")
@WebMvcTest(controllers = EmailAccountController.class)
@Import({
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  MailExceptionHandler.class
})
class EmailAccountControllerTest {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper objectMapper;

  @MockitoBean EmailAccountService service;
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

  private EmailAccountResponse sampleResponse() {
    return new EmailAccountResponse(
        10L,
        "box@test.local",
        "박스",
        "imap.x.com",
        993,
        MailSecurity.SSL_TLS,
        "box@test.local",
        "smtp.x.com",
        587,
        MailSecurity.STARTTLS,
        "box@test.local",
        Instant.now(),
        Instant.now(),
        Instant.now(),
        false);
  }

  private EmailAccountRequest sampleRequest() {
    return new EmailAccountRequest(
        "box@test.local",
        "박스",
        "imap.x.com",
        993,
        MailSecurity.SSL_TLS,
        "box@test.local",
        "smtp.x.com",
        587,
        MailSecurity.STARTTLS,
        "box@test.local",
        "pw",
        false);
  }

  @Test
  void list_returnsCallerScoped() throws Exception {
    when(service.list(1L)).thenReturn(List.of(sampleResponse()));
    mockMvc
        .perform(get("/api/v1/mail/accounts").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].id").value(10))
        .andExpect(jsonPath("$[0].emailAddress").value("box@test.local"))
        .andExpect(jsonPath("$[0].password").doesNotExist())
        .andExpect(jsonPath("$[0].encryptedPassword").doesNotExist());
    verify(service).list(1L);
  }

  @Test
  void create_returns201() throws Exception {
    when(service.create(eq(1L), any())).thenReturn(sampleResponse());
    mockMvc
        .perform(
            post("/api/v1/mail/accounts")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(sampleRequest())))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.id").value(10));
  }

  @Test
  void create_validationError_returns400() throws Exception {
    EmailAccountRequest invalid =
        new EmailAccountRequest(
            "",
            "박스",
            "imap.x.com",
            993,
            MailSecurity.SSL_TLS,
            "box@test.local",
            "smtp.x.com",
            587,
            MailSecurity.STARTTLS,
            "box@test.local",
            "pw",
            false);
    mockMvc
        .perform(
            post("/api/v1/mail/accounts")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(invalid)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void create_connectionFailure_returns400WithResult() throws Exception {
    when(service.create(eq(1L), any()))
        .thenThrow(
            new MailConnectionException(
                new ConnectionTestResult(false, "인증 실패 — 사용자명 또는 비밀번호를 확인하세요", true, null)));
    mockMvc
        .perform(
            post("/api/v1/mail/accounts")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(sampleRequest())))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.imapOk").value(false))
        .andExpect(jsonPath("$.imapError").value("인증 실패 — 사용자명 또는 비밀번호를 확인하세요"))
        .andExpect(jsonPath("$.smtpOk").value(true));
  }

  @Test
  void test_returnsConnectionResult() throws Exception {
    when(service.test(any())).thenReturn(new ConnectionTestResult(true, null, true, null));
    mockMvc
        .perform(
            post("/api/v1/mail/accounts/test")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(sampleRequest())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.imapOk").value(true))
        .andExpect(jsonPath("$.smtpOk").value(true));
  }

  @Test
  void delete_returns204() throws Exception {
    mockMvc
        .perform(delete("/api/v1/mail/accounts/10").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(service).delete(eq(1L), eq(10L));
  }

  /**
   * #119 — @ResponseStatus(404) 만 선언한 EmailAccountNotFoundException 이 GlobalExceptionHandler 의
   * catch-all 에 삼켜져 500 으로 응답되던 회귀를 막는다. 존재하지 않거나 본인 소유가 아닌 계정 삭제 시 404 여야 한다.
   */
  @Test
  void delete_notFound_returns404() throws Exception {
    org.mockito.Mockito.doThrow(new EmailAccountNotFoundException(999L))
        .when(service)
        .delete(eq(1L), eq(999L));
    mockMvc
        .perform(delete("/api/v1/mail/accounts/999").header("Authorization", "Bearer v"))
        .andExpect(status().isNotFound());
  }
}
