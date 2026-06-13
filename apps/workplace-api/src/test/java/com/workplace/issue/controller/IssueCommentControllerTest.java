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
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.IssueCommentResponse;
import com.workplace.issue.dto.UpdateCommentRequest;
import com.workplace.issue.service.IssueCommentService;
import com.workplace.permission.service.PermissionService;
import com.workplace.project.exception.ProjectAccessDeniedException;
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

/** IssueCommentController @WebMvcTest. */
@SuppressWarnings("null")
@WebMvcTest(IssueCommentController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class IssueCommentControllerTest {

  @Autowired private MockMvc mockMvc;
  @Autowired private ObjectMapper objectMapper;

  @MockitoBean private IssueCommentService commentService;
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

  private IssueCommentResponse sampleComment() {
    return new IssueCommentResponse(
        50L, 100L, 1L, "me", "HUMAN", "hello", Instant.now(), Instant.now());
  }

  @Test
  void list_includesAuthorKindAgent() throws Exception {
    mockAuthentication("project:read");
    IssueCommentResponse agentComment =
        new IssueCommentResponse(
            51L, 100L, 9L, "ai-bot", "AGENT", "응답입니다", Instant.now(), Instant.now());
    when(commentService.list(1L, 100L)).thenReturn(List.of(agentComment));

    mockMvc
        .perform(get("/api/v1/issues/100/comments").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].authorKind").value("AGENT"))
        .andExpect(jsonPath("$[0].authorName").value("ai-bot"));
  }

  @Test
  void list_happyPath_returns200WithComments() throws Exception {
    mockAuthentication("project:read");
    when(commentService.list(1L, 100L)).thenReturn(List.of(sampleComment()));

    mockMvc
        .perform(get("/api/v1/issues/100/comments").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].body").value("hello"));
  }

  @Test
  void create_happyPath_returns200() throws Exception {
    mockAuthentication("issue:write");
    when(commentService.create(eq(1L), eq(100L), any())).thenReturn(sampleComment());

    mockMvc
        .perform(
            post("/api/v1/issues/100/comments")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(new CreateCommentRequest("hello"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.body").value("hello"));
  }

  @Test
  void create_blankBody_returns400() throws Exception {
    mockAuthentication("issue:write");

    mockMvc
        .perform(
            post("/api/v1/issues/100/comments")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(new CreateCommentRequest(""))))
        .andExpect(status().isBadRequest());
  }

  @Test
  void update_byNonAuthor_returns403() throws Exception {
    mockAuthentication("issue:write");
    when(commentService.update(eq(1L), eq(100L), eq(50L), any()))
        .thenThrow(new ProjectAccessDeniedException("본인 작성 코멘트만 수정할 수 있습니다"));

    mockMvc
        .perform(
            patch("/api/v1/issues/100/comments/50")
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(new UpdateCommentRequest("edited"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void delete_byAuthor_returns204() throws Exception {
    mockAuthentication("issue:write");

    mockMvc
        .perform(
            delete("/api/v1/issues/100/comments/50").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isNoContent());

    verify(commentService).delete(1L, 100L, 50L);
  }

  @Test
  void delete_byOther_returns403() throws Exception {
    mockAuthentication("issue:write");
    doThrow(new ProjectAccessDeniedException("코멘트 삭제 권한이 없습니다"))
        .when(commentService)
        .delete(1L, 100L, 50L);

    mockMvc
        .perform(
            delete("/api/v1/issues/100/comments/50").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isForbidden());
  }
}
