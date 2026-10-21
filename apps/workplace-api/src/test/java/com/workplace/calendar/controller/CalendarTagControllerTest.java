package com.workplace.calendar.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.calendar.dto.CalendarTagRequest;
import com.workplace.calendar.dto.CalendarTagResponse;
import com.workplace.calendar.exception.CalendarTagDuplicateNameException;
import com.workplace.calendar.exception.CalendarTagNotFoundException;
import com.workplace.calendar.exception.ExternalEventTagNotSupportedException;
import com.workplace.calendar.exception.OutlookTagRenameNotAllowedException;
import com.workplace.calendar.service.CalendarTagService;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.security.UserTokenAuthenticationFilter;
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
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** CalendarTagController(WP-714) 라우팅·상태 코드·한국어 오류 문구 테스트. 서비스는 Mockito. */
@SuppressWarnings("null")
@WebMvcTest(controllers = CalendarTagController.class)
@Import({
  AlwaysActiveTenantStatusChecker.class,
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  UserTokenAuthenticationFilter.class
})
class CalendarTagControllerTest {

  @Autowired MockMvc mockMvc;

  @MockitoBean CalendarTagService service;
  @MockitoBean SseRegistry registry;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;
  @MockitoBean MembershipRepository membershipRepository;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserApiTokenRepository userApiTokenRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    PermissionMocks.mirrorActiveMember(permissionService);
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L))
        .thenReturn(Set.of("calendar:read", "calendar:write"));
  }

  @Test
  void list_returnsTags() throws Exception {
    when(service.list(1L))
        .thenReturn(List.of(new CalendarTagResponse(3, "운영", "amber", 5, true, true)));
    mockMvc
        .perform(get("/api/v1/calendar/tags").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].name").value("운영"))
        .andExpect(jsonPath("$[0].eventCount").value(5))
        .andExpect(jsonPath("$[0].hasFeed").value(true))
        .andExpect(jsonPath("$[0].fromOutlook").value(true));
  }

  /** Outlook 범주에서 온 태그의 이름 바꾸기는 409 + 한국어 안내. */
  @Test
  void patch_renameOutlookTag_is409WithKoreanMessage() throws Exception {
    when(service.update(eq(1L), eq(3L), eq(new CalendarTagRequest("Job", "amber"))))
        .thenThrow(new OutlookTagRenameNotAllowedException());
    mockMvc
        .perform(
            patch("/api/v1/calendar/tags/3")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Job\",\"color\":\"amber\"}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value("Outlook 범주에서 온 태그라 이름은 Outlook에서 바꿔 주세요"));
  }

  @Test
  void create_returns201_andDuplicateIs409WithKoreanMessage() throws Exception {
    when(service.create(eq(1L), eq(new CalendarTagRequest("출장", "pink"))))
        .thenReturn(new CalendarTagResponse(9, "출장", "pink", 0, false, false));
    mockMvc
        .perform(
            post("/api/v1/calendar/tags")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"출장\",\"color\":\"pink\"}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.id").value(9));

    when(service.create(eq(1L), eq(new CalendarTagRequest("운영", null))))
        .thenThrow(new CalendarTagDuplicateNameException());
    mockMvc
        .perform(
            post("/api/v1/calendar/tags")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"운영\"}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value("같은 이름의 태그가 이미 있습니다"));
  }

  @Test
  void patchAndDelete_othersTag_is404() throws Exception {
    when(service.update(eq(1L), eq(7L), any())).thenThrow(new CalendarTagNotFoundException());
    doThrow(new CalendarTagNotFoundException()).when(service).delete(1L, 7L);
    mockMvc
        .perform(
            patch("/api/v1/calendar/tags/7")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"color\":\"teal\"}"))
        .andExpect(status().isNotFound());
    mockMvc
        .perform(delete("/api/v1/calendar/tags/7").header("Authorization", "Bearer v"))
        .andExpect(status().isNotFound());
  }

  @Test
  void putEventTags_204_validation400_external409() throws Exception {
    mockMvc
        .perform(
            put("/api/v1/calendar/events/50/tags")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"tagIds\":[1,2]}"))
        .andExpect(status().isNoContent());
    verify(service).setEventTags(1L, 50L, List.of(1L, 2L));

    // tagIds 누락 → 400
    mockMvc
        .perform(
            put("/api/v1/calendar/events/50/tags")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
        .andExpect(status().isBadRequest());

    doThrow(new ExternalEventTagNotSupportedException())
        .when(service)
        .setEventTags(1L, 42L, List.of(1L));
    mockMvc
        .perform(
            put("/api/v1/calendar/events/42/tags")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"tagIds\":[1]}"))
        .andExpect(status().isConflict());
  }
}
