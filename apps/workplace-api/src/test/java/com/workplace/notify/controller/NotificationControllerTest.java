package com.workplace.notify.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.service.NotificationService;
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
import org.springframework.test.web.servlet.MockMvc;

/** NotificationController 라우팅·페이로드·인증 테스트. 서비스는 Mockito. */
@SuppressWarnings("null")
class NotificationControllerTest extends WebMvcSliceTestBase {

  @Autowired MockMvc mockMvc;

  @Autowired NotificationService service;
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
  void list_returnsCallerScoped() throws Exception {
    var n =
        new NotificationResponse(
            5L,
            "COMMENTED",
            9L,
            "AI",
            "AGENT",
            7L,
            "WP",
            3,
            "제목",
            55L,
            null,
            null,
            null,
            null,
            null,
            null,
            // 상태 이름(WP-869)과 AI 작업 상태(WP-913)는 같은 String 자리라 뒤바뀌어도 컴파일된다 — 다른 값으로 두 필드를 함께 단언한다.
            "검토 중",
            "REVIEW",
            false,
            Instant.now());
    when(service.listRecent(eq(1L), eq(20), eq(0L))).thenReturn(List.of(n));

    mockMvc
        .perform(get("/api/v1/notifications").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].id").value(5))
        .andExpect(jsonPath("$[0].actorKind").value("AGENT"))
        .andExpect(jsonPath("$[0].projectKey").value("WP"))
        .andExpect(jsonPath("$[0].issueNumber").value(3))
        .andExpect(jsonPath("$[0].statusName").value("검토 중"))
        .andExpect(jsonPath("$[0].agentWorkState").value("REVIEW"));
    verify(service).listRecent(eq(1L), eq(20), eq(0L));
  }

  /** #610 — 무한스크롤 다음 페이지 요청 시 offset 이 서비스로 그대로 전달된다. */
  @Test
  void list_passesOffsetParam() throws Exception {
    when(service.listRecent(eq(1L), eq(20), eq(20L))).thenReturn(List.of());

    mockMvc
        .perform(
            get("/api/v1/notifications").param("offset", "20").header("Authorization", "Bearer v"))
        .andExpect(status().isOk());
    verify(service).listRecent(eq(1L), eq(20), eq(20L));
  }

  @Test
  void unreadCount_returnsCountObject() throws Exception {
    when(service.countUnread(1L)).thenReturn(4L);
    mockMvc
        .perform(get("/api/v1/notifications/unread-count").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.count").value(4));
  }

  @Test
  void markRead_returns204_andScopesToCaller() throws Exception {
    mockMvc
        .perform(post("/api/v1/notifications/5/read").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(service).markRead(eq(1L), eq(5L));
  }

  /** WP-720: 한 이슈의 내 알림 읽음 — 호출자 범위로 서비스에 넘기고 204. */
  @Test
  void markIssueRead_returns204_andScopesToCaller() throws Exception {
    mockMvc
        .perform(post("/api/v1/notifications/issues/42/read").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(service).markReadByIssue(eq(1L), eq(42L));
  }

  @Test
  void markAllRead_returns204() throws Exception {
    mockMvc
        .perform(post("/api/v1/notifications/read-all").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(service).markAllRead(eq(1L));
  }

  @Test
  void list_unauthenticated_returns401() throws Exception {
    mockMvc.perform(get("/api/v1/notifications")).andExpect(status().isUnauthorized());
  }
}
