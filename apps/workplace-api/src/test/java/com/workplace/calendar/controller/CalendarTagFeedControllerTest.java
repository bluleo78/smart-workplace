package com.workplace.calendar.controller;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.calendar.dto.TagFeedResponse;
import com.workplace.calendar.exception.CalendarTagNotFoundException;
import com.workplace.calendar.exception.TagFeedNotFoundException;
import com.workplace.calendar.service.CalendarTagFeedService;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.support.PermissionMocks;
import com.workplace.support.WebMvcSliceTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;

/**
 * CalendarTagFeedController(WP-715) 라우팅·상태 코드 테스트. 서비스는 Mockito. 공개 .ics 는
 * PublicCalendarFeedIntegrationTest.
 */
@SuppressWarnings("null")
class CalendarTagFeedControllerTest extends WebMvcSliceTestBase {

  @Autowired MockMvc mockMvc;

  @Autowired CalendarTagFeedService service;
  @Autowired SseRegistry registry;
  @Autowired JwtTokenProvider jwt;
  @Autowired JwtProperties jwtProps;
  @Autowired PermissionService permissionService;
  @Autowired MembershipRepository membershipRepository;
  @Autowired AgentApiKeyRepository agentApiKeyRepository;
  @Autowired UserApiTokenRepository userApiTokenRepository;
  @Autowired UserRepository userRepository;

  private static final TagFeedResponse FEED =
      new TagFeedResponse(
          "https://example.test/api/v1/public/calendar/feeds/abc.ics",
          OffsetDateTime.parse("2026-10-22T01:00:00Z"),
          12);

  @BeforeEach
  void auth() {
    PermissionMocks.mirrorActiveMember(permissionService);
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L))
        .thenReturn(Set.of("calendar:read", "calendar:write"));
  }

  @Test
  void get_returnsFeed_or404WhenNone() throws Exception {
    when(service.get(1L, 3L)).thenReturn(FEED);
    mockMvc
        .perform(get("/api/v1/calendar/tags/3/feed").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.url").value(FEED.url()))
        .andExpect(jsonPath("$.eventCount").value(12));

    when(service.get(1L, 4L)).thenThrow(new TagFeedNotFoundException());
    mockMvc
        .perform(get("/api/v1/calendar/tags/4/feed").header("Authorization", "Bearer v"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("구독 주소가 없습니다"));
  }

  @Test
  void post_issues_delete_revokes_othersTag404() throws Exception {
    when(service.create(1L, 3L)).thenReturn(FEED);
    mockMvc
        .perform(post("/api/v1/calendar/tags/3/feed").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.url").value(FEED.url()));

    mockMvc
        .perform(delete("/api/v1/calendar/tags/3/feed").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(service).delete(1L, 3L);

    when(service.create(1L, 9L)).thenThrow(new CalendarTagNotFoundException());
    mockMvc
        .perform(post("/api/v1/calendar/tags/9/feed").header("Authorization", "Bearer v"))
        .andExpect(status().isNotFound());
  }

  @Test
  void unauthenticated_is401() throws Exception {
    mockMvc.perform(get("/api/v1/calendar/tags/3/feed")).andExpect(status().isUnauthorized());
  }
}
