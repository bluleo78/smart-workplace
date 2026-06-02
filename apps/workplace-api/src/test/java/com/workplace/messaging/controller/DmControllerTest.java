package com.workplace.messaging.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.messaging.dto.CreateDmRequest;
import com.workplace.messaging.dto.DmParticipant;
import com.workplace.messaging.dto.DmResponse;
import com.workplace.messaging.exception.InvalidDmRequestException;
import com.workplace.messaging.service.DmService;
import com.workplace.permission.service.PermissionService;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
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

/** DM 컨트롤러 라우팅·상태코드 매핑 테스트. 서비스는 Mockito. */
@SuppressWarnings("null")
@WebMvcTest(controllers = DmController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class DmControllerTest {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper om;

  @MockitoBean DmService dmService;
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

  private DmResponse sampleDm() {
    return new DmResponse(
        7L,
        List.of(new DmParticipant(1L, "나", "HUMAN"), new DmParticipant(2L, "밥", "HUMAN")),
        null,
        Instant.parse("2026-06-01T00:00:00Z"));
  }

  @Test
  void list_returns200() throws Exception {
    when(dmService.listMyDms(1L)).thenReturn(List.of(sampleDm()));
    mockMvc
        .perform(get("/api/v1/messaging/dms").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].id").value(7))
        .andExpect(jsonPath("$[0].participants[1].name").value("밥"));
  }

  @Test
  void create_new_returns201() throws Exception {
    when(dmService.createOrGet(eq(1L), any())).thenReturn(new DmService.DmResult(sampleDm(), true));
    mockMvc
        .perform(
            post("/api/v1/messaging/dms")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(new CreateDmRequest(List.of(2L)))))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.id").value(7));
  }

  @Test
  void create_existing_returns200() throws Exception {
    when(dmService.createOrGet(eq(1L), any()))
        .thenReturn(new DmService.DmResult(sampleDm(), false));
    mockMvc
        .perform(
            post("/api/v1/messaging/dms")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(new CreateDmRequest(List.of(2L)))))
        .andExpect(status().isOk());
  }

  @Test
  void create_invalid_returns400() throws Exception {
    when(dmService.createOrGet(eq(1L), any()))
        .thenThrow(new InvalidDmRequestException("자기 자신과는 DM 할 수 없습니다"));
    mockMvc
        .perform(
            post("/api/v1/messaging/dms")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(new CreateDmRequest(List.of(1L)))))
        .andExpect(status().isBadRequest());
  }

  @Test
  void create_emptyUserIds_returns400() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/messaging/dms")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"userIds\":[]}"))
        .andExpect(status().isBadRequest()); // @NotEmpty
  }
}
