package com.workplace.cycle.controller;

import static com.workplace.jooq.Tables.CYCLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.LinkedHashMap;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1316 사이클 기간 필수 — 시작일·종료일 중 하나라도 비면 만들기·수정 모두 400(한국어 필드 오류)이고 사이클은 생기거나 바뀌지 않는다. 웹 폼과
 * MCP(create_project_meta·update_project_meta)가 모두 이 HTTP 경로를 타므로 컨트롤러의 Bean Validation 까지 거치게
 * MockMvc 로 부른다.
 *
 * <p>@Transactional 이라 MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고, 끝나면 롤백된다.
 */
@Transactional
class CycleDateRequiredEndpointTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;

  private long ownerId;
  private String base;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, ownerId, "USER");
    String key = "CD" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectService.create(ownerId, new CreateProjectRequest(key, "사이클 기간", "x"));
    base = "/api/v1/projects/" + key + "/cycles";
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 만들기 — 시작일·종료일이 없거나 하나만 있으면 400, 빠진 날짜마다 한국어 안내. 사이클은 생기지 않는다. */
  @Test
  void createWithoutDatesIsRejected() throws Exception {
    call(post(base).content(cycle("날짜 없음", null, null)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.startDate").value("사이클 시작일을 입력해 주세요"))
        .andExpect(jsonPath("$.errors.endDate").value("사이클 종료일을 입력해 주세요"));
    call(post(base).content(cycle("종료일 없음", "2026-11-02", null)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.endDate").value("사이클 종료일을 입력해 주세요"))
        .andExpect(jsonPath("$.errors.startDate").doesNotExist());
    call(post(base).content(cycle("시작일 없음", null, "2026-11-08")))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.startDate").value("사이클 시작일을 입력해 주세요"));
    assertThat(dsl.fetchCount(CYCLE, CYCLE.NAME.in("날짜 없음", "종료일 없음", "시작일 없음"))).isZero();

    call(post(base).content(cycle("1주차", "2026-11-02", "2026-11-08")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.startDate").value("2026-11-02"))
        .andExpect(jsonPath("$.endDate").value("2026-11-08"));
  }

  /** 수정 — 같은 본문으로 덮어쓰는 수정이라 날짜를 비우는 것도 400 이고, 기존 기간이 그대로 남는다. */
  @Test
  void updateCannotClearDates() throws Exception {
    long id =
        om.readTree(
                call(post(base).content(cycle("1주차", "2026-11-02", "2026-11-08")))
                    .andReturn()
                    .getResponse()
                    .getContentAsString())
            .get("id")
            .asLong();

    call(patch(base + "/" + id).content(cycle("1주차", null, "2026-11-08")))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.startDate").value("사이클 시작일을 입력해 주세요"));
    var row = dsl.selectFrom(CYCLE).where(CYCLE.ID.eq(id)).fetchOne();
    assertThat(row.getStartDate()).hasToString("2026-11-02");
    assertThat(row.getEndDate()).hasToString("2026-11-08");
  }

  private String cycle(String name, String startDate, String endDate) throws Exception {
    var m = new LinkedHashMap<String, Object>();
    m.put("name", name);
    m.put("startDate", startDate);
    m.put("endDate", endDate);
    return om.writeValueAsString(m);
  }

  private ResultActions call(MockHttpServletRequestBuilder req) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(ownerId, "u-" + ownerId, 1L))
        .contentType(MediaType.APPLICATION_JSON);
    ResultActions r = mvc.perform(req);
    // 요청 처리가 지우는 테넌트 문맥을 다시 심는다.
    TenantContext.set(1L);
    return r;
  }
}
