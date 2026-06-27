package com.workplace.calendar.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.calendar.dto.CalendarRequest;
import com.workplace.calendar.dto.CalendarResponse;
import com.workplace.calendar.exception.DefaultCalendarDeletionException;
import com.workplace.calendar.service.CalendarService;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
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

/** CalendarController 라우팅·인증 테스트. 서비스는 Mockito. */
@SuppressWarnings("null")
@WebMvcTest(controllers = CalendarController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class CalendarControllerTest {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper objectMapper;

  @MockitoBean CalendarService service;
  @MockitoBean SseRegistry registry;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;
  @MockitoBean MembershipRepository membershipRepository;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserRepository userRepository;

  private CalendarResponse sample() {
    return new CalendarResponse(1L, "기본", "blue", true, 0);
  }

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L))
        .thenReturn(Set.of("calendar:read", "calendar:write"));
  }

  @Test
  void list_returns200_with_default_calendar() throws Exception {
    when(service.list(1L)).thenReturn(List.of(sample()));

    mockMvc
        .perform(get("/api/v1/calendars").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].isDefault").value(true))
        .andExpect(jsonPath("$[0].color").value("blue"));
  }

  @Test
  void create_valid_returns201() throws Exception {
    when(service.create(eq(1L), any())).thenReturn(new CalendarResponse(2L, "업무", "red", false, 1));

    CalendarRequest req = new CalendarRequest("업무", "red", null);

    mockMvc
        .perform(
            post("/api/v1/calendars")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.name").value("업무"))
        .andExpect(jsonPath("$.color").value("red"));
  }

  @Test
  void delete_default_returns400() throws Exception {
    doThrow(new DefaultCalendarDeletionException()).when(service).delete(1L, 1L);

    mockMvc
        .perform(delete("/api/v1/calendars/1").header("Authorization", "Bearer v"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void list_unauthenticated_returns401() throws Exception {
    mockMvc.perform(get("/api/v1/calendars")).andExpect(status().isUnauthorized());
  }
}
