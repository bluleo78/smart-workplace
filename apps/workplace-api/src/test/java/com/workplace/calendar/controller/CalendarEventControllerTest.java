package com.workplace.calendar.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.user.repository.UserRepository;
import java.time.OffsetDateTime;
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

/** CalendarEventController 라우팅·페이로드·인증 테스트. 서비스는 Mockito. */
@SuppressWarnings("null")
@WebMvcTest(controllers = CalendarEventController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class CalendarEventControllerTest {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper objectMapper;

  @MockitoBean CalendarEventService service;
  @MockitoBean SseRegistry registry;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserRepository userRepository;

  private static final OffsetDateTime STARTS = OffsetDateTime.parse("2026-06-10T09:00:00Z");
  private static final OffsetDateTime ENDS = OffsetDateTime.parse("2026-06-10T10:00:00Z");

  /** 샘플 응답 — create/list 에서 재사용. */
  private CalendarEventResponse sample() {
    return new CalendarEventResponse(
        1L, "회의", null, STARTS, ENDS, false, null, null, null, STARTS, ENDS);
  }

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L))
        .thenReturn(Set.of("calendar:read", "calendar:write"));
  }

  @Test
  void create_valid_returns201() throws Exception {
    when(service.create(eq(1L), any())).thenReturn(sample());

    CalendarEventRequest req =
        new CalendarEventRequest("회의", null, STARTS, ENDS, false, null, null, null);

    mockMvc
        .perform(
            post("/api/v1/calendar/events")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.title").value("회의"));
  }

  @Test
  void create_endsBeforeStarts_returns400() throws Exception {
    // endsAt 이 startsAt 보다 앞 → @AssertTrue isValidRange 위반 → 400
    CalendarEventRequest req =
        new CalendarEventRequest("회의", null, ENDS, STARTS, false, null, null, null);

    mockMvc
        .perform(
            post("/api/v1/calendar/events")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void list_returnsEvents() throws Exception {
    when(service.list(eq(1L), any(), any())).thenReturn(List.of(sample()));

    mockMvc
        .perform(
            get("/api/v1/calendar/events")
                .header("Authorization", "Bearer v")
                .param("from", "2026-06-10T00:00:00Z")
                .param("to", "2026-06-11T00:00:00Z"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].id").value(1));
  }

  @Test
  void create_unauthenticated_returns401() throws Exception {
    CalendarEventRequest req =
        new CalendarEventRequest("회의", null, STARTS, ENDS, false, null, null, null);

    mockMvc
        .perform(
            post("/api/v1/calendar/events")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isUnauthorized());
  }
}
