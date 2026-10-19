package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 집합 교체 PUT(라벨·담당자·사이클)에 null 원소가 든 목록을 보내면 500 이 아니라 400 이어야 한다(WP-500). 예전엔 검증이 목록 자체만 보고 원소는
 * 보지 않아, null 이 서비스까지 들어가 NPE 로 500 이 났다.
 */
@Transactional
class IssueReplaceNullElementEndpointTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;

  private long userId;
  private String key;

  /** USER 역할 사용자와 그가 OWNER 인 프로젝트·이슈 1번을 만든다. */
  @BeforeEach
  void setUp() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "n-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "n")
            .set(USER.EMAIL, "n-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
    TestFixtures.activeMemberOfCurrentTenant(dsl, userId);
    key = ("NE" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase()).substring(0, 6);
    ProjectResponse proj = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    issueRepository.insert(proj.id(), 1, "t", null, "MID", null, userId);
  }

  @ParameterizedTest
  @CsvSource(
      delimiter = '|',
      value = {
        "labels    | {\"labelIds\":[null]}",
        "labels    | {\"labelIds\":[],\"labelNames\":[null]}",
        "assignees | {\"userIds\":[null]}",
        "cycles    | {\"cycleIds\":[null]}",
      })
  void null_element_returns_400(String path, String body) throws Exception {
    mvc.perform(
            put("/api/v1/projects/" + key + "/issues/1/" + path)
                .header(
                    "Authorization",
                    "Bearer " + jwtTokenProvider.generateAccessToken(userId, "user-" + userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest());
  }
}
