package com.workplace.wiki.controller;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.security.UserTokenAuthenticationFilter;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiBacklink;
import com.workplace.wiki.dto.WikiBacklinksResponse;
import com.workplace.wiki.dto.WikiMentionRef;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.exception.WikiConflictException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.service.WikiHydrationService;
import com.workplace.wiki.service.WikiPageService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** WikiPageController WebMvcTest — 낙관적 충돌 HTTP 계약(stale 저장 → 409). */
@SuppressWarnings("null")
@WebMvcTest(WikiPageController.class)
@Import({
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  UserTokenAuthenticationFilter.class
})
class WikiPageControllerTest {

  @Autowired private MockMvc mockMvc;

  @MockitoBean private WikiPageService pageService;
  @MockitoBean private WikiHydrationService hydrationService;
  @MockitoBean private JwtTokenProvider jwtTokenProvider;
  @MockitoBean private JwtProperties jwtProperties;
  @MockitoBean private PermissionService permissionService;

  @MockitoBean private MembershipRepository membershipRepository;
  @MockitoBean private AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean private UserApiTokenRepository userApiTokenRepository;
  @MockitoBean private UserRepository userRepository;

  @BeforeEach
  void setUp() {
    when(jwtTokenProvider.validateAccessToken("test-token")).thenReturn(true);
    when(jwtTokenProvider.getUserIdFromToken("test-token")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of());
  }

  /** stale 버전 저장 → WikiConflictException → 409. */
  @Test
  void save_staleVersion_returns409() throws Exception {
    when(pageService.save(
            anyLong(), anyLong(), org.mockito.ArgumentMatchers.any(SavePageRequest.class)))
        .thenThrow(new WikiConflictException(7L));

    mockMvc
        .perform(
            put("/api/v1/wiki/pages/7")
                .header("Authorization", "Bearer test-token")
                .contentType("application/json")
                .content("{\"title\":\"t\",\"body\":\"b\",\"version\":1,\"snapshot\":false}"))
        .andExpect(status().isConflict());
  }

  /** mentions: VIEWER 가드 통과 후 하이드레이션 결과를 200 으로 반환. */
  @Test
  void mentions_returns200WithRefs() throws Exception {
    when(pageService.get(eq(1L), eq(7L)))
        .thenReturn(
            new WikiPageDetail(7L, 3L, null, "제목", "<#page:9>", 1, 1L, OffsetDateTime.now()));
    when(hydrationService.resolveMentions(eq(1L), eq("<#page:9>")))
        .thenReturn(List.of(new WikiMentionRef("PAGE", 9L, "참조페이지", 3L, null, null)));

    mockMvc
        .perform(get("/api/v1/wiki/pages/7/mentions").header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].type").value("PAGE"))
        .andExpect(jsonPath("$[0].id").value(9))
        .andExpect(jsonPath("$[0].label").value("참조페이지"))
        .andExpect(jsonPath("$[0].spaceId").value(3));
  }

  /** backlinks: VIEWER 가드 통과 후 백링크 목록을 200 으로 반환. */
  @Test
  void backlinks_returns200WithItems() throws Exception {
    when(pageService.get(eq(1L), eq(7L)))
        .thenReturn(new WikiPageDetail(7L, 3L, null, "제목", "본문", 1, 1L, OffsetDateTime.now()));
    when(hydrationService.backlinks(eq(1L), eq(7L)))
        .thenReturn(
            new WikiBacklinksResponse(
                List.of(new WikiBacklink(11L, 3L, "공간", "소스", OffsetDateTime.now()))));

    mockMvc
        .perform(get("/api/v1/wiki/pages/7/backlinks").header("Authorization", "Bearer test-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].pageId").value(11))
        .andExpect(jsonPath("$.items[0].title").value("소스"));
  }

  /** 비멤버(VIEWER 가드 실패) → get() 이 NotFound → mentions 도 404(존재 은닉). */
  @Test
  void mentions_nonMember_returns404() throws Exception {
    when(pageService.get(eq(1L), eq(7L))).thenThrow(new WikiPageNotFoundException(7L));

    mockMvc
        .perform(get("/api/v1/wiki/pages/7/mentions").header("Authorization", "Bearer test-token"))
        .andExpect(status().isNotFound());
  }

  /** 비멤버(VIEWER 가드 실패) → get() 이 NotFound → backlinks 도 404(존재 은닉). */
  @Test
  void backlinks_nonMember_returns404() throws Exception {
    when(pageService.get(eq(1L), eq(7L))).thenThrow(new WikiPageNotFoundException(7L));

    mockMvc
        .perform(get("/api/v1/wiki/pages/7/backlinks").header("Authorization", "Bearer test-token"))
        .andExpect(status().isNotFound());
  }
}
