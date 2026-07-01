package com.workplace.project.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.dto.PageResponse;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.dto.UpdateProjectRequest;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.exception.ProjectConflictException;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.service.ProjectService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** ProjectController @WebMvcTest. JWT/Permission 은 mock. */
@SuppressWarnings("null")
@WebMvcTest(ProjectController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class ProjectControllerTest {

  @Autowired private MockMvc mockMvc;
  @Autowired private ObjectMapper objectMapper;

  @MockitoBean private ProjectService projectService;
  @MockitoBean private JwtTokenProvider jwtTokenProvider;
  @MockitoBean private JwtProperties jwtProperties;
  @MockitoBean private PermissionService permissionService;

  @MockitoBean private MembershipRepository membershipRepository;

  @MockitoBean private AgentApiKeyRepository agentApiKeyRepository;

  @MockitoBean private UserRepository userRepository;

  /** valid-token 인증 + 주어진 권한 부여. */
  private void mockAuthentication(String... permissions) {
    when(jwtTokenProvider.validateAccessToken("valid-token")).thenReturn(true);
    when(jwtTokenProvider.getUserIdFromToken("valid-token")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of(permissions));
  }

  private ProjectResponse sampleProject() {
    return new ProjectResponse(
        10L,
        "WP",
        "Workplace",
        "v1",
        1L,
        "TEAM",
        false,
        Instant.now(),
        Instant.now(),
        0,
        0,
        0,
        java.util.List.of(),
        true);
  }

  @Test
  void create_happyPath_returns200() throws Exception {
    mockAuthentication("project:write");
    when(projectService.create(eq(1L), any())).thenReturn(sampleProject());

    mockMvc
        .perform(
            post("/api/v1/projects")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    objectMapper.writeValueAsString(
                        new CreateProjectRequest("WP", "Workplace", "v1"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.key").value("WP"));
  }

  @Test
  void create_personalWithoutKey_passesValidation_returns200() throws Exception {
    // PERSONAL 은 key 생략 가능 — @Valid 레이어가 400 으로 막지 않고 서비스까지 도달해야 한다.
    mockAuthentication("project:write");
    ProjectResponse personal =
        new ProjectResponse(
            11L,
            "P-1",
            "개인 작업",
            null,
            1L,
            "PERSONAL",
            false,
            Instant.now(),
            Instant.now(),
            0,
            0,
            0,
            java.util.List.of(),
            true);
    when(projectService.create(eq(1L), any())).thenReturn(personal);

    mockMvc
        .perform(
            post("/api/v1/projects")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    objectMapper.writeValueAsString(
                        new CreateProjectRequest(null, "개인 작업", null, "PERSONAL"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.type").value("PERSONAL"));
  }

  @Test
  void create_invalidKeyPattern_returns400() throws Exception {
    // 소문자 key 는 패턴 위반 → Bean Validation 400
    mockAuthentication("project:write");

    mockMvc
        .perform(
            post("/api/v1/projects")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    objectMapper.writeValueAsString(
                        new CreateProjectRequest("wp", "Workplace", "v1"))))
        .andExpect(status().isBadRequest());
  }

  @Test
  void create_duplicateKey_returns409() throws Exception {
    mockAuthentication("project:write");
    when(projectService.create(eq(1L), any()))
        .thenThrow(new ProjectConflictException("이미 사용 중인 key"));

    mockMvc
        .perform(
            post("/api/v1/projects")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    objectMapper.writeValueAsString(
                        new CreateProjectRequest("WP", "Workplace", "v1"))))
        .andExpect(status().isConflict());
  }

  @Test
  void list_happyPath_returns200() throws Exception {
    mockAuthentication("project:read");
    PageResponse<ProjectResponse> page = new PageResponse<>(List.of(sampleProject()), 0, 20, 1, 1);
    when(projectService.list(1L, 0, 20)).thenReturn(page);

    mockMvc
        .perform(get("/api/v1/projects").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content[0].key").value("WP"))
        .andExpect(jsonPath("$.totalElements").value(1));
  }

  @Test
  void get_existingProject_returns200() throws Exception {
    mockAuthentication("project:read");
    when(projectService.get(1L, "WP")).thenReturn(sampleProject());

    mockMvc
        .perform(get("/api/v1/projects/WP").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.key").value("WP"));
  }

  @Test
  void get_unknownKey_returns404() throws Exception {
    mockAuthentication("project:read");
    when(projectService.get(1L, "XX")).thenThrow(new ProjectNotFoundException("XX"));

    mockMvc
        .perform(get("/api/v1/projects/XX").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isNotFound());
  }

  @Test
  void get_notMember_returns403() throws Exception {
    mockAuthentication("project:read");
    when(projectService.get(1L, "WP")).thenThrow(new ProjectAccessDeniedException("멤버 아님"));

    mockMvc
        .perform(get("/api/v1/projects/WP").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isForbidden());
  }

  @Test
  void update_happyPath_returns200() throws Exception {
    mockAuthentication("project:write");
    when(projectService.update(eq(1L), eq("WP"), any())).thenReturn(sampleProject());

    mockMvc
        .perform(
            patch("/api/v1/projects/WP")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    objectMapper.writeValueAsString(new UpdateProjectRequest("Updated", "new"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.key").value("WP"));
  }

  @Test
  void delete_owner_returns204() throws Exception {
    mockAuthentication("project:manage");

    mockMvc
        .perform(delete("/api/v1/projects/WP").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isNoContent());

    verify(projectService).softDelete(1L, "WP");
  }

  @Test
  void delete_withoutManagePermission_returns403() throws Exception {
    // manage 권한 없음 → @RequirePermission 차단
    mockAuthentication("project:read");
    // 서비스가 호출되지 않도록 사전에 throw 시켜도 됨 — but interceptor 가 먼저 차단해야 한다
    doThrow(new IllegalStateException("should not be called"))
        .when(projectService)
        .softDelete(any(), any());

    mockMvc
        .perform(delete("/api/v1/projects/WP").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isForbidden());
  }
}
