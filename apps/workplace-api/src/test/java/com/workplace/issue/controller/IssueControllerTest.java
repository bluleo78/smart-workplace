package com.workplace.issue.controller;

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
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueDetailResponse;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueSearchResponse;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.service.IssueSearchService;
import com.workplace.issue.service.IssueService;
import com.workplace.permission.service.PermissionService;
import com.workplace.project.exception.ProjectAccessDeniedException;
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

/** IssueController @WebMvcTest. JWT/Permission/Service 모두 mock. */
@SuppressWarnings("null")
@WebMvcTest(IssueController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class})
class IssueControllerTest {

  @Autowired private MockMvc mockMvc;
  @Autowired private ObjectMapper objectMapper;

  @MockitoBean private IssueService issueService;
  @MockitoBean private IssueSearchService issueSearchService;
  @MockitoBean private JwtTokenProvider jwtTokenProvider;
  @MockitoBean private JwtProperties jwtProperties;
  @MockitoBean private PermissionService permissionService;

  /** valid-token 인증 + 주어진 권한 부여. */
  private void mockAuthentication(String... permissions) {
    when(jwtTokenProvider.validateAccessToken("valid-token")).thenReturn(true);
    when(jwtTokenProvider.getUserIdFromToken("valid-token")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of(permissions));
  }

  private IssueResponse sampleIssue() {
    return new IssueResponse(
        100L,
        "WP",
        1,
        "title",
        "TODO",
        "MID",
        null,
        1L,
        Instant.now(),
        Instant.now(),
        List.of(),
        0,
        List.of());
  }

  private IssueDetailResponse sampleDetail() {
    return new IssueDetailResponse(sampleIssue(), "body", List.of(), List.of(), List.of());
  }

  @Test
  void list_happyPath_returnsSearchResponse() throws Exception {
    // Phase 2: list 엔드포인트는 IssueSearchService 를 통한 cursor 페이징 응답을 반환.
    mockAuthentication("project:read");
    IssueSearchResponse resp = new IssueSearchResponse(List.of(sampleIssue()), null, false);
    when(issueSearchService.search(eq(1L), eq("WP"), any())).thenReturn(resp);

    mockMvc
        .perform(get("/api/v1/projects/WP/issues").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].title").value("title"))
        .andExpect(jsonPath("$.hasMore").value(false));
  }

  @Test
  void create_happyPath_returnsIssue() throws Exception {
    mockAuthentication("issue:write");
    when(issueService.create(eq(1L), eq("WP"), any())).thenReturn(sampleIssue());

    mockMvc
        .perform(
            post("/api/v1/projects/WP/issues")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    objectMapper.writeValueAsString(
                        new CreateIssueRequest("title", "body", "MID", null, null))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.title").value("title"));
  }

  @Test
  void create_titleBlank_returns400() throws Exception {
    mockAuthentication("issue:write");

    mockMvc
        .perform(
            post("/api/v1/projects/WP/issues")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    objectMapper.writeValueAsString(
                        new CreateIssueRequest("", "body", null, null, null))))
        .andExpect(status().isBadRequest());
  }

  @Test
  void create_invalidPriority_returns400() throws Exception {
    mockAuthentication("issue:write");

    mockMvc
        .perform(
            post("/api/v1/projects/WP/issues")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    objectMapper.writeValueAsString(
                        new CreateIssueRequest("title", "body", "FOO", null, null))))
        .andExpect(status().isBadRequest());
  }

  @Test
  void get_happyPath_returnsDetail() throws Exception {
    mockAuthentication("project:read");
    when(issueService.get(1L, "WP", 1)).thenReturn(sampleDetail());

    mockMvc
        .perform(get("/api/v1/projects/WP/issues/1").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.summary.title").value("title"));
  }

  @Test
  void patch_statusChange_returnsUpdated() throws Exception {
    mockAuthentication("issue:write");
    when(issueService.update(eq(1L), eq("WP"), eq(1), any())).thenReturn(sampleDetail());

    mockMvc
        .perform(
            patch("/api/v1/projects/WP/issues/1")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"IN_PROGRESS\"}"))
        .andExpect(status().isOk());
  }

  @Test
  void patch_invalidStatus_returns400() throws Exception {
    mockAuthentication("issue:write");

    mockMvc
        .perform(
            patch("/api/v1/projects/WP/issues/1")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    objectMapper.writeValueAsString(
                        new UpdateIssueRequest(null, null, "UNKNOWN", null, null, null))))
        .andExpect(status().isBadRequest());
  }

  @Test
  void delete_happyPath_returns204() throws Exception {
    mockAuthentication("issue:write");

    mockMvc
        .perform(
            delete("/api/v1/projects/WP/issues/1").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isNoContent());

    verify(issueService).softDelete(1L, "WP", 1);
  }

  @Test
  void delete_byNonReporterNonOwner_returns403() throws Exception {
    // reporter/OWNER 가 아닌 사용자가 이슈 삭제 시도 시 403 — 권한 가드 검증
    mockAuthentication("issue:write");
    doThrow(new ProjectAccessDeniedException("이슈 삭제는 reporter 또는 OWNER 만 가능합니다"))
        .when(issueService)
        .softDelete(eq(1L), eq("WP"), eq(1));

    mockMvc
        .perform(
            delete("/api/v1/projects/WP/issues/1").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isForbidden());
  }

  @Test
  void nonMember_returns403() throws Exception {
    mockAuthentication("project:read");
    when(issueService.get(1L, "WP", 1)).thenThrow(new ProjectAccessDeniedException("멤버 아님"));

    mockMvc
        .perform(get("/api/v1/projects/WP/issues/1").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isForbidden());
  }

  @Test
  void notFound_returns404() throws Exception {
    mockAuthentication("project:read");
    when(issueService.get(1L, "WP", 99)).thenThrow(new IssueNotFoundException("WP", 99));

    mockMvc
        .perform(get("/api/v1/projects/WP/issues/99").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isNotFound());
  }
}
