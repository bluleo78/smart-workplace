package com.workplace.contacts.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.contacts.dto.ContactPage;
import com.workplace.contacts.dto.ExternalContactDetail;
import com.workplace.contacts.dto.MemberDetail;
import com.workplace.contacts.exception.ContactForbiddenException;
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
import org.springframework.http.MediaType;
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

  private static final String CREATE_JSON =
      "{\"name\":\"박외부\",\"email\":\"p@x.com\",\"phone\":\"\",\"organization\":\"\",\"title\":\"\",\"notes\":\"\",\"visibility\":\"PERSONAL\"}";

  private ExternalContactDetail sampleDetail() {
    return new ExternalContactDetail(
        100L, "박외부", "p@x.com", null, null, null, null, "PERSONAL", true, null, null);
  }

  @Test
  void createExternal_withWritePermission_returns201() throws Exception {
    when(permissionService.getUserPermissions(1L))
        .thenReturn(Set.of("contact:read", "contact:write"));
    when(service.create(eq(1L), any())).thenReturn(sampleDetail());
    mockMvc
        .perform(
            post("/api/v1/contacts/external")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(CREATE_JSON))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.name").value("박외부"))
        .andExpect(jsonPath("$.editable").value(true));
  }

  @Test
  void createExternal_withoutWritePermission_returns403() throws Exception {
    // @BeforeEach 가 contact:read 만 부여 → write 엔드포인트 차단
    mockMvc
        .perform(
            post("/api/v1/contacts/external")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(CREATE_JSON))
        .andExpect(status().isForbidden());
  }

  @Test
  void createExternal_blankName_returns400() throws Exception {
    when(permissionService.getUserPermissions(1L))
        .thenReturn(Set.of("contact:read", "contact:write"));
    mockMvc
        .perform(
            post("/api/v1/contacts/external")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"\",\"visibility\":\"PERSONAL\"}"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void updateExternal_sharedNonOwner_returns403() throws Exception {
    when(permissionService.getUserPermissions(1L))
        .thenReturn(Set.of("contact:read", "contact:write"));
    when(service.update(eq(1L), eq(100L), any()))
        .thenThrow(new ContactForbiddenException(100L, 1L));
    mockMvc
        .perform(
            patch("/api/v1/contacts/external/100")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(CREATE_JSON))
        .andExpect(status().isForbidden());
  }

  @Test
  void updateExternal_personalNonOwner_returns404() throws Exception {
    when(permissionService.getUserPermissions(1L))
        .thenReturn(Set.of("contact:read", "contact:write"));
    when(service.update(eq(1L), eq(100L), any()))
        .thenThrow(new ContactNotFoundException("EXTERNAL", 100L));
    mockMvc
        .perform(
            patch("/api/v1/contacts/external/100")
                .header("Authorization", "Bearer v")
                .contentType(MediaType.APPLICATION_JSON)
                .content(CREATE_JSON))
        .andExpect(status().isNotFound());
  }

  @Test
  void deleteExternal_returns204() throws Exception {
    when(permissionService.getUserPermissions(1L))
        .thenReturn(Set.of("contact:read", "contact:write"));
    doNothing().when(service).delete(eq(1L), eq(100L));
    mockMvc
        .perform(delete("/api/v1/contacts/external/100").header("Authorization", "Bearer v"))
        .andExpect(status().isNoContent());
  }
}
