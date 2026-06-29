package com.workplace.home.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.home.service.HomeActionService;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** HomeActionController @WebMvcTest — 인증 통과 시 confirm 결과를 201 로 응답하는지 검증. */
@SuppressWarnings("null")
@WebMvcTest(HomeActionController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class HomeActionControllerTest {

  @Autowired MockMvc mockMvc;
  @MockitoBean HomeActionService actionService;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;
  @MockitoBean MembershipRepository membershipRepository;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L))
        .thenReturn(Set.of("calendar:read", "calendar:write"));
  }

  @Test
  void confirm_정상_201_반환() throws Exception {
    OffsetDateTime s = OffsetDateTime.parse("2026-06-26T01:00:00Z");
    CalendarEventResponse created =
        new CalendarEventResponse(
            7L,
            "팀 미팅",
            null,
            s,
            s.plusHours(1),
            false,
            null,
            null,
            null,
            null,
            "blue",
            null,
            null,
            null,
            null,
            s,
            s,
            0,
            null,
            null,
            false,
            null);
    when(actionService.confirm(eq(1L), eq("calendar.create_event"), any(JsonNode.class)))
        .thenReturn(created);

    mockMvc
        .perform(
            post("/api/v1/home/actions/confirm")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"actionType\":\"calendar.create_event\",\"params\":{\"title\":\"팀 미팅\"}}"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.title").value("팀 미팅"));
  }
}
