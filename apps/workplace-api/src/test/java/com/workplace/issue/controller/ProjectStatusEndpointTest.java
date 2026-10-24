package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.CreateProjectStatusRequest;
import com.workplace.issue.dto.UpdateProjectStatusRequest;
import com.workplace.issue.service.IssueService;
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
  @Autowired IssueService issueService;

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
  void GET_statuses는_color를_싣는다() throws Exception {
    long owner = createUser("gc");
    ProjectResponse p = newProject(owner, "PEI");

    mvc.perform(
            get("/api/v1/projects/" + p.key() + "/statuses")
                .header("Authorization", "Bearer " + tokenFor(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[0].color").value("GRAY"))
        .andExpect(jsonPath("$[1].color").value("BLUE"))
        .andExpect(jsonPath("$[2].color").value("GREEN"));
  }

  @Test
  void PATCH_color만_보내도_200() throws Exception {
    long owner = createUser("pc");
    ProjectResponse p = newProject(owner, "PEJ");
    Long todo = statusService.list(owner, p.key()).get(0).id();

    // 구 웹은 이름만, 새 웹은 색만 보낼 수 있다 — 색만 담은 본문도 받아 이름은 그대로 둔다
    mvc.perform(
            patch("/api/v1/projects/" + p.key() + "/statuses/" + todo)
                .header("Authorization", "Bearer " + tokenFor(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"color\":\"TEAL\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("할 일"))
        .andExpect(jsonPath("$.color").value("TEAL"));
  }

  @Test
  void PATCH_빈본문은_400() throws Exception {
    long owner = createUser("pz");
    ProjectResponse p = newProject(owner, "PEK");
    Long todo = statusService.list(owner, p.key()).get(0).id();

    mvc.perform(
            patch("/api/v1/projects/" + p.key() + "/statuses/" + todo)
                .header("Authorization", "Bearer " + tokenFor(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void POST_statuses는_201과_본문() throws Exception {
    long owner = createUser("po");
    ProjectResponse p = newProject(owner, "PEB");

    String body =
        om.writeValueAsString(new CreateProjectStatusRequest("검토 중", "IN_PROGRESS", null, null));
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
        om.writeValueAsString(new CreateProjectStatusRequest("가".repeat(31), "TODO", null, null));
    mvc.perform(
            post("/api/v1/projects/" + p.key() + "/statuses")
                .header("Authorization", "Bearer " + tokenFor(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("상태 이름은 30자 이하로 입력해 주세요"));
  }

  @Test
  void POST_보이지않는_글자만_있는_이름은_400() throws Exception {
    long owner = createUser("pi");
    ProjectResponse p = newProject(owner, "PEH");

    // 요청 record 가 한 줄로 다듬어 빈 문자열이 되고 @NotBlank 가 거절한다(유형 API 와 같은 동작)
    String body =
        om.writeValueAsString(new CreateProjectStatusRequest("\u200B\u3164", "TODO", null, null));
    mvc.perform(
            post("/api/v1/projects/" + p.key() + "/statuses")
                .header("Authorization", "Bearer " + tokenFor(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest());
  }

  @Test
  void PATCH_중복이름은_409와_메시지() throws Exception {
    long owner = createUser("pd");
    ProjectResponse p = newProject(owner, "PED");
    statusService.create(
        owner, p.key(), new CreateProjectStatusRequest("검토 중", "IN_PROGRESS", null, null));
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
                .content(om.writeValueAsString(new UpdateProjectStatusRequest("검토 중", null))))
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
                .content(om.writeValueAsString(new UpdateProjectStatusRequest("X", null))))
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

  @Test
  void PUT_order는_200과_정렬된_전체목록() throws Exception {
    long owner = createUser("po");
    ProjectResponse p = newProject(owner, "PEO");
    var review =
        statusService.create(
            owner, p.key(), new CreateProjectStatusRequest("검토 중", "IN_PROGRESS", null, null));
    Long inProgress =
        statusService.list(owner, p.key()).stream()
            .filter(s -> s.name().equals("진행 중"))
            .findFirst()
            .orElseThrow()
            .id();

    mvc.perform(
            put("/api/v1/projects/" + p.key() + "/statuses/order")
                .header("Authorization", "Bearer " + tokenFor(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"category\":\"IN_PROGRESS\",\"statusIds\":["
                        + review.id()
                        + ","
                        + inProgress
                        + "]}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(5)))
        .andExpect(jsonPath("$[0].name").value("할 일"))
        .andExpect(jsonPath("$[1].name").value("검토 중"))
        .andExpect(jsonPath("$[2].name").value("진행 중"))
        .andExpect(jsonPath("$[3].name").value("완료"));

    // 범주 코드가 아니면 검증에서 400
    mvc.perform(
            put("/api/v1/projects/" + p.key() + "/statuses/order")
                .header("Authorization", "Bearer " + tokenFor(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"category\":\"NOPE\",\"statusIds\":[]}"))
        .andExpect(status().isBadRequest());
  }

  /** 상태 이름으로 id 를 찾는다. */
  private Long idOf(long caller, String key, String name) {
    return statusService.list(caller, key).stream()
        .filter(s -> s.name().equals(name))
        .findFirst()
        .orElseThrow()
        .id();
  }

  @Test
  void DELETE_moveTo로_204() throws Exception {
    long owner = createUser("dm");
    ProjectResponse p = newProject(owner, "PEQ");
    var review =
        statusService.create(
            owner, p.key(), new CreateProjectStatusRequest("검토 중", "IN_PROGRESS", null, null));
    Long inProgress = idOf(owner, p.key(), "진행 중");

    mvc.perform(
            delete("/api/v1/projects/" + p.key() + "/statuses/" + review.id())
                .param("moveTo", String.valueOf(inProgress))
                .header("Authorization", "Bearer " + tokenFor(owner)))
        .andExpect(status().isNoContent());

    mvc.perform(
            get("/api/v1/projects/" + p.key() + "/statuses")
                .header("Authorization", "Bearer " + tokenFor(owner)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$", hasSize(4)));
  }

  @Test
  void DELETE_마지막상태_409와_메시지() throws Exception {
    long owner = createUser("dl");
    ProjectResponse p = newProject(owner, "PER");
    Long todo = idOf(owner, p.key(), "할 일");

    mvc.perform(
            delete("/api/v1/projects/" + p.key() + "/statuses/" + todo)
                .header("Authorization", "Bearer " + tokenFor(owner)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value("범주의 마지막 상태는 지울 수 없어요"));
  }

  @Test
  void DELETE_이슈가_있는데_moveTo없으면_400과_메시지() throws Exception {
    long owner = createUser("dn");
    ProjectResponse p = newProject(owner, "PES");
    var review =
        statusService.create(
            owner, p.key(), new CreateProjectStatusRequest("검토 중", "IN_PROGRESS", null, null));
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest(
            "t",
            null,
            null,
            null,
            java.util.List.of(),
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            review.id()));

    mvc.perform(
            delete("/api/v1/projects/" + p.key() + "/statuses/" + review.id())
                .header("Authorization", "Bearer " + tokenFor(owner)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("옮길 상태를 골라 주세요"));
  }

  @Test
  void GET_deletion_impact_200() throws Exception {
    long owner = createUser("di");
    long member = createUser("dj");
    ProjectResponse p = newProject(owner, "PET");
    projectService.addMember(owner, p.key(), new AddMemberRequest(member, "MEMBER"));
    var review =
        statusService.create(
            owner, p.key(), new CreateProjectStatusRequest("검토 중", "IN_PROGRESS", null, null));
    issueService.create(
        owner,
        p.key(),
        new CreateIssueRequest(
            "t",
            null,
            null,
            null,
            java.util.List.of(),
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            review.id()));

    // 조회는 project:read — 멤버도 볼 수 있다
    mvc.perform(
            get("/api/v1/projects/" + p.key() + "/statuses/" + review.id() + "/deletion-impact")
                .header("Authorization", "Bearer " + tokenFor(member)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.issueCount").value(1))
        .andExpect(jsonPath("$.savedViewCount").value(0))
        .andExpect(jsonPath("$.blockedEpicCount").value(0))
        .andExpect(jsonPath("$.emptiedFilterViewCount").value(0));
  }
}
