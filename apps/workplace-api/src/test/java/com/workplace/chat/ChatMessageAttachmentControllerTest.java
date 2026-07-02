package com.workplace.chat;

import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.chat.controller.ChatMessageAttachmentController;
import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.exception.InvalidChatAttachmentException;
import com.workplace.chat.repository.ChatMessageAttachmentRepository;
import com.workplace.chat.service.ChatMessageAttachmentService;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.security.UserTokenAuthenticationFilter;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * ChatMessageAttachmentController @WebMvcTest. DB·스토리지 미사용 — 서비스 Mock 으로 컨트롤러 레이어만 검증. 멤버십 거부·교차스레드
 * 차단이 올바른 HTTP 상태로 응답하는지 확인한다.
 */
@WebMvcTest(ChatMessageAttachmentController.class)
@Import({
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  UserTokenAuthenticationFilter.class
})
class ChatMessageAttachmentControllerTest {

  @Autowired MockMvc mockMvc;
  @MockitoBean ChatMessageAttachmentService service;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;
  @MockitoBean MembershipRepository membershipRepository;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserApiTokenRepository userApiTokenRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    // 테스트용 JWT 스텁 — userId=1 로 인증 통과.
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of());
  }

  /** 멤버가 멀티파트 업로드 → 200 + fileId 배열 반환. */
  @Test
  void 업로드_성공() throws Exception {
    var uploaded =
        List.of(new ChatMessageAttachmentService.UploadedFile(42L, "a.txt", "text/plain", 2L));
    when(service.upload(eq(1L), eq(10L), anyList())).thenReturn(uploaded);

    var file =
        new MockMultipartFile(
            "files", "a.txt", "text/plain", "hi".getBytes(StandardCharsets.UTF_8));

    mockMvc
        .perform(
            multipart("/api/v1/chat/threads/10/attachments")
                .file(file)
                .header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].fileId").value(42));
  }

  /** 비멤버 업로드 시도 → 서비스가 ChatThreadNotMemberException 발생 → 403. */
  @Test
  void 비멤버_업로드_403() throws Exception {
    when(service.upload(eq(1L), eq(10L), anyList()))
        .thenThrow(new ChatThreadNotMemberException(10L, 1L));

    var file =
        new MockMultipartFile(
            "files", "a.txt", "text/plain", "hi".getBytes(StandardCharsets.UTF_8));

    mockMvc
        .perform(
            multipart("/api/v1/chat/threads/10/attachments")
                .file(file)
                .header("Authorization", "Bearer v"))
        .andExpect(status().isForbidden());
  }

  /** 멤버가 자신 스레드 메시지의 첨부를 다운로드 → 200 + 파일 본문. */
  @Test
  void 다운로드_성공() throws Exception {
    // 임시 파일 생성 — FileSystemResource 에 실제 경로가 필요.
    File tmp = Files.createTempFile("test-att", ".txt").toFile();
    Files.writeString(tmp.toPath(), "hello");
    tmp.deleteOnExit();

    var row =
        new ChatMessageAttachmentRepository.StoredFileRow(
            tmp.getAbsolutePath(), "a.txt", "text/plain", 5L);
    when(service.download(eq(1L), eq(10L), eq(20L), eq(42L))).thenReturn(row);

    mockMvc
        .perform(
            get("/api/v1/chat/threads/10/messages/20/attachments/42/content")
                .header("Authorization", "Bearer v"))
        .andExpect(status().isOk());
  }

  /** 다른 스레드 메시지의 첨부 다운로드 시도 → InvalidChatAttachmentException → 400. */
  @Test
  void 다른_스레드_메시지_첨부_다운로드_차단() throws Exception {
    when(service.download(eq(1L), eq(10L), eq(99L), eq(42L)))
        .thenThrow(new InvalidChatAttachmentException());

    mockMvc
        .perform(
            get("/api/v1/chat/threads/10/messages/99/attachments/42/content")
                .header("Authorization", "Bearer v"))
        .andExpect(status().is4xxClientError());
  }
}
