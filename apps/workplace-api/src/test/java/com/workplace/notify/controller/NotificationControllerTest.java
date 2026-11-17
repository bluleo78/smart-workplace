package com.workplace.notify.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
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
import java.util.stream.Collectors;
import java.util.stream.LongStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
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

  /** WP-1689: 읽은 알림 보관 — 호출자 범위로 서비스에 넘기고 실제 보관한 id 를 돌려준다(웹이 그 묶음으로 되돌리기). */
  @Test
  void archiveRead_returnsArchivedIds() throws Exception {
    when(service.archiveRead(1L)).thenReturn(List.of(5L, 7L));
    mockMvc
        .perform(post("/api/v1/notifications/archive-read").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.archivedIds[0]").value(5))
        .andExpect(jsonPath("$.archivedIds[1]").value(7));
  }

  /** WP-1689: 되돌리기 — 받은 id 를 호출자 범위로 넘기고 실제 되돌린 id 를 돌려준다. */
  @Test
  void unarchive_returnsRestoredIds() throws Exception {
    when(service.unarchive(eq(1L), eq(List.of(5L, 7L)))).thenReturn(List.of(5L));
    mockMvc
        .perform(
            post("/api/v1/notifications/unarchive")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"ids\":[5,7]}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.restoredIds[0]").value(5))
        .andExpect(jsonPath("$.restoredIds.length()").value(1));
  }

  /** WP-1689: 한 번에 최대 1000개 — 1001개는 400, 1000개는 통과. */
  @Test
  void unarchive_rejectsMoreThan1000Ids() throws Exception {
    String over =
        LongStream.rangeClosed(1, 1001).mapToObj(Long::toString).collect(Collectors.joining(","));
    mockMvc
        .perform(
            post("/api/v1/notifications/unarchive")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"ids\":[" + over + "]}"))
        .andExpect(status().isBadRequest());
    verify(service, never()).unarchive(eq(1L), any());

    when(service.unarchive(eq(1L), any())).thenReturn(List.of());
    String max =
        LongStream.rangeClosed(1, 1000).mapToObj(Long::toString).collect(Collectors.joining(","));
    mockMvc
        .perform(
            post("/api/v1/notifications/unarchive")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"ids\":[" + max + "]}"))
        .andExpect(status().isOk());
  }

  /** WP-1689: 빈 배열·ids 없음·null 원소는 400. */
  @Test
  void unarchive_rejectsEmptyOrMissingIds() throws Exception {
    for (String body : List.of("{\"ids\":[]}", "{}", "{\"ids\":[1,null]}")) {
      mockMvc
          .perform(
              post("/api/v1/notifications/unarchive")
                  .header("Authorization", "Bearer v")
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(body))
          .andExpect(status().isBadRequest());
    }
    verify(service, never()).unarchive(eq(1L), any());
  }

  @Test
  void list_unauthenticated_returns401() throws Exception {
    mockMvc.perform(get("/api/v1/notifications")).andExpect(status().isUnauthorized());
  }

  /** WP-1690: 보관함 — 호출자 범위로 서비스에 넘기고 목록과 같은 모양으로 돌려준다. */
  @Test
  void archived_returnsOnlyMyArchived() throws Exception {
    var n =
        new NotificationResponse(
            8L,
            "ASSIGNED",
            null,
            null,
            null,
            7L,
            "WP",
            3,
            "제목",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            true,
            Instant.now());
    when(service.listArchived(eq(1L), eq(20), eq(0L))).thenReturn(List.of(n));

    mockMvc
        .perform(get("/api/v1/notifications/archived").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].id").value(8))
        .andExpect(jsonPath("$[0].read").value(true));
    verify(service).listArchived(eq(1L), eq(20), eq(0L));
  }

  /** WP-1690: limit 은 1~100 으로, 음수 offset 은 0 으로 클램프한다. */
  @Test
  void archived_clampsLimit() throws Exception {
    when(service.listArchived(eq(1L), eq(100), eq(0L))).thenReturn(List.of());

    mockMvc
        .perform(
            get("/api/v1/notifications/archived?limit=500&offset=-5")
                .header("Authorization", "Bearer v"))
        .andExpect(status().isOk());
    verify(service).listArchived(eq(1L), eq(100), eq(0L));
  }
}
