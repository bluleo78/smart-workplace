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
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.security.UserTokenAuthenticationFilter;
import com.workplace.permission.service.PermissionService;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.MemberResponse;
import com.workplace.project.dto.UpdateMemberRoleRequest;
import com.workplace.project.exception.ProjectConflictException;
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

/** ProjectMemberController @WebMvcTest. */
@SuppressWarnings("null")
@WebMvcTest(ProjectMemberController.class)
@Import({
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  UserTokenAuthenticationFilter.class
})
class ProjectMemberControllerTest {

  @Autowired private MockMvc mockMvc;
  @Autowired private ObjectMapper objectMapper;

  @MockitoBean private ProjectService projectService;
  @MockitoBean private JwtTokenProvider jwtTokenProvider;
  @MockitoBean private JwtProperties jwtProperties;
  @MockitoBean private PermissionService permissionService;

  @MockitoBean private MembershipRepository membershipRepository;

  @MockitoBean private AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean private UserApiTokenRepository userApiTokenRepository;

  @MockitoBean private UserRepository userRepository;

  private void mockAuthentication(String... permissions) {
    when(jwtTokenProvider.validateAccessToken("valid-token")).thenReturn(true);
    when(jwtTokenProvider.getUserIdFromToken("valid-token")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of(permissions));
  }

  private MemberResponse sampleMember(Long userId, String role) {
    return new MemberResponse(
        userId, "user" + userId, "User " + userId, "HUMAN", role, Instant.now(), true);
  }

  @Test
  void list_happyPath_returns200WithMembers() throws Exception {
    mockAuthentication("project:read");
    when(projectService.listMembers(1L, "WP"))
        .thenReturn(List.of(sampleMember(1L, "OWNER"), sampleMember(2L, "MEMBER")));

    mockMvc
        .perform(get("/api/v1/projects/WP/members").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].role").value("OWNER"))
        .andExpect(jsonPath("$[1].userId").value(2));
  }

  @Test
  void add_byOwner_returns200() throws Exception {
    mockAuthentication("project:manage");
    when(projectService.addMember(eq(1L), eq("WP"), any())).thenReturn(sampleMember(2L, "MEMBER"));

    mockMvc
        .perform(
            post("/api/v1/projects/WP/members")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(new AddMemberRequest(2L, "MEMBER"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.userId").value(2));
  }

  @Test
  void add_duplicateMember_returns409() throws Exception {
    mockAuthentication("project:manage");
    when(projectService.addMember(eq(1L), eq("WP"), any()))
        .thenThrow(new ProjectConflictException("이미 멤버입니다"));

    mockMvc
        .perform(
            post("/api/v1/projects/WP/members")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(new AddMemberRequest(2L, "MEMBER"))))
        .andExpect(status().isConflict());
  }

  @Test
  void updateRole_lastOwnerDemotion_returns409() throws Exception {
    mockAuthentication("project:manage");
    doThrow(new ProjectConflictException("OWNER 최소 1명"))
        .when(projectService)
        .updateMemberRole(eq(1L), eq("WP"), eq(1L), any());

    mockMvc
        .perform(
            patch("/api/v1/projects/WP/members/1")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(new UpdateMemberRoleRequest("MEMBER"))))
        .andExpect(status().isConflict());
  }

  @Test
  void remove_lastOwner_returns409() throws Exception {
    mockAuthentication("project:manage");
    doThrow(new ProjectConflictException("OWNER 최소 1명"))
        .when(projectService)
        .removeMember(1L, "WP", 1L);

    mockMvc
        .perform(
            delete("/api/v1/projects/WP/members/1").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isConflict());
  }

  @Test
  void remove_byNonOwner_returns403() throws Exception {
    // manage 권한 없음 → 인터셉터에서 403
    mockAuthentication("project:read");

    mockMvc
        .perform(
            delete("/api/v1/projects/WP/members/2").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isForbidden());

    verify(projectService, org.mockito.Mockito.never()).removeMember(any(), any(), any());
  }
}
