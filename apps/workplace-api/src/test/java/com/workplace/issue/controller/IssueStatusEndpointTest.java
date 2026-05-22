package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.UpdateStatusRequest;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * PATCH /api/v1/projects/{key}/issues/{number}/status 통합 테스트. 실 JWT 발급 + MockMvc 로 전체 보안 체인을 통과시켜
 * 권한/히스토리/404 동작을 검증한다.
 */
@AutoConfigureMockMvc
class IssueStatusEndpointTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueHistoryRepository historyRepository;

  /** USER 역할이 부여된 사용자 시드. */
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

  /** userId 용 access token 발급 (Bearer 헤더 본문). */
  private String tokenFor(long userId) {
    return jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  @Test
  void member_can_change_status_history_recorded() throws Exception {
    long userId = createUser("m");
    String key = uniqueKey("PM");
    ProjectResponse proj = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    IssueRow issue = issueRepository.insert(proj.id(), 1, "t", null, "MID", null, userId, null);

    String body = om.writeValueAsString(new UpdateStatusRequest("IN_PROGRESS"));
    mvc.perform(
            patch("/api/v1/projects/" + key + "/issues/1/status")
                .header("Authorization", "Bearer " + tokenFor(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk());

    var history = historyRepository.findByIssue(issue.id());
    assertThat(history).anyMatch(h -> "STATUS_CHANGED".equals(h.eventType()));
  }

  @Test
  void same_status_does_not_record_history() throws Exception {
    long userId = createUser("n");
    String key = uniqueKey("PN");
    ProjectResponse proj = projectService.create(userId, new CreateProjectRequest(key, "P", "x"));
    IssueRow issue = issueRepository.insert(proj.id(), 1, "t", null, "MID", null, userId, null);

    String body = om.writeValueAsString(new UpdateStatusRequest("TODO"));
    mvc.perform(
            patch("/api/v1/projects/" + key + "/issues/1/status")
                .header("Authorization", "Bearer " + tokenFor(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk());

    var history = historyRepository.findByIssue(issue.id());
    assertThat(history).noneMatch(h -> "STATUS_CHANGED".equals(h.eventType()));
  }

  @Test
  void non_member_forbidden() throws Exception {
    long owner = createUser("oo");
    long other = createUser("xx");
    String key = uniqueKey("PO");
    ProjectResponse proj = projectService.create(owner, new CreateProjectRequest(key, "P", "x"));
    issueRepository.insert(proj.id(), 1, "t", null, "MID", null, owner, null);

    String body = om.writeValueAsString(new UpdateStatusRequest("IN_PROGRESS"));
    mvc.perform(
            patch("/api/v1/projects/" + key + "/issues/1/status")
                .header("Authorization", "Bearer " + tokenFor(other))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isForbidden());
  }

  @Test
  void missing_issue_404() throws Exception {
    long userId = createUser("p");
    String key = uniqueKey("PP");
    projectService.create(userId, new CreateProjectRequest(key, "P", "x"));

    String body = om.writeValueAsString(new UpdateStatusRequest("IN_PROGRESS"));
    mvc.perform(
            patch("/api/v1/projects/" + key + "/issues/999/status")
                .header("Authorization", "Bearer " + tokenFor(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isNotFound());
  }
}
