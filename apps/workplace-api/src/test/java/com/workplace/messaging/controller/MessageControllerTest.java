package com.workplace.messaging.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.messaging.dto.ChannelReadStateResponse;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessagePage;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.service.MessageService;
import com.workplace.permission.service.PermissionService;
import com.workplace.support.PermissionMocks;
import com.workplace.support.WebMvcSliceTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** MessageController @WebMvcTest. */
@SuppressWarnings("null")
class MessageControllerTest extends WebMvcSliceTestBase {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper om;
  @Autowired MessageService messageService;
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

  private MessageResponse sample() {
    return new MessageResponse(
        10L,
        1L,
        1L,
        "me",
        "HUMAN",
        "hello",
        java.util.List.of(),
        null,
        0,
        java.util.List.of(),
        java.util.List.of(),
        java.util.List.of(),
        Instant.now(),
        null,
        false,
        0,
        false,
        null,
        java.util.List.of(),
        false);
  }

  @Test
  void list_returnsPage() throws Exception {
    when(messageService.list(eq(1L), eq(1L), any(), eq(50)))
        .thenReturn(new MessagePage(List.of(sample()), null, false));
    mockMvc
        .perform(get("/api/v1/messaging/channels/1/messages").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].body").value("hello"));
  }

  /** DM 읽음 표시(WP-1176) — 읽음 목록을 사람별 위치·시각(ISO)으로 내려준다. */
  @Test
  void readStates_returnsList() throws Exception {
    when(messageService.readStates(1L, 7L))
        .thenReturn(
            List.of(
                new ChannelReadStateResponse(2L, "밥", 41L, Instant.parse("2026-10-29T03:40:00Z"))));
    mockMvc
        .perform(
            get("/api/v1/messaging/channels/7/read-states").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].userId").value(2))
        .andExpect(jsonPath("$[0].lastReadMessageId").value(41))
        .andExpect(jsonPath("$[0].readAt").value("2026-10-29T03:40:00Z"));
  }

  @Test
  void create_201() throws Exception {
    when(messageService.create(eq(1L), eq(1L), any())).thenReturn(sample());
    mockMvc
        .perform(
            post("/api/v1/messaging/channels/1/messages")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(new CreateMessageRequest("hello"))))
        .andExpect(status().isCreated());
  }

  /** driveFileIds 의 null 원소는 400(WP-743 — 500 이 났다). */
  @Test
  void create_driveFileIds_null_원소는_400() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/messaging/channels/1/messages")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"x\",\"driveFileIds\":[null]}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors['driveFileIds[0]']").value("값이 필요합니다"));
    verify(messageService, never()).create(anyLong(), anyLong(), any());
  }
}
