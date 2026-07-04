package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.repository.IssueDependencyRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** GET /api/v1/projects/{key}/issue-dependencies 통합 테스트 — 타임라인 화살표용 프로젝트 전체 의존 엣지. */
@AutoConfigureMockMvc
@Transactional
class IssueDependencyEdgesTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueDependencyRepository dependencyRepository;

  private long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  private String tokenFor(long userId) {
    return jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  @Test
  void lists_all_edges_of_project_as_issue_numbers() throws Exception {
    long userId = createUser("ea");
    String key = uniqueKey("EA");
    ProjectResponse proj = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var a = issueRepository.insert(proj.id(), 1, "a", null, "MID", null, userId);
    var b = issueRepository.insert(proj.id(), 2, "b", null, "MID", null, userId);
    var c = issueRepository.insert(proj.id(), 3, "c", null, "MID", null, userId);
    dependencyRepository.add(a.id(), b.id(), userId);
    dependencyRepository.add(b.id(), c.id(), userId);

    String responseBody =
        mvc.perform(
                get("/api/v1/projects/" + key + "/issue-dependencies")
                    .header("Authorization", "Bearer " + tokenFor(userId)))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();

    List<IssueDependencyEdgesController.DependencyEdgeResponse> edges =
        om.readValue(
            responseBody,
            om.getTypeFactory()
                .constructCollectionType(
                    List.class, IssueDependencyEdgesController.DependencyEdgeResponse.class));
    assertThat(edges)
        .containsExactlyInAnyOrder(
            new IssueDependencyEdgesController.DependencyEdgeResponse(1, 2),
            new IssueDependencyEdgesController.DependencyEdgeResponse(2, 3));
  }

  @Test
  void excludes_deleted_issues() throws Exception {
    long userId = createUser("eb");
    String key = uniqueKey("EB");
    ProjectResponse proj = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    var a = issueRepository.insert(proj.id(), 1, "a", null, "MID", null, userId);
    var b = issueRepository.insert(proj.id(), 2, "b", null, "MID", null, userId);
    var c = issueRepository.insert(proj.id(), 3, "c", null, "MID", null, userId);
    dependencyRepository.add(a.id(), b.id(), userId);
    dependencyRepository.add(b.id(), c.id(), userId);
    issueRepository.softDelete(c.id(), Instant.now());

    String responseBody =
        mvc.perform(
                get("/api/v1/projects/" + key + "/issue-dependencies")
                    .header("Authorization", "Bearer " + tokenFor(userId)))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();

    List<IssueDependencyEdgesController.DependencyEdgeResponse> edges =
        om.readValue(
            responseBody,
            om.getTypeFactory()
                .constructCollectionType(
                    List.class, IssueDependencyEdgesController.DependencyEdgeResponse.class));
    assertThat(edges)
        .containsExactly(new IssueDependencyEdgesController.DependencyEdgeResponse(1, 2));
  }
}
