package com.workplace.issue;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 이슈 구성요소(WP-933) 통합 테스트 공용 바탕 — OPEN 프로젝트(OWNER·멤버 두 명·비멤버)를 만들고, 구성요소 시드·이슈 생성·구성요소 교체·이력 조회 헬퍼를
 * 준다. OPEN 이라 비멤버도 읽고 만들 수 있어 「읽을 수 있는 비멤버」 경우를 같은 프로젝트에서 본다.
 */
abstract class IssueComponentTestSupport extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;

  long ownerId;

  /** 구성요소 담당자로 쓰는 멤버(woody). */
  long woodyId;

  /** 구성요소 담당자로 쓰는 멤버(soon). */
  long soonId;

  long outsiderId;
  String key;
  long projectId;

  @BeforeEach
  void seedProject() {
    TenantContext.set(1L);
    ownerId = human();
    woodyId = human();
    soonId = human();
    outsiderId = human();
    key = "IC" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectId =
        projectService.create(ownerId, new CreateProjectRequest(key, "구성요소", "x", "OPEN")).id();
    projectService.addMember(ownerId, key, new AddMemberRequest(woodyId, "MEMBER"));
    projectService.addMember(ownerId, key, new AddMemberRequest(soonId, "MEMBER"));
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** USER 역할의 활성 사람 계정. */
  long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  /** 구성요소 시드(관리 API 는 Task 2 가 검증했으므로 여기선 직접 넣는다). */
  long component(String name, Long assigneeId) {
    return dsl.insertInto(com.workplace.jooq.Tables.PROJECT_COMPONENT)
        .set(com.workplace.jooq.Tables.PROJECT_COMPONENT.PROJECT_ID, projectId)
        .set(com.workplace.jooq.Tables.PROJECT_COMPONENT.NAME, name)
        .set(com.workplace.jooq.Tables.PROJECT_COMPONENT.DEFAULT_ASSIGNEE_ID, assigneeId)
        .returning(com.workplace.jooq.Tables.PROJECT_COMPONENT.ID)
        .fetchOne()
        .getId();
  }

  /** 구성요소 보관. */
  void archive(long componentId) {
    dsl.execute("UPDATE project_component SET archived_at = now() WHERE id = ?", componentId);
  }

  /** POST /issues — 본문 필드를 그대로 싣는다(제목은 필수라 기본값을 넣는다). */
  ResultActions createIssue(long caller, Map<String, Object> fields) throws Exception {
    var body = new LinkedHashMap<String, Object>();
    body.put("title", "구성요소 이슈");
    body.putAll(fields);
    return call(
        post("/api/v1/projects/" + key + "/issues").content(om.writeValueAsString(body)), caller);
  }

  /** 만들어진 이슈 번호·id. */
  JsonNode createdIssue(long caller, Map<String, Object> fields) throws Exception {
    return json(createIssue(caller, fields).andExpect(status().isOk()));
  }

  /** PUT /issues/{number}/components. */
  ResultActions replaceComponents(long caller, int number, List<Long> ids) throws Exception {
    return call(
        put("/api/v1/projects/" + key + "/issues/" + number + "/components")
            .content(om.writeValueAsString(Map.of("componentIds", ids))),
        caller);
  }

  /** 이슈의 이력 중 한 유형의 payload(to_value) 목록, 기록 순. */
  List<JsonNode> history(long issueId, String eventType) {
    return dsl
        .fetch(
            "SELECT to_value FROM issue_history WHERE issue_id = ? AND event_type = ? ORDER BY id",
            issueId,
            eventType)
        .stream()
        .map(
            r -> {
              try {
                return om.readTree(r.get("to_value", String.class));
              } catch (Exception e) {
                throw new IllegalStateException(e);
              }
            })
        .toList();
  }

  ResultActions call(MockHttpServletRequestBuilder req, long caller) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L))
        .contentType(MediaType.APPLICATION_JSON);
    ResultActions r = mvc.perform(req);
    // 요청 처리가 지우는 테넌트 문맥을 다시 심는다.
    TenantContext.set(1L);
    return r;
  }

  JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }
}
