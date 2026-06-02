package com.workplace.messaging.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.service.ChannelMemberService;
import com.workplace.messaging.service.ChannelService;
import com.workplace.permission.service.PermissionService;
import com.workplace.user.repository.UserRepository;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** 채널 CRUD/멤버 컨트롤러 라우팅·상태코드 매핑 테스트. 서비스는 Mockito 로 대체. */
@SuppressWarnings("null")
@WebMvcTest(controllers = {ChannelController.class, ChannelMemberController.class})
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class ChannelCrudControllerTest {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper om;

  @MockitoBean ChannelService channelService;
  @MockitoBean ChannelMemberService memberService;
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
  void archive_returns204() throws Exception {
    mockMvc
        .perform(post("/api/v1/messaging/channels/5/archive").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(channelService).archive(eq(1L), eq(5L));
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
