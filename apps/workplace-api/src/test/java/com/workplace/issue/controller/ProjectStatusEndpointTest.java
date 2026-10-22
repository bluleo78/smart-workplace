package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.dto.CreateProjectStatusRequest;
import com.workplace.issue.dto.RenameProjectStatusRequest;
import com.workplace.issue.service.ProjectStatusService;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * GET/POST/PATCH /api/v1/projects/{key}/statuses 통합 테스트(WP-807). 실 JWT + MockMvc 로 보안 체인·예외 매핑(상태
 * 코드·메시지)을 확인한다.
 */
@Transactional
class ProjectStatusEndpointTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;
  @Autowired ProjectStatusService statusService;

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
    // 역할 권한은 같은 테넌트의 ACTIVE 멤버일 때만 유효하다(WP-420).
    TestFixtures.activeMemberOfCurrentTenant(dsl, id);
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

  private ProjectResponse newProject(long owner, String prefix) {
    return projectService.create(owner, new CreateProjectRequest(uniqueKey(prefix), "P", "x"));
  }

  @Test
  void GET_statuses는_멤버에게_200() throws Exception {
    long owner = createUser("go");
    long member = createUser("gm");
    ProjectResponse p = newProject(owner, "PEA");
    projectService.addMember(owner, p.key(), new AddMemberRequest(member, "MEMBER"));

    mvc.perform(
            get("/api/v1/projects/" + p.key() + "/statuses")
                .header("Authorization", "Bearer " + tokenFor(member)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(4)))
        .andExpect(jsonPath("$[0].name").value("할 일"))
        .andExpect(jsonPath("$[0].category").value("TODO"))
        .andExpect(jsonPath("$[1].category").value("IN_PROGRESS"));
  }

  @Test
  void POST_statuses는_201과_본문() throws Exception {
    long owner = createUser("po");
    ProjectResponse p = newProject(owner, "PEB");

    String body =
        om.writeValueAsString(new CreateProjectStatusRequest("검토 중", "IN_PROGRESS", null));
    mvc.perform(
            post("/api/v1/projects/" + p.key() + "/statuses")
                .header("Authorization", "Bearer " + tokenFor(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.id").isNumber())
        .andExpect(jsonPath("$.name").value("검토 중"))
        .andExpect(jsonPath("$.category").value("IN_PROGRESS"))
        .andExpect(jsonPath("$.position").value(2));
  }

  @Test
  void POST_31자_이름은_400과_메시지() throws Exception {
    long owner = createUser("pl");
    ProjectResponse p = newProject(owner, "PEC");

    String body =
        om.writeValueAsString(new CreateProjectStatusRequest("가".repeat(31), "TODO", null));
    mvc.perform(
            post("/api/v1/projects/" + p.key() + "/statuses")
                .header("Authorization", "Bearer " + tokenFor(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("상태 이름은 30자 이하로 입력해 주세요"));
  }

  @Test
  void PATCH_중복이름은_409와_메시지() throws Exception {
    long owner = createUser("pd");
    ProjectResponse p = newProject(owner, "PED");
    statusService.create(
        owner, p.key(), new CreateProjectStatusRequest("검토 중", "IN_PROGRESS", null));
    Long todo =
        statusService.list(owner, p.key()).stream()
            .filter(s -> s.name().equals("할 일"))
            .findFirst()
            .orElseThrow()
            .id();

    mvc.perform(
            patch("/api/v1/projects/" + p.key() + "/statuses/" + todo)
                .header("Authorization", "Bearer " + tokenFor(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(new RenameProjectStatusRequest("검토 중"))))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value("이미 존재하는 상태 이름입니다: 검토 중"));
  }

  @Test
  void PATCH_다른_프로젝트_상태는_404() throws Exception {
    long owner = createUser("px");
    ProjectResponse p = newProject(owner, "PEE");
    ProjectResponse other = newProject(owner, "PEF");
    Long otherTodo = statusService.list(owner, other.key()).get(0).id();

    mvc.perform(
            patch("/api/v1/projects/" + p.key() + "/statuses/" + otherTodo)
                .header("Authorization", "Bearer " + tokenFor(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(new RenameProjectStatusRequest("X"))))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("상태를 찾을 수 없습니다"));
  }

  @Test
  void 비멤버는_404() throws Exception {
    long owner = createUser("no");
    long other = createUser("nx");
    ProjectResponse p = newProject(owner, "PEG");

    mvc.perform(
            get("/api/v1/projects/" + p.key() + "/statuses")
                .header("Authorization", "Bearer " + tokenFor(other)))
        .andExpect(status().isNotFound());
  }
}
