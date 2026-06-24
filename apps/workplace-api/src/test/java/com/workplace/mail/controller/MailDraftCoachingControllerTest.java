package com.workplace.mail.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.mail.dto.CoachingNote;
import com.workplace.mail.dto.MailDraftCoaching;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.service.MailAiService;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** MailDraftCoachingController 라우팅·인증·예외응답 테스트. 서비스는 Mockito. */
@SuppressWarnings("null")
@WebMvcTest(controllers = MailDraftCoachingController.class)
@Import({
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  MailExceptionHandler.class
})
class MailDraftCoachingControllerTest {

  @Autowired MockMvc mockMvc;

  @MockitoBean MailAiService aiService;
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

  /** 코칭 POST 200 — notes/improvedBodyHtml 반환. */
  @Test
  void coachDraft_returns200() throws Exception {
    when(aiService.coachDraft(anyLong(), any()))
        .thenReturn(new MailDraftCoaching(List.of(new CoachingNote("TONE", "명령조")), "<p>개선</p>"));

    mockMvc
        .perform(
            post("/api/v1/mail/draft-coaching")
                .header("Authorization", "Bearer v")
                .contentType("application/json")
                .content(
                    "{\"accountId\":1,\"bodyHtml\":\"<p>x</p>\",\"bodyText\":\"x\",\"inReplyToMessageId\":null}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.notes[0].dimension").value("TONE"))
        .andExpect(jsonPath("$.improvedBodyHtml").value("<p>개선</p>"));
  }

  /** AI 꺼짐 → 503. */
  @Test
  void coachDraft_unavailable_returns503() throws Exception {
    when(aiService.coachDraft(anyLong(), any())).thenThrow(new MailAiUnavailableException("꺼짐"));

    mockMvc
        .perform(
            post("/api/v1/mail/draft-coaching")
                .header("Authorization", "Bearer v")
                .contentType("application/json")
                .content(
                    "{\"accountId\":1,\"bodyHtml\":\"<p>x</p>\",\"bodyText\":\"x\",\"inReplyToMessageId\":null}"))
        .andExpect(status().isServiceUnavailable());
  }
}
