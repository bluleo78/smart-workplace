package com.workplace.wiki.report;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트 리포트 REST(WP-1483) — 설정 GET/PUT·템플릿 되돌리기. 요청 검증(정시만)·권한(MEMBER 403·개인 400)을 HTTP 로 확인한다.
 *
 * <p>@Transactional: MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고 끝나면 롤백된다.
 */
@Transactional
class ProjectReportControllerTest extends ExternalClientMockedTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;

  private long ownerId;
  private ProjectResponse project;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = human();
    String key =
        "RC" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    project =
        projectService.create(ownerId, new CreateProjectRequest(key, "리포트-" + key, null, "TEAM"));
  }

  /** 시각은 정시만 — 09:30 이면 400 과 한국어 문구. */
  @Test
  void putSettings_invalidTime_400() throws Exception {
    call(
            put(settingsUrl())
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"enabled\":true,\"cadence\":\"WEEKLY\",\"weekday\":\"MONDAY\",\"timeOfDay\":\"09:30\"}"),
            ownerId)
        .andExpect(status().isBadRequest());
  }

  /** 주기·요일이 목록 밖이면 400. */
  @Test
  void putSettings_invalidCadence_400() throws Exception {
    call(
            put(settingsUrl())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"enabled\":true,\"cadence\":\"DAILY\"}"),
            ownerId)
        .andExpect(status().isBadRequest());
  }

  /** GET 기본값, PUT 으로 켜면 템플릿 id·다음 실행이 생기고, 되돌리기는 같은 응답 모양. */
  @Test
  void getPutReset_roundTrip() throws Exception {
    call(get(settingsUrl()), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.enabled").value(false))
        .andExpect(jsonPath("$.timeOfDay").value("09:00"))
        .andExpect(jsonPath("$.canManage").value(true));
    call(
            put(settingsUrl())
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"enabled\":true,\"cadence\":\"MONTHLY\",\"weekday\":\"TUESDAY\",\"timeOfDay\":\"08:00\"}"),
            ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.enabled").value(true))
        .andExpect(jsonPath("$.cadence").value("MONTHLY"))
        .andExpect(jsonPath("$.weekday").value("TUESDAY"))
        .andExpect(jsonPath("$.timeOfDay").value("08:00"))
        .andExpect(jsonPath("$.templatePageId").isNumber())
        .andExpect(jsonPath("$.nextRunAt").isNotEmpty());
    call(post(settingsUrl() + "/template/reset"), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.templatePageId").isNumber());
  }

  /** MEMBER 의 PUT 은 403. */
  @Test
  void putSettings_byMember_403() throws Exception {
    long member = human();
    projectService.addMember(ownerId, project.key(), new AddMemberRequest(member, "MEMBER"));
    call(
            put(settingsUrl())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"enabled\":true}"),
            member)
        .andExpect(status().isForbidden());
  }

  private String settingsUrl() {
    return "/api/v1/projects/" + project.key() + "/report-settings";
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    return mvc.perform(req);
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(id);
    return id;
  }
}
