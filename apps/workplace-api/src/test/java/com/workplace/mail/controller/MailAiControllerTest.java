package com.workplace.mail.controller;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.mail.dto.MailReplyDraft;
import com.workplace.mail.dto.MailSummary;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.service.MailAiService;
import com.workplace.mail.service.MailIssueService;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** MailAiController 라우팅·인증·예외응답 테스트. 서비스는 Mockito. */
@SuppressWarnings("null")
@WebMvcTest(controllers = MailAiController.class)
@Import({
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  MailExceptionHandler.class
})
class MailAiControllerTest {

  @Autowired MockMvc mockMvc;

  @MockitoBean MailAiService aiService;
  @MockitoBean MailIssueService issueService;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;

  @MockitoBean MembershipRepository membershipRepository;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of("project:read"));
  }

  /** 요약 GET 200 — summarize 결과가 $.summary 로 반환된다. */
  @Test
  void summary_returns200() throws Exception {
    when(aiService.summarize(anyLong(), eq(5L))).thenReturn(new MailSummary("• 요약"));

    mockMvc
        .perform(get("/api/v1/mail/messages/5/summary").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.summary").value("• 요약"));
  }

  /** AI 비서 미활성 → 503 서비스 불가. */
  @Test
  void summary_aiUnavailable_returns503() throws Exception {
    when(aiService.summarize(anyLong(), eq(5L))).thenThrow(new MailAiUnavailableException("꺼짐"));

    mockMvc
        .perform(get("/api/v1/mail/messages/5/summary").header("Authorization", "Bearer v"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.message").value("꺼짐"));
  }

  /** 답장 초안 POST 200 — replyDraft 결과가 $.draftBody 로 반환된다. */
  @Test
  void replyDraft_returns200() throws Exception {
    when(aiService.replyDraft(anyLong(), eq(5L))).thenReturn(new MailReplyDraft("안녕하세요"));

    mockMvc
        .perform(post("/api/v1/mail/messages/5/reply-draft").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.draftBody").value("안녕하세요"));
  }
}
