package com.workplace.contacts.controller;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.contacts.dto.ContactPage;
import com.workplace.contacts.dto.MemberDetail;
import com.workplace.contacts.exception.ContactNotFoundException;
import com.workplace.contacts.service.ContactService;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** 연락처 조회 컨트롤러 라우팅·상태코드. 서비스는 Mockito. */
@SuppressWarnings("null")
@WebMvcTest(controllers = ContactController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class ContactControllerTest {

  @Autowired MockMvc mockMvc;

  @MockitoBean ContactService service;
  @MockitoBean JwtTokenProvider jwt;
  @MockitoBean JwtProperties jwtProps;
  @MockitoBean PermissionService permissionService;
  @MockitoBean AgentApiKeyRepository agentApiKeyRepository;
  @MockitoBean UserRepository userRepository;

  @BeforeEach
  void auth() {
    when(jwt.validateAccessToken("v")).thenReturn(true);
    when(jwt.getUserIdFromToken("v")).thenReturn(1L);
    when(permissionService.getUserPermissions(1L)).thenReturn(Set.of("contact:read"));
  }

  @Test
  void list_returnsPage() throws Exception {
    when(service.list(eq(1L), isNull(), eq("ALL"), isNull(), anyInt()))
        .thenReturn(new ContactPage(List.of(), null, false));
    mockMvc
        .perform(get("/api/v1/contacts").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isArray());
  }

  @Test
  void member_notFound_returns404() throws Exception {
    when(service.getMember(anyLong())).thenThrow(new ContactNotFoundException("MEMBER", 9L));
    mockMvc
        .perform(get("/api/v1/contacts/members/9").header("Authorization", "Bearer v"))
        .andExpect(status().isNotFound());
  }

  @Test
  void member_ok_returnsDetail() throws Exception {
    when(service.getMember(5L))
        .thenReturn(
            new MemberDetail(5L, "u5", "김멤버", "u5@example.com", "팀장", "HUMAN", List.of("개발팀")));
    mockMvc
        .perform(get("/api/v1/contacts/members/5").header("Authorization", "Bearer v"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("김멤버"))
        .andExpect(jsonPath("$.groups[0]").value("개발팀"));
  }
}
