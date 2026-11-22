package com.workplace.global.realtime;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.support.PermissionMocks;
import com.workplace.support.WebMvcSliceTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.time.LocalDateTime;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** EventStreamController @WebMvcTest — chat·messaging·notify 통합 단일 SSE 엔드포인트 테스트. */
@SuppressWarnings("null")
class EventStreamControllerTest extends WebMvcSliceTestBase {

  @Autowired MockMvc mockMvc;
  @Autowired SseRegistry registry;
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
  void stream_registersEmitterForCaller() throws Exception {
    when(registry.register(1L, null)).thenReturn(new SseEmitter());
    mockMvc
        .perform(get("/api/v1/events").header("Authorization", "Bearer v"))
        .andExpect(request().asyncStarted())
        .andExpect(status().isOk());
    verify(registry).register(1L, null);
  }

  /** WP-2008: ak_ 키로 열면 키 id 를 함께 등록하고, JWT 로 열면 키 id 없이 등록한다. */
  @Test
  void agentKeyStream_registersWithKeyId() throws Exception {
    when(agentApiKeyRepository.findActiveByHash(anyString()))
        .thenReturn(Optional.of(new AgentApiKeyRepository.ActiveKey(55L, 9L, null)));
    when(userRepository.findById(9L))
        .thenReturn(
            Optional.of(
                new UserResponse(
                    9L, "bot", "bot@bot.local", "Bot", true, LocalDateTime.now(), UserKind.AGENT)));
    when(permissionService.getUserPermissions(9L)).thenReturn(Set.of("project:read"));
    when(registry.register(9L, 55L)).thenReturn(new SseEmitter());

    mockMvc
        .perform(get("/api/v1/events").header("Authorization", "Bearer ak_testkey"))
        .andExpect(request().asyncStarted());

    verify(registry).register(9L, 55L);
  }

  @Test
  void jwtStream_registersWithoutKeyId() throws Exception {
    when(registry.register(1L, null)).thenReturn(new SseEmitter());
    mockMvc
        .perform(get("/api/v1/events").header("Authorization", "Bearer v"))
        .andExpect(request().asyncStarted());
    verify(registry).register(1L, null);
  }

  @Test
  void stream_unauthenticated_401() throws Exception {
    mockMvc.perform(get("/api/v1/events")).andExpect(status().isUnauthorized());
  }
}
