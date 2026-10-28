package com.workplace.role.controller;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.dto.PermissionResponse;
import com.workplace.permission.service.PermissionService;
import com.workplace.role.dto.*;
import com.workplace.role.service.RoleService;
import com.workplace.support.PermissionMocks;
import com.workplace.support.WebMvcSliceTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SuppressWarnings("null")
class RoleControllerTest extends WebMvcSliceTestBase {

  @Autowired private MockMvc mockMvc;

  @Autowired private ObjectMapper objectMapper;

  @Autowired private RoleService roleService;

  @Autowired private JwtTokenProvider jwtTokenProvider;

  @Autowired private JwtProperties jwtProperties;

  @Autowired private PermissionService permissionService;

  /** WP-420: JWT tenant 경로가 기존 getUserPermissions 스텁을 따르게 한다(PermissionMocks 참고). */
  @BeforeEach
  void mirrorActiveMemberPermissions() {
    PermissionMocks.mirrorActiveMember(permissionService);
  }

  @Autowired private MembershipRepository membershipRepository;

  @Autowired private AgentApiKeyRepository agentApiKeyRepository;
  @Autowired private UserApiTokenRepository userApiTokenRepository;

  @Autowired private UserRepository userRepository;

  private void mockAuthentication(String... permissions) {
    when(jwtTokenProvider.validateAccessToken("valid-token")).thenReturn(true);
    when(jwtTokenProvider.getUserIdFromToken("valid-token")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of(permissions));
  }

  @Test
  void getRoles_withPermission_returnsList() throws Exception {
    mockAuthentication("role:read");
    List<RoleResponse> roles =
        List.of(
            new RoleResponse(1L, "ADMIN", "Administrator", true),
            new RoleResponse(2L, "USER", "Regular user", true));
    when(roleService.getAllRoles()).thenReturn(roles);

    mockMvc
        .perform(get("/api/v1/roles").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].name").value("ADMIN"))
        .andExpect(jsonPath("$[1].name").value("USER"));
  }

  @Test
  void getRoleById_withPermission_returnsRole() throws Exception {
    mockAuthentication("role:read");
    RoleDetailResponse detail =
        new RoleDetailResponse(
            1L,
            "ADMIN",
            "Administrator",
            true,
            List.of(new PermissionResponse(1L, "user:read", "Read users", "user")));
    when(roleService.getRoleById(1L)).thenReturn(detail);

    mockMvc
        .perform(get("/api/v1/roles/1").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("ADMIN"))
        .andExpect(jsonPath("$.permissions[0].code").value("user:read"));
  }

  @Test
  void createRole_withPermission_returnsCreated() throws Exception {
    mockAuthentication("role:write");
    CreateRoleRequest request = new CreateRoleRequest("MODERATOR", "Moderator role");
    RoleResponse created = new RoleResponse(3L, "MODERATOR", "Moderator role", false);
    when(roleService.createRole("MODERATOR", "Moderator role", 1L)).thenReturn(created);

    mockMvc
        .perform(
            post("/api/v1/roles")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.name").value("MODERATOR"));
  }

  @Test
  void updateRole_withPermission_returnsOk() throws Exception {
    mockAuthentication("role:write");
    UpdateRoleRequest request = new UpdateRoleRequest("MOD", "Updated moderator");

    mockMvc
        .perform(
            put("/api/v1/roles/3")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isNoContent());

    verify(roleService).updateRole(3L, "MOD", "Updated moderator", 1L);
  }

  @Test
  void updateRole_invalidNameOrLongDescription_returns400() throws Exception {
    // WP-570: 생성에만 있던 이름 규칙이 수정에도 적용되고, 설명은 DB(VARCHAR(255)) 상한에서 한국어로 막는다.
    mockAuthentication("role:write");

    mockMvc
        .perform(
            put("/api/v1/roles/3")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"qa 담당 역할!!\",\"description\":\"x\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.name").value("역할 이름은 대문자, 숫자, 밑줄만 허용됩니다"));
    mockMvc
        .perform(
            put("/api/v1/roles/3")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"MOD\",\"description\":\"" + "x".repeat(256) + "\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.description").value("역할 설명은 255자까지 쓸 수 있습니다"));
    mockMvc
        .perform(
            post("/api/v1/roles")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"MOD\",\"description\":\"" + "x".repeat(256) + "\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.description").value("역할 설명은 255자까지 쓸 수 있습니다"));

    org.mockito.Mockito.verifyNoInteractions(roleService);
  }

  @Test
  void deleteRole_withPermission_returnsNoContent() throws Exception {
    mockAuthentication("role:delete");

    mockMvc
        .perform(delete("/api/v1/roles/3").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isNoContent());

    verify(roleService).deleteRole(3L, 1L);
  }

  @Test
  void setPermissions_withPermission_returnsNoContent() throws Exception {
    mockAuthentication("role:write");
    SetPermissionsRequest request = new SetPermissionsRequest(List.of(1L, 2L, 3L));

    mockMvc
        .perform(
            put("/api/v1/roles/1/permissions")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isNoContent());

    verify(roleService).setRolePermissions(1L, List.of(1L, 2L, 3L), 1L);
  }

  @Test
  void getRoles_unauthenticated_returnsUnauthorized() throws Exception {
    mockMvc.perform(get("/api/v1/roles")).andExpect(status().isUnauthorized());
  }
}
