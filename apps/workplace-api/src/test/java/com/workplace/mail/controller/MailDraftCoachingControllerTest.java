package com.workplace.mail.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.security.UserTokenAuthenticationFilter;
import com.workplace.mail.dto.CoachingNote;
import com.workplace.mail.dto.MailComposeDraft;
import com.workplace.mail.dto.MailDraftCoaching;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.service.MailAiService;
import com.workplace.permission.service.PermissionService;
import com.workplace.support.AlwaysActiveTenantStatusChecker;
import com.workplace.support.PermissionMocks;
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
  AlwaysActiveTenantStatusChecker.class,
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  UserTokenAuthenticationFilter.class,
  MailExceptionHandler.class
})
class MailDraftCoachingControllerTest {

  @Autowired MockMvc mockMvc;

  @MockitoBean MailAiService aiService;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;

  /** WP-420: JWT tenant 경로가 기존 getUserPermissions 스텁을 따르게 한다(PermissionMocks 참고). */
  @BeforeEach
  void mirrorActiveMemberPermissions() {
    PermissionMocks.mirrorActiveMember(permissionService);
  }

  @MockitoBean MembershipRepository membershipRepository;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserApiTokenRepository userApiTokenRepository;
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

  /** WP-576 compose-draft 200 — subject/body 반환, accountId 는 경로에서 서비스로 전달. */
  @Test
  void composeDraft_returns200() throws Exception {
    when(aiService.composeDraft(anyLong(), anyLong(), any()))
        .thenReturn(new MailComposeDraft("제목", "본문"));

    mockMvc
        .perform(
            post("/api/v1/mail/accounts/7/compose-draft")
                .header("Authorization", "Bearer v")
                .contentType("application/json")
                .content(
                    "{\"instruction\":\"써줘\",\"to\":[\"a@x.com\"],\"cc\":[],\"subject\":null}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.subject").value("제목"))
        .andExpect(jsonPath("$.body").value("본문"));
    verify(aiService).composeDraft(eq(1L), eq(7L), any());
  }

  /** WP-576 instruction 이 공백/누락이면 400 — 서비스는 호출하지 않는다. */
  @Test
  void composeDraft_blankInstruction_returns400() throws Exception {
    for (String body : new String[] {"{\"instruction\":\"   \"}", "{\"to\":[]}"}) {
      mockMvc
          .perform(
              post("/api/v1/mail/accounts/7/compose-draft")
                  .header("Authorization", "Bearer v")
                  .contentType("application/json")
                  .content(body))
          .andExpect(status().isBadRequest());
    }
    verify(aiService, never()).composeDraft(anyLong(), anyLong(), any());
  }

  /** WP-576 instruction 이 4000자를 넘으면 400 — 서비스는 호출하지 않는다. */
  @Test
  void composeDraft_instructionTooLong_returns400() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/mail/accounts/7/compose-draft")
                .header("Authorization", "Bearer v")
                .contentType("application/json")
                .content("{\"instruction\":\"" + "가".repeat(4001) + "\"}"))
        .andExpect(status().isBadRequest());
    verify(aiService, never()).composeDraft(anyLong(), anyLong(), any());
  }

  /** WP-576 AI 꺼짐 → 503 + errors.code=AI_DISABLED. */
  @Test
  void composeDraft_aiDisabled_returns503WithCode() throws Exception {
    when(aiService.composeDraft(anyLong(), anyLong(), any()))
        .thenThrow(MailAiUnavailableException.aiDisabled());

    mockMvc
        .perform(
            post("/api/v1/mail/accounts/7/compose-draft")
                .header("Authorization", "Bearer v")
                .contentType("application/json")
                .content("{\"instruction\":\"써줘\"}"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.errors.code").value("AI_DISABLED"));
  }

  /** WP-576 비서 미설정 → 503 + errors.code=ASSISTANT_NOT_CONFIGURED. */
  @Test
  void composeDraft_assistantNotConfigured_returns503WithCode() throws Exception {
    when(aiService.composeDraft(anyLong(), anyLong(), any()))
        .thenThrow(MailAiUnavailableException.assistantNotConfigured());

    mockMvc
        .perform(
            post("/api/v1/mail/accounts/7/compose-draft")
                .header("Authorization", "Bearer v")
                .contentType("application/json")
                .content("{\"instruction\":\"써줘\"}"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.errors.code").value("ASSISTANT_NOT_CONFIGURED"));
  }

  /** WP-576 ai-agent 일시 불가(코드 없는 503) → errors 없음. */
  @Test
  void composeDraft_agentUnavailable_returns503WithoutCode() throws Exception {
    when(aiService.composeDraft(anyLong(), anyLong(), any()))
        .thenThrow(new MailAiUnavailableException("AI 비서를 사용할 수 없어요."));

    mockMvc
        .perform(
            post("/api/v1/mail/accounts/7/compose-draft")
                .header("Authorization", "Bearer v")
                .contentType("application/json")
                .content("{\"instruction\":\"써줘\"}"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.errors").doesNotExist());
  }
}
