package com.workplace.component;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.component.dto.ComponentSummary;
import com.workplace.component.repository.ComponentRepository;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueHistoryRecorder;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
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
 * WP-933 구성요소 목록 관리 API — 권한(OWNER·ADMIN·멤버·비멤버), 이름 유일(대소문자·공백), 개인 프로젝트 거부, 담당자 유효성, 보관·복원, 삭제 시
 * 이슈 이력, 개수 상한.
 *
 * <p>@Transactional 이라 MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고, 끝나면 롤백된다.
 */
@Transactional
class ComponentManagementTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;
  @Autowired ComponentRepository componentRepository;
  @Autowired IssueHistoryRecorder recorder;

  private long ownerId;
  private long memberId;
  private long outsiderId;
  private long adminId;
  private String key;
  private long projectId;
  private String base;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = human("USER");
    memberId = human("USER");
    outsiderId = human("USER");
    adminId = human("ADMIN");
    key = "CM" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    // OPEN 프로젝트 — 비멤버도 읽을 수 있어 「읽기 가능한 비멤버」 케이스를 같은 프로젝트에서 본다.
    projectId =
        projectService.create(ownerId, new CreateProjectRequest(key, "구성요소", "x", "OPEN")).id();
    projectService.addMember(ownerId, key, new AddMemberRequest(memberId, "MEMBER"));
    base = "/api/v1/projects/" + key + "/components";
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** OWNER 가 만든 구성요소는 이름(대소문자 무시) 순으로 나온다. */
  @Test
  void ownerCreatesAndListsInNameOrder() throws Exception {
    for (String n : List.of("Network", "compute", "Audit")) {
      call(post(base).content(body(n, null, null)), ownerId)
          .andExpect(status().isCreated())
          .andExpect(jsonPath("$.name").value(n))
          .andExpect(jsonPath("$.archived").value(false))
          .andExpect(jsonPath("$.issueCount").value(0))
          .andExpect(jsonPath("$.defaultAssigneeValid").value(true));
    }

    JsonNode list = json(call(get(base), ownerId).andExpect(status().isOk()));
    List<String> names = new ArrayList<>();
    list.forEach(n -> names.add(n.get("name").asText()));
    assertThat(names).containsExactly("Audit", "compute", "Network");
  }

  /** 테넌트 ADMIN(비멤버)은 관리할 수 있고, 일반 멤버는 403, 읽을 수 있는 비멤버는 목록만 본다. */
  @Test
  void adminCanManageMemberCannot() throws Exception {
    call(post(base).content(body("ByAdmin", null, null)), adminId).andExpect(status().isCreated());
    call(post(base).content(body("ByMember", null, null)), memberId)
        .andExpect(status().isForbidden());
    call(get(base), outsiderId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(1));

    long id = createComponent("Target");
    call(patch(base + "/" + id).content("{\"name\":\"X\"}"), memberId)
        .andExpect(status().isForbidden());
    call(delete(base + "/" + id), memberId).andExpect(status().isForbidden());
    call(patch(base + "/" + id).content("{\"description\":\"d\"}"), adminId)
        .andExpect(status().isOk());
  }

  /** 이름은 대소문자·앞뒤 공백을 무시하고 유일, 41자는 거절. */
  @Test
  void nameUniqueIgnoringCase() throws Exception {
    createComponent("Compute");
    call(post(base).content(body(" compute ", null, null)), ownerId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("COMPONENT_NAME_TAKEN"));

    long other = createComponent("Other");
    call(patch(base + "/" + other).content("{\"name\":\" COMPUTE\"}"), ownerId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("COMPONENT_NAME_TAKEN"));
    // 자기 이름의 대소문자만 바꾸는 것은 허용된다.
    call(patch(base + "/" + other).content("{\"name\":\"OTHER\"}"), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("OTHER"));

    call(post(base).content(body("x".repeat(41), null, null)), ownerId)
        .andExpect(status().isBadRequest());
    call(post(base).content(body("   ", null, null)), ownerId).andExpect(status().isBadRequest());
  }

  /** 개인 프로젝트에는 만들 수 없다. */
  @Test
  void personalProjectRejected() throws Exception {
    dsl.execute("UPDATE project SET type = 'PERSONAL' WHERE id = ?", projectId);
    call(post(base).content(body("Any", null, null)), ownerId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("PERSONAL_PROJECT_UNSUPPORTED"));
  }

  /** 담당자는 프로젝트 멤버·활성·사람이어야 하고, 멤버에서 빠지면 응답이 무효로 표시한다. */
  @Test
  void assigneeMustBeActiveHumanMember() throws Exception {
    long agentId = createAgentUserWithMembership("compagent");
    projectService.addMember(ownerId, key, new AddMemberRequest(agentId, "MEMBER"));
    long suspended = withMembership(TestFixtures.createHuman(dsl));
    projectService.addMember(ownerId, key, new AddMemberRequest(suspended, "MEMBER"));
    TestFixtures.suspendMember(dsl, suspended, 1L);

    for (long bad : new long[] {outsiderId, suspended, agentId}) {
      call(post(base).content(body("A" + bad, null, bad)), ownerId)
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.errors.code").value("COMPONENT_ASSIGNEE_INVALID"));
    }

    long id = createComponent("Compute");
    call(patch(base + "/" + id).content("{\"defaultAssigneeId\":" + memberId + "}"), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.defaultAssignee.id").value(memberId))
        .andExpect(jsonPath("$.defaultAssigneeValid").value(true))
        .andExpect(jsonPath("$.defaultAssigneeInvalidReason").value(nullValue()));
    call(patch(base + "/" + id).content("{\"defaultAssigneeId\":" + agentId + "}"), ownerId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("COMPONENT_ASSIGNEE_INVALID"));

    projectService.removeMember(ownerId, key, memberId);
    JsonNode row = json(call(get(base), ownerId)).get(0);
    assertThat(row.get("defaultAssigneeValid").asBoolean()).isFalse();
    assertThat(row.get("defaultAssigneeInvalidReason").asText()).isEqualTo("NOT_MEMBER");
    // 값은 남는다 — 설정 화면이 경고를 그릴 수 있게.
    assertThat(row.get("defaultAssignee").get("id").asLong()).isEqualTo(memberId);

    // 이름만 바꾸는 수정은 이미 무효가 된 담당자 때문에 막히지 않고, 담당자 지우기도 된다.
    call(patch(base + "/" + id).content("{\"name\":\"Compute2\"}"), ownerId)
        .andExpect(status().isOk());
    call(patch(base + "/" + id).content("{\"clearDefaultAssignee\":true}"), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.defaultAssignee").doesNotExist())
        .andExpect(jsonPath("$.defaultAssigneeValid").value(true));
  }

  /**
   * 구성원으로 남은 채 계정만 정지된 담당자는 「구성원 아님」이 아니라 INACTIVE 로 알린다(WP-1123). 정지됐고 구성원에서도 빠지면 정지가 먼저다 — 구성원으로
   * 되돌려도 정지는 풀리지 않는다.
   */
  @Test
  void invalidReasonTellsSuspendedApartFromNotMember() throws Exception {
    long assignee = withMembership(TestFixtures.createHuman(dsl));
    projectService.addMember(ownerId, key, new AddMemberRequest(assignee, "MEMBER"));
    long id = createComponent("Backend");
    call(patch(base + "/" + id).content("{\"defaultAssigneeId\":" + assignee + "}"), ownerId)
        .andExpect(status().isOk());

    TestFixtures.suspendMember(dsl, assignee, 1L);
    JsonNode row = json(call(get(base), ownerId)).get(0);
    assertThat(row.get("defaultAssigneeValid").asBoolean()).isFalse();
    assertThat(row.get("defaultAssigneeInvalidReason").asText()).isEqualTo("INACTIVE");

    projectService.removeMember(ownerId, key, assignee);
    row = json(call(get(base), ownerId)).get(0);
    assertThat(row.get("defaultAssigneeInvalidReason").asText()).isEqualTo("INACTIVE");
  }

  /** 보관하면 archived=true, 다시 false 로 복원. 목록에는 보관된 것도 남는다. */
  @Test
  void archiveAndRestore() throws Exception {
    long id = createComponent("Compute");
    call(patch(base + "/" + id).content("{\"archived\":true}"), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.archived").value(true));
    assertThat(json(call(get(base), ownerId)).get(0).get("archived").asBoolean()).isTrue();
    call(patch(base + "/" + id).content("{\"archived\":false}"), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.archived").value(false));
  }

  /** 삭제하면 이슈 연결이 사라지고 붙어 있던 이슈마다 제거 이력이 한 건씩 남는다. 삭제 전 issue-count 는 2. */
  @Test
  void deleteRemovesFromIssuesWithHistory() throws Exception {
    long id = createComponent("Compute");
    long i1 = seedIssue(1);
    long i2 = seedIssue(2);
    for (long i : new long[] {i1, i2}) {
      dsl.execute("INSERT INTO issue_component (issue_id, component_id) VALUES (?, ?)", i, id);
    }

    call(get(base + "/" + id + "/issue-count"), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.count").value(2));
    call(get(base), ownerId).andExpect(jsonPath("$[0].issueCount").value(2));

    call(delete(base + "/" + id), ownerId).andExpect(status().isNoContent());

    assertThat(dsl.fetchCount(dsl.selectOne().from("issue_component"))).isZero();
    for (long i : new long[] {i1, i2}) {
      var rows =
          dsl.fetch(
              "SELECT to_value FROM issue_history WHERE issue_id = ? AND event_type ="
                  + " 'COMPONENTS_CHANGED'",
              i);
      assertThat(rows).hasSize(1);
      JsonNode payload = om.readTree(rows.get(0).get("to_value", String.class));
      assertThat(payload.get("added")).isEmpty();
      assertThat(payload.get("removed").get(0).get("id").asLong()).isEqualTo(id);
      assertThat(payload.get("removed").get(0).get("name").asText()).isEqualTo("Compute");
    }
    call(get(base + "/" + id + "/issue-count"), ownerId).andExpect(status().isNotFound());
  }

  /** 프로젝트당 100개까지 — 101번째는 거절. */
  @Test
  void limit100() throws Exception {
    for (int i = 0; i < 100; i++) {
      dsl.execute(
          "INSERT INTO project_component (project_id, name) VALUES (?, ?)", projectId, "C" + i);
    }
    call(post(base).content(body("OneMore", null, null)), ownerId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("COMPONENT_LIMIT"));
  }

  /** 이슈 3·4 단계가 쓰는 조회 — 이름 검색은 대소문자 무시·보관 포함, 이슈별 요약은 목록 순서, 이력은 빈 diff 를 생략. */
  @Test
  void repositoryLookupsAndHistoryRecorder() throws Exception {
    long b = createComponent("beta");
    long a = createComponent("Alpha");
    call(patch(base + "/" + b).content("{\"archived\":true}"), ownerId).andExpect(status().isOk());
    long issue = seedIssue(1);
    for (long c : new long[] {b, a}) {
      dsl.execute("INSERT INTO issue_component (issue_id, component_id) VALUES (?, ?)", issue, c);
    }

    assertThat(componentRepository.findByNamesIgnoreCase(projectId, List.of("BETA", "alpha")))
        .extracting(r -> r.id())
        .containsExactly(a, b);
    assertThat(componentRepository.findByIds(projectId, List.of(b, 999_999L), false))
        .extracting(r -> r.id())
        .containsExactly(b);
    var summaries = componentRepository.summariesByIssueIds(List.of(issue, 999_999L));
    assertThat(summaries.keySet()).containsExactly(issue);
    assertThat(summaries.get(issue))
        .extracting(c -> c.name() + ":" + c.archived())
        .containsExactly("Alpha:false", "beta:true");

    recorder.recordComponentsChanged(ownerId, issue, List.of(), List.of());
    recorder.recordComponentsChanged(
        ownerId, issue, List.of(new ComponentSummary(a, "Alpha", false)), List.of());
    assertThat(
            dsl.fetchCount(
                dsl.selectOne()
                    .from("issue_history")
                    .where("issue_id = ? AND event_type = 'COMPONENTS_CHANGED'", issue)))
        .isEqualTo(1);
  }

  // ── 헬퍼 ────────────────────────────────────────────────────────────────────────────────

  private long human(String role) {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, role);
    return id;
  }

  private long seedIssue(int number) {
    return IssueSeeds.insert(
            issueRepository, dsl, projectId, number, "이슈" + number, null, "MID", null, ownerId)
        .id();
  }

  private long createComponent(String name) throws Exception {
    return json(call(post(base).content(body(name, null, null)), ownerId)
            .andExpect(status().isCreated()))
        .get("id")
        .asLong();
  }

  private String body(String name, String description, Long assigneeId) throws Exception {
    var m = new java.util.LinkedHashMap<String, Object>();
    m.put("name", name);
    m.put("description", description);
    m.put("defaultAssigneeId", assigneeId);
    return om.writeValueAsString(m);
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long caller) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L))
        .contentType(MediaType.APPLICATION_JSON);
    ResultActions r = mvc.perform(req);
    // 요청 처리가 지우는 테넌트 문맥을 다시 심는다.
    TenantContext.set(1L);
    return r;
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }
}
