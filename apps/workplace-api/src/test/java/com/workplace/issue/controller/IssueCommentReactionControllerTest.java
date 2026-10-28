package com.workplace.issue.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.dto.CommentReactorPage;
import com.workplace.issue.dto.CommentReactorResponse;
import com.workplace.issue.service.IssueCommentReactionService;
import com.workplace.permission.service.PermissionService;
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

/** IssueCommentReactionController @WebMvcTest(WP-504) — 3 엔드포인트의 경로·상태코드·권한·emoji 검증. */
@SuppressWarnings("null")
class IssueCommentReactionControllerTest extends WebMvcSliceTestBase {

  private static final String BASE = "/api/v1/issues/100/comments/50/reactions";

  @Autowired private MockMvc mockMvc;

  @Autowired private IssueCommentReactionService reactionService;
  @Autowired private JwtTokenProvider jwtTokenProvider;
  @Autowired private JwtProperties jwtProperties;
  @Autowired private PermissionService permissionService;
  @Autowired private MembershipRepository membershipRepository;
  @Autowired private AgentApiKeyRepository agentApiKeyRepository;
  @Autowired private UserApiTokenRepository userApiTokenRepository;
  @Autowired private UserRepository userRepository;

  /** WP-420: JWT tenant 경로가 기존 getUserPermissions 스텁을 따르게 한다(PermissionMocks 참고). */
  @BeforeEach
  void mirrorActiveMemberPermissions() {
    PermissionMocks.mirrorActiveMember(permissionService);
  }

  /** valid-token 인증 + 주어진 권한 부여. */
  private void mockAuthentication(String... permissions) {
    when(jwtTokenProvider.validateAccessToken("valid-token")).thenReturn(true);
    when(jwtTokenProvider.getUserIdFromToken("valid-token")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of(permissions));
  }

  /** 반응 추가 — body emoji 로 서비스 호출 후 204. */
  @Test
  void add_returns204() throws Exception {
    mockAuthentication("issue:write");

    mockMvc
        .perform(
            post(BASE)
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"emoji\":\"👍\"}"))
        .andExpect(status().isNoContent());

    verify(reactionService).add(1L, 100L, 50L, "👍");
  }

  /** 빈 emoji·32자 초과 emoji 는 서비스에 닿기 전에 400. */
  @Test
  void add_blankOrTooLongEmoji_returns400() throws Exception {
    mockAuthentication("issue:write");

    for (String body : List.of("{\"emoji\":\"\"}", "{\"emoji\":\"" + "a".repeat(33) + "\"}")) {
      mockMvc
          .perform(
              post(BASE)
                  .header("Authorization", "Bearer valid-token")
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(body))
          .andExpect(status().isBadRequest());
    }
    verify(reactionService, never()).add(anyLong(), anyLong(), anyLong(), anyString());
  }

  /** issue:write 권한이 없으면 추가 403. */
  @Test
  void add_withoutWritePermission_returns403() throws Exception {
    mockAuthentication("project:read");

    mockMvc
        .perform(
            post(BASE)
                .header("Authorization", "Bearer valid-token")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"emoji\":\"👍\"}"))
        .andExpect(status().isForbidden());
  }

  /** 반응 취소 — query emoji 로 서비스 호출 후 204. */
  @Test
  void remove_returns204() throws Exception {
    mockAuthentication("issue:write");

    mockMvc
        .perform(delete(BASE).param("emoji", "👍").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isNoContent());

    verify(reactionService).remove(1L, 100L, 50L, "👍");
  }

  /** 반응자 조회 — 기본 limit 20 으로 페이지를 돌려준다. */
  @Test
  void listReactors_returns200WithPage() throws Exception {
    mockAuthentication("project:read");
    when(reactionService.listReactors(1L, 100L, 50L, "👍", null, 20))
        .thenReturn(
            new CommentReactorPage(
                List.of(new CommentReactorResponse(7L, "앨리스", "HUMAN")), "next", true));

    mockMvc
        .perform(
            get(BASE + "/users").param("emoji", "👍").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].userId").value(7))
        .andExpect(jsonPath("$.items[0].name").value("앨리스"))
        .andExpect(jsonPath("$.items[0].kind").value("HUMAN"))
        .andExpect(jsonPath("$.nextCursor").value("next"))
        .andExpect(jsonPath("$.hasMore").value(true));
  }

  /** 반응자 조회 emoji 누락·빈값·32자 초과는 400. */
  @Test
  void listReactors_badEmoji_returns400() throws Exception {
    mockAuthentication("project:read");

    mockMvc
        .perform(get(BASE + "/users").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isBadRequest());
    mockMvc
        .perform(
            get(BASE + "/users").param("emoji", " ").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isBadRequest());
    mockMvc
        .perform(
            get(BASE + "/users")
                .param("emoji", "a".repeat(33))
                .header("Authorization", "Bearer valid-token"))
        .andExpect(status().isBadRequest());
    verify(reactionService, never())
        .listReactors(anyLong(), anyLong(), anyLong(), any(), any(), anyInt());
  }
}
