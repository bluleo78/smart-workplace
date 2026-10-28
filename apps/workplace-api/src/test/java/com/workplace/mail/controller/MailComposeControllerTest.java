package com.workplace.mail.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.mail.dto.ComposeAttachmentResponse;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.MailSendRequest.InlineImageRef;
import com.workplace.mail.dto.RecentRecipient;
import com.workplace.mail.dto.SendResult;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.service.MailComposeAttachmentService;
import com.workplace.mail.service.MailComposeService;
import com.workplace.mail.service.MailRecentRecipientService;
import com.workplace.permission.service.PermissionService;
import com.workplace.support.PermissionMocks;
import com.workplace.support.WebMvcSliceTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

/** MailComposeController 라우팅·인증·검증응답 테스트. 서비스는 Mockito. */
@SuppressWarnings("null")
class MailComposeControllerTest extends WebMvcSliceTestBase {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper objectMapper;

  @Autowired MailComposeService composeService;
  @Autowired MailComposeAttachmentService attachmentService;
  @Autowired MailRecentRecipientService recentRecipientService;
  @Autowired JwtTokenProvider jwt;
  @Autowired JwtProperties jwtProps;
  @Autowired PermissionService permissionService;

  /** WP-420: JWT tenant 경로가 기존 getUserPermissions 스텁을 따르게 한다(PermissionMocks 참고). */
  @BeforeEach
  void mirrorActiveMemberPermissions() {
    PermissionMocks.mirrorActiveMember(permissionService);
  }

  @Autowired MembershipRepository membershipRepository;

  @Autowired AgentApiKeyRepository agentApiKeyRepository;
  @Autowired UserApiTokenRepository userApiTokenRepository;
  @Autowired UserRepository userRepository;

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of("project:read"));
  }

  /** WP-945: 최근 수신인 — 개수(기본 100)를 서비스에 넘기고 목록을 그대로 돌려준다. */
  @Test
  void recentRecipients_passesDefaultLimit() throws Exception {
    when(recentRecipientService.list(1L, 100))
        .thenReturn(
            List.of(
                new RecentRecipient(
                    "alice@example.com",
                    "앨리스",
                    OffsetDateTime.parse("2026-10-25T09:00:00+09:00"),
                    3)));

    mockMvc
        .perform(get("/api/v1/mail/recent-recipients").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].address").value("alice@example.com"))
        .andExpect(jsonPath("$[0].name").value("앨리스"))
        .andExpect(jsonPath("$[0].sentCount").value(3));
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

  /** WP-69: 원시 JSON 의 inlineImages 가 요청 레코드로 바인딩된다(생략 시 null — 기존 호출처 호환). */
  @Test
  void send_bindsInlineImages() throws Exception {
    when(composeService.send(eq(1L), eq(10L), any()))
        .thenReturn(new SendResult(100L, "gen@test.local"));
    String json =
        """
        {"to":["a@test.local"],"subject":"RE","bodyHtml":"<img src=\\"cid:x.png\\">","bodyText":"b",
         "inlineImages":[{"attachmentId":7,"contentId":"x.png"}]}
        """;

    mockMvc
        .perform(
            post("/api/v1/mail/accounts/{id}/send", 10L)
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json))
        .andExpect(status().isOk());

    ArgumentCaptor<MailSendRequest> cap = ArgumentCaptor.forClass(MailSendRequest.class);
    verify(composeService).send(eq(1L), eq(10L), cap.capture());
    assertThat(cap.getValue().inlineImages()).containsExactly(new InlineImageRef(7L, "x.png"));
  }

  /** inlineImages 를 생략한 기존 호출처(AI 에이전트·확인카드 등) JSON 은 빈 목록으로 바인딩된다. */
  @Test
  void send_withoutInlineImagesField_bindsEmptyList() throws Exception {
    when(composeService.send(eq(1L), eq(10L), any()))
        .thenReturn(new SendResult(100L, "gen@test.local"));
    String json =
        """
        {"to":["a@test.local"],"subject":"s","bodyHtml":"<p>b</p>","bodyText":"b"}
        """;

    mockMvc
        .perform(
            post("/api/v1/mail/accounts/{id}/send", 10L)
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json))
        .andExpect(status().isOk());

    ArgumentCaptor<MailSendRequest> cap = ArgumentCaptor.forClass(MailSendRequest.class);
    verify(composeService).send(eq(1L), eq(10L), cap.capture());
    assertThat(cap.getValue().inlineImages()).isEmpty();
    // WP-574 새 필드도 생략하면 빈 목록 — 첨부 없이 기존처럼 보낸다
    assertThat(cap.getValue().attachmentIds()).isEmpty();
    assertThat(cap.getValue().forwardAttachmentIds()).isEmpty();
  }

  /** WP-574: attachmentIds·forwardAttachmentIds 가 요청 레코드로 바인딩된다. */
  @Test
  void send_bindsAttachmentIds() throws Exception {
    when(composeService.send(eq(1L), eq(10L), any()))
        .thenReturn(new SendResult(100L, "gen@test.local"));
    String json =
        """
        {"to":["a@test.local"],"subject":"s","bodyHtml":"<p>b</p>","bodyText":"b",
         "attachmentIds":[31,32],"forwardAttachmentIds":[7]}
        """;

    mockMvc
        .perform(
            post("/api/v1/mail/accounts/{id}/send", 10L)
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json))
        .andExpect(status().isOk());

    ArgumentCaptor<MailSendRequest> cap = ArgumentCaptor.forClass(MailSendRequest.class);
    verify(composeService).send(eq(1L), eq(10L), cap.capture());
    assertThat(cap.getValue().attachmentIds()).containsExactly(31L, 32L);
    assertThat(cap.getValue().forwardAttachmentIds()).containsExactly(7L);
  }

  /** WP-574: 작성 첨부 업로드 — multipart file → 201 + {id, name, size, mimeType, expiresAt}. */
  @Test
  void uploadAttachment_returns201WithMeta() throws Exception {
    when(attachmentService.upload(eq(1L), any()))
        .thenReturn(
            new ComposeAttachmentResponse(
                55L,
                "보고서.pdf",
                4L,
                "application/pdf",
                OffsetDateTime.parse("2026-10-21T00:00:00Z")));

    mockMvc
        .perform(
            multipart("/api/v1/mail/compose-attachments")
                .file(new MockMultipartFile("file", "보고서.pdf", "application/pdf", new byte[4]))
                .header("Authorization", "Bearer v"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.id").value(55))
        .andExpect(jsonPath("$.name").value("보고서.pdf"))
        .andExpect(jsonPath("$.size").value(4))
        .andExpect(jsonPath("$.mimeType").value("application/pdf"));
  }

  @Test
  void uploadAttachment_requiresAuth() throws Exception {
    mockMvc
        .perform(
            multipart("/api/v1/mail/compose-attachments")
                .file(new MockMultipartFile("file", "a.pdf", "application/pdf", new byte[1])))
        .andExpect(status().isUnauthorized());
  }
}
