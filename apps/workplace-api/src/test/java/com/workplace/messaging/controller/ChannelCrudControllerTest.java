package com.workplace.messaging.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelUnarchiveNameTakenException;
import com.workplace.messaging.service.ChannelMemberService;
import com.workplace.messaging.service.ChannelService;
import com.workplace.permission.service.PermissionService;
import com.workplace.support.PermissionMocks;
import com.workplace.support.WebMvcSliceTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** 채널 CRUD/멤버 컨트롤러 라우팅·상태코드 매핑 테스트. 서비스는 Mockito 로 대체. */
@SuppressWarnings("null")
class ChannelCrudControllerTest extends WebMvcSliceTestBase {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper om;

  @Autowired ChannelService channelService;
  @Autowired ChannelMemberService memberService;
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

  @Test
  void archive_returns204() throws Exception {
    mockMvc
        .perform(post("/api/v1/messaging/channels/5/archive").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(channelService).archive(eq(1L), eq(5L));
  }

  @Test
  void unarchive_withoutBody_keepsName() throws Exception {
    mockMvc
        .perform(post("/api/v1/messaging/channels/5/unarchive").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(channelService).unarchive(eq(1L), eq(5L), eq(null));
  }

  @Test
  void unarchive_withName_passesTrimmedName() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/messaging/channels/5/unarchive")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"  일반-보관  \"}"))
        .andExpect(status().isNoContent());
    verify(channelService).unarchive(eq(1L), eq(5L), eq("일반-보관"));
  }

  @Test
  void unarchive_blankName_returns400() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/messaging/channels/5/unarchive")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"   \"}"))
        .andExpect(status().isBadRequest());
  }

  /** WP-1084: 같은 이름의 공개 채널이 있어 해제가 거절되면 409 와 사유 코드 — 웹이 새 이름 대화창을 여는 기준. */
  @Test
  void unarchive_nameTaken_returns409WithCode() throws Exception {
    doThrow(new ChannelUnarchiveNameTakenException())
        .when(channelService)
        .unarchive(eq(1L), eq(5L), eq(null));
    mockMvc
        .perform(post("/api/v1/messaging/channels/5/unarchive").header("Authorization", "Bearer v"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("CHANNEL_NAME_TAKEN"))
        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("새 이름")));
  }

  @Test
  void delete_forbidden_returns403() throws Exception {
    doThrow(new ChannelForbiddenException(5L, 1L, "delete-channel"))
        .when(channelService)
        .hardDelete(eq(1L), eq(5L));
    mockMvc
        .perform(delete("/api/v1/messaging/channels/5").header("Authorization", "Bearer v"))
        .andExpect(status().isForbidden());
  }

  @Test
  void rename_returns200() throws Exception {
    mockMvc
        .perform(
            patch("/api/v1/messaging/channels/5")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"새이름\"}"))
        .andExpect(status().isOk());
    verify(channelService).rename(eq(1L), eq(5L), eq("새이름"));
  }

  @Test
  void addMember_returns204() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/messaging/channels/5/members")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"userId\":42}"))
        .andExpect(status().isNoContent());
    verify(memberService).add(eq(1L), eq(5L), eq(42L));
  }
}
