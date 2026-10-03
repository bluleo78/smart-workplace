package com.workplace.issue.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
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
import com.workplace.issue.dto.IssueBodyImageResponse;
import com.workplace.issue.exception.IssueBodyImageRejectedException;
import com.workplace.issue.service.IssueAttachmentStorage;
import com.workplace.issue.service.IssueBodyImageService;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * IssueBodyImageController @WebMvcTest(WP-199). 서비스는 Mock — 업로드 201·조회 inline 헤더·nosniff·거부 400 매핑
 * 같은 HTTP 계약만 검증한다(권한·IDOR 는 서비스 통합 테스트가 담당).
 */
@WebMvcTest(IssueBodyImageController.class)
@Import({
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  UserTokenAuthenticationFilter.class
})
class IssueBodyImageControllerTest {

  private static final byte[] PNG =
      new byte[] {
        (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 'I', 'H', 'D', 'R'
      };

  @Autowired MockMvc mockMvc;
  @MockitoBean IssueBodyImageService service;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;
  @MockitoBean MembershipRepository membershipRepository;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserApiTokenRepository userApiTokenRepository;
  @MockitoBean UserRepository userRepository;

  @TempDir Path tmp;

  @BeforeEach
  void auth() {
    // userId=1 로 인증 통과 + 업로드(issue:write)·조회(project:read) 전역 권한 부여.
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L))
        .thenReturn(Set.of("issue:write", "project:read"));
  }

  @Test
  void 업로드는_201과_조회_url을_돌려준다() throws Exception {
    when(service.upload(eq(1L), eq("WP"), any()))
        .thenReturn(
            new IssueBodyImageResponse(
                7L, IssueBodyImageResponse.urlOf("WP", 7L), "a.png", "image/png", 16L));

    mockMvc
        .perform(
            multipart("/api/v1/projects/WP/issue-images")
                .file(new MockMultipartFile("file", "a.png", "image/png", PNG))
                .header("Authorization", "Bearer v"))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.url").value("/api/v1/projects/WP/issue-images/7"));
  }

  @Test
  void 조회는_inline_이미지와_nosniff를_내려준다() throws Exception {
    Path file = Files.write(tmp.resolve("a.png"), PNG);
    when(service.load(1L, "WP", 7L))
        .thenReturn(new IssueAttachmentStorage.StoredFile(file, "image/png", "a.png", PNG.length));

    mockMvc
        .perform(get("/api/v1/projects/WP/issue-images/7").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(content().contentType("image/png"))
        .andExpect(
            header().string("Content-Disposition", org.hamcrest.Matchers.startsWith("inline")))
        .andExpect(header().string("X-Content-Type-Options", "nosniff"));
  }

  @Test
  void 이미지가_아닌_업로드는_400() throws Exception {
    when(service.upload(eq(1L), eq("WP"), any()))
        .thenThrow(new IssueBodyImageRejectedException("PNG·JPEG·GIF·WebP 이미지만 올릴 수 있습니다."));

    mockMvc
        .perform(
            multipart("/api/v1/projects/WP/issue-images")
                .file(new MockMultipartFile("file", "x.svg", "image/svg+xml", "<svg/>".getBytes()))
                .header("Authorization", "Bearer v"))
        .andExpect(status().isBadRequest());
  }
}
