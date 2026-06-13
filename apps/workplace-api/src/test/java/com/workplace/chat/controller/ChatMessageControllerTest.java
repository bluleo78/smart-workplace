package com.workplace.chat.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
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
import com.workplace.chat.dto.ChatMessagePage;
import com.workplace.chat.dto.ChatMessageResponse;
import com.workplace.chat.dto.CreateChatMessageRequest;
import com.workplace.chat.dto.MarkChatReadRequest;
import com.workplace.chat.dto.UpdateChatMessageRequest;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** ChatMessageController @WebMvcTest. */
@SuppressWarnings("null")
@WebMvcTest(ChatMessageController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class ChatMessageControllerTest {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper om;
  @MockitoBean ChatMessageService messageService;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;

  @MockitoBean MembershipRepository membershipRepository;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of("project:read"));
  }

  private ChatMessageResponse sample() {
    return new ChatMessageResponse(
        10L, 1L, 1L, "me", "HUMAN", "hello", List.of(), Instant.now(), null, false);
  }

  @Test
  void list_returnsPage() throws Exception {
    when(messageService.list(eq(1L), eq(1L), any(), eq(50)))
        .thenReturn(new ChatMessagePage(List.of(sample()), null, false));
    mockMvc
        .perform(get("/api/v1/chat/threads/1/messages").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].body").value("hello"));
  }

  @Test
  void create_201() throws Exception {
    when(messageService.create(eq(1L), eq(1L), any())).thenReturn(sample());
    mockMvc
        .perform(
            post("/api/v1/chat/threads/1/messages")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(new CreateChatMessageRequest("hello"))))
        .andExpect(status().isCreated());
  }

  @Test
  void update_200() throws Exception {
    when(messageService.update(eq(1L), eq(10L), any())).thenReturn(sample());
    mockMvc
        .perform(
            patch("/api/v1/chat/messages/10")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(new UpdateChatMessageRequest("edited"))))
        .andExpect(status().isOk());
  }

  @Test
  void delete_204() throws Exception {
    mockMvc
        .perform(delete("/api/v1/chat/messages/10").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(messageService).delete(1L, 10L);
  }

  @Test
  void markRead_204() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/chat/threads/1/read")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(new MarkChatReadRequest(10L))))
        .andExpect(status().isNoContent());
    verify(messageService).markRead(1L, 1L, 10L);
  }

  @Test
  void typing_204() throws Exception {
    mockMvc
        .perform(post("/api/v1/chat/threads/1/typing").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(messageService).notifyTyping(1L, 1L);
  }
}
