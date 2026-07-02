package com.workplace.chat.controller;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.chat.dto.AddChatMemberRequest;
import com.workplace.chat.service.ChatMembershipService;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.security.UserTokenAuthenticationFilter;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** ChatThreadMemberController @WebMvcTest. */
@SuppressWarnings("null")
@WebMvcTest(ChatThreadMemberController.class)
@Import({
  SecurityConfig.class,
  JwtAuthenticationFilter.class,
  ApiKeyAuthenticationFilter.class,
  UserTokenAuthenticationFilter.class
})
class ChatThreadMemberControllerTest {

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper om;
  @MockitoBean ChatMembershipService membershipService;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;

  @MockitoBean MembershipRepository membershipRepository;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserApiTokenRepository userApiTokenRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of("project:read"));
  }

  @Test
  void add_204() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/chat/threads/1/members")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(new AddChatMemberRequest(99L))))
        .andExpect(status().isNoContent());
    verify(membershipService).add(1L, 1L, 99L);
  }

  @Test
  void leaveSelf_204() throws Exception {
    mockMvc
        .perform(delete("/api/v1/chat/threads/1/members/1").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
    verify(membershipService).leave(1L, 1L);
  }

  @Test
  void leaveOther_403() throws Exception {
    mockMvc
        .perform(delete("/api/v1/chat/threads/1/members/2").header("Authorization", "Bearer v"))
        .andExpect(status().isForbidden());
  }
}
