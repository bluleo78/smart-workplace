package com.workplace.issue;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
 * WP-887 관계 유형 조회·관리 API — 로그인 사용자 목록, 관리자 추가·편집·숨김·삭제(옮기기·함께 삭제), 권한·상한·기본 유형 보호.
 *
 * <p>관계·외부 링크 행은 아직 추가 API 가 없어 SQL 로 직접 넣는다. @Transactional 이라 MockMvc 요청이 같은 스레드의 테스트 트랜잭션에 합류해
 * 시드를 보고, 끝나면 모두 롤백된다.
 */
@Transactional
class IssueRelationTypeApiTest extends IntegrationTestBase {

  private static final String PUBLIC_PATH = "/api/v1/issue-relation-types";
  private static final String ADMIN_PATH = "/api/v1/admin/issue-relation-types";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired AgentApiKeyService agentKeyService;
  @Autowired IssueRepository issueRepository;

  private long adminId;
  private long userId;
  private long agentId;
  private long projectId;
  private int nextNumber = 1;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    adminId = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, adminId, "ADMIN");
    userId = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, userId, "USER");
    agentId = createAgentUserWithMembership("relagent");
    String key = "RT" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectId = projectService.create(adminId, new CreateProjectRequest(key, "관계유형", "x")).id();
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ── 목록 ────────────────────────────────────────────────────────────────────────────────

  /** 일반 사용자도 목록을 본다 — 기본 유형이 정렬 순으로, 원인의 말은 「원인임」/「결과임」. */
  @Test
  void listReturnsBuiltInsInOrder() throws Exception {
    JsonNode list = json(call(get(PUBLIC_PATH), userId).andExpect(status().isOk()));

    List<String> codes = new ArrayList<>();
    list.forEach(n -> codes.add(n.get("code").isNull() ? null : n.get("code").asText()));
    assertThat(codes)
        .startsWith("BLOCKS", "RELATES", "DUPLICATES", "CLONES", "CAUSES", "PARENT_EPIC");
    JsonNode causes = byCode(list, "CAUSES");
    assertThat(causes.get("outwardLabel").asText()).isEqualTo("원인임");
    assertThat(causes.get("inwardLabel").asText()).isEqualTo("결과임");
    assertThat(causes.get("directed").asBoolean()).isTrue();
    assertThat(byCode(list, "PARENT_EPIC").get("externalOnly").asBoolean()).isTrue();
    assertThat(byCode(list, "RELATES").get("inwardLabel").isNull()).isTrue();
  }

  /** 로그인하지 않으면 401. */
  @Test
  void listRequiresLogin() throws Exception {
    mvc.perform(get(PUBLIC_PATH)).andExpect(status().isUnauthorized());
    TenantContext.set(1L);
  }

  // ── 추가·편집·숨김 ─────────────────────────────────────────────────────────────────────

  /** 추가(목록 끝, sortOrder 1000) → 이름 수정 → 숨김 — 목록에 반영된다. */
  @Test
  void adminCrudCustomType() throws Exception {
    JsonNode created =
        json(
            call(post(ADMIN_PATH).content(save("테스트", true, "테스트함", "테스트됨")), adminId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sortOrder").value(1000))
                .andExpect(jsonPath("$.code").doesNotExist())
                .andExpect(jsonPath("$.hidden").value(false)));
    long id = created.get("id").asLong();

    JsonNode list = json(call(get(PUBLIC_PATH), userId));
    assertThat(list.get(list.size() - 1).get("id").asLong()).isEqualTo(id);

    call(put(ADMIN_PATH + "/" + id).content(save("테스트2", true, "A함", "B됨")), adminId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("테스트2"))
        .andExpect(jsonPath("$.outwardLabel").value("A함"))
        .andExpect(jsonPath("$.inwardLabel").value("B됨"));

    call(put(ADMIN_PATH + "/" + id + "/hidden").content("{\"hidden\":true}"), adminId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.hidden").value(true));
    JsonNode after = json(call(get(PUBLIC_PATH), userId));
    JsonNode row = byId(after, id);
    assertThat(row.get("hidden").asBoolean()).isTrue();
    assertThat(row.get("name").asText()).isEqualTo("테스트2");

    assertThat(auditCount("ISSUE_RELATION_TYPE_CREATED", id)).isEqualTo(1);
    assertThat(auditCount("ISSUE_RELATION_TYPE_UPDATED", id)).isEqualTo(1);
    assertThat(auditCount("ISSUE_RELATION_TYPE_HIDDEN", id)).isEqualTo(1);
  }

  /** 방향 없는 유형은 B 쪽 말을 버리고(NULL), 방향 있는 유형은 B 쪽 말이 필수다. */
  @Test
  void directionRulesForInwardLabel() throws Exception {
    call(post(ADMIN_PATH).content(save("무방향", false, "함께", "무시될 말")), adminId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.inwardLabel").doesNotExist());
    call(post(ADMIN_PATH).content(save("유방향", true, "앞", " ")), adminId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("RELATION_TYPE_INWARD_LABEL_REQUIRED"));
    call(post(ADMIN_PATH).content(save(" ", false, "앞", null)), adminId)
        .andExpect(status().isBadRequest());
  }

  /** 관리 API 는 일반 사용자·AI(JWT 와 ak_ 키 둘 다)에 403 — 관리자 목록·추가·숨김·삭제 모두. AI 는 목록은 볼 수 있다. */
  @Test
  void nonAdminForbidden() throws Exception {
    String aiKey =
        "Bearer "
            + agentKeyService
                .issue(adminId, agentId, new IssueAgentKeyRequest("rel"))
                .plaintextKey();
    TenantContext.set(1L);
    List<String> callers =
        List.of(
            bearer(userId),
            bearer(agentId), // AI 구성원이 사용자 토큰으로 부를 때
            aiKey); // AI 에이전트 ak_ 키
    for (String auth : callers) {
      callRaw(get(ADMIN_PATH), auth).andExpect(status().isForbidden());
      callRaw(post(ADMIN_PATH).content(save("x", false, "x", null)), auth)
          .andExpect(status().isForbidden());
      callRaw(put(ADMIN_PATH + "/1/hidden").content("{\"hidden\":true}"), auth)
          .andExpect(status().isForbidden());
      callRaw(delete(ADMIN_PATH + "/1"), auth).andExpect(status().isForbidden());
      // 공개 목록은 열려 있다.
      callRaw(get(PUBLIC_PATH), auth).andExpect(status().isOk());
    }
  }

  /** 이름 중복은 대소문자 무시, 기본 유형 이름(「관련」)도 막는다. */
  @Test
  void nameTakenIncludingBuiltIn() throws Exception {
    call(post(ADMIN_PATH).content(save("관련", false, "x", null)), adminId)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("RELATION_TYPE_NAME_TAKEN"));

    call(post(ADMIN_PATH).content(save("Sample", false, "x", null)), adminId)
        .andExpect(status().isOk());
    call(post(ADMIN_PATH).content(save("sAMPLE", false, "y", null)), adminId)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("RELATION_TYPE_NAME_TAKEN"));

    // 편집으로 다른 유형의 이름과 겹쳐도 409, 자기 이름 그대로는 허용.
    long other = createCustom("다른", false, "x", null);
    call(put(ADMIN_PATH + "/" + other).content(save("SAMPLE", false, "x", null)), adminId)
        .andExpect(status().isConflict());
    call(put(ADMIN_PATH + "/" + other).content(save("다른", false, "말만 바꿈", null)), adminId)
        .andExpect(status().isOk());
  }

  /** 기본 유형은 편집·삭제 400, 차단 숨김 400, 관련 숨김은 200. */
  @Test
  void builtInImmutable() throws Exception {
    long relates = typeId("RELATES");
    long blocks = typeId("BLOCKS");
    call(put(ADMIN_PATH + "/" + relates).content(save("바꿈", false, "x", null)), adminId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("RELATION_TYPE_BUILT_IN"));
    call(delete(ADMIN_PATH + "/" + relates), adminId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("RELATION_TYPE_BUILT_IN"));
    call(put(ADMIN_PATH + "/" + blocks + "/hidden").content("{\"hidden\":true}"), adminId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("RELATION_TYPE_BLOCKS_LOCKED"));
    call(put(ADMIN_PATH + "/" + relates + "/hidden").content("{\"hidden\":true}"), adminId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.hidden").value(true));
  }

  /** 숨김 본문의 hidden 은 필수 — 빈 본문 {} 이 조용히 숨김 해제(false)로 읽히지 않고 400, 유형은 그대로. */
  @Test
  void setHiddenRequiresField() throws Exception {
    long relates = typeId("RELATES");
    call(put(ADMIN_PATH + "/" + relates + "/hidden").content("{\"hidden\":true}"), adminId)
        .andExpect(status().isOk());
    call(put(ADMIN_PATH + "/" + relates + "/hidden").content("{}"), adminId)
        .andExpect(status().isBadRequest());
    call(put(ADMIN_PATH + "/" + relates + "/hidden").content("{\"hidden\":null}"), adminId)
        .andExpect(status().isBadRequest());
    assertThat(dsl.fetchValue("SELECT hidden FROM issue_relation_type WHERE id = ?", relates))
        .isEqualTo(true);
  }

  /** 사용자 정의 유형은 50개까지 — 51번째는 400. */
  @Test
  void limitFifty() throws Exception {
    dsl.execute(
        "INSERT INTO issue_relation_type (name, directed, outward_label, sort_order)"
            + " SELECT 'seed-' || g, false, 'x', 1000 FROM generate_series(1, 50) g");
    call(post(ADMIN_PATH).content(save("오십일", false, "x", null)), adminId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("RELATION_TYPE_LIMIT"));
  }

  /** 쓰이는 유형은 방향을 못 바꾸고(409), 이름·말은 바꾼다. */
  @Test
  void directionLockedWhenUsed() throws Exception {
    long type = createCustom("방향잠금", true, "앞", "뒤");
    insertRelation(type, newIssue(), newIssue());

    call(put(ADMIN_PATH + "/" + type).content(save("방향잠금", false, "앞", null)), adminId)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("RELATION_TYPE_DIRECTION_LOCKED"));
    call(put(ADMIN_PATH + "/" + type).content(save("이름바꿈", true, "새앞", "새뒤")), adminId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.name").value("이름바꿈"))
        .andExpect(jsonPath("$.inwardLabel").value("새뒤"));
  }

  /** 쓰이지 않는 방향은 바꾼다 — 방향 없음으로 바꾸면 B 쪽 말은 비워진다. */
  @Test
  void directionChangeWhenUnused() throws Exception {
    long type = createCustom("방향변경", true, "앞", "뒤");
    call(put(ADMIN_PATH + "/" + type).content(save("방향변경", false, "함께", null)), adminId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.directed").value(false))
        .andExpect(jsonPath("$.inwardLabel").doesNotExist());
  }

  // ── 관리자 목록 건수 ───────────────────────────────────────────────────────────────────

  /** 관리자 목록은 유형별 내부 관계·외부 링크 건수를 싣고, 차단은 issue_dependency 건수다. */
  @Test
  void adminListCounts() throws Exception {
    long type = createCustom("건수", true, "앞", "뒤");
    long a = newIssue();
    long b = newIssue();
    insertRelation(type, a, b);
    insertExternalLink(type, a, "https://example.com/1", true);
    insertExternalLink(type, b, "https://example.com/2", false);
    dsl.execute(
        "INSERT INTO issue_dependency (issue_id, blocks_issue_id, created_by) VALUES (?, ?, ?)",
        a,
        b,
        adminId);

    JsonNode list = json(call(get(ADMIN_PATH), adminId).andExpect(status().isOk()));
    JsonNode row = byId(list, type);
    assertThat(row.get("relationCount").asLong()).isEqualTo(1);
    assertThat(row.get("externalLinkCount").asLong()).isEqualTo(2);
    assertThat(byCode(list, "BLOCKS").get("relationCount").asLong()).isGreaterThanOrEqualTo(1);
    assertThat(byCode(list, "RELATES").get("relationCount").asLong()).isZero();
  }

  // ── 삭제 ────────────────────────────────────────────────────────────────────────────────

  /** 쓰이지 않는 유형은 바로 삭제(204)되고 목록에서 사라진다. */
  @Test
  void deleteUnusedType() throws Exception {
    long type = createCustom("지움", false, "x", null);
    call(delete(ADMIN_PATH + "/" + type), adminId).andExpect(status().isNoContent());
    assertThat(byIdOrNull(json(call(get(PUBLIC_PATH), userId)), type)).isNull();
    assertThat(auditCount("ISSUE_RELATION_TYPE_DELETED", type)).isEqualTo(1);
  }

  /** 없는 유형은 404. */
  @Test
  void deleteMissingIs404() throws Exception {
    call(delete(ADMIN_PATH + "/999999999"), adminId)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("RELATION_TYPE_NOT_FOUND"));
  }

  /** 쓰이는데 moveTo·deleteLinks 둘 다 없으면 409 — 관계가 지워지지 않는다. */
  @Test
  void deleteInUseRequiresChoice() throws Exception {
    long type = createCustom("사용중", true, "앞", "뒤");
    insertRelation(type, newIssue(), newIssue());

    call(delete(ADMIN_PATH + "/" + type), adminId)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("RELATION_TYPE_IN_USE"));
    assertThat(relationCount(type)).isEqualTo(1);
  }

  /**
   * 방향 있는 유형(A→B, B→A 관계 2건 + 외부 링크 1건)을 방향 없는 관련으로 옮기면 한 쌍으로 합쳐지고(min,max), 외부 링크는 관련으로 옮겨지며 유형이
   * 지워지고 감사 로그에 moved=3 이 남는다.
   */
  @Test
  void deleteMoveToSymmetricDedupes() throws Exception {
    long type = createCustom("양방향옮김", true, "앞", "뒤");
    long relates = typeId("RELATES");
    long a = newIssue();
    long b = newIssue();
    insertRelation(type, a, b);
    insertRelation(type, b, a);
    insertExternalLink(type, a, "https://example.com/x", false);

    call(delete(ADMIN_PATH + "/" + type + "?moveTo=" + relates), adminId)
        .andExpect(status().isNoContent());

    List<long[]> rows = relationsOf(relates);
    assertThat(rows).hasSize(1);
    assertThat(rows.get(0)).containsExactly(Math.min(a, b), Math.max(a, b));
    Map<String, Object> link =
        dsl.fetchOne(
                "SELECT type_id, issue_is_source FROM issue_external_link WHERE issue_id = ?", a)
            .intoMap();
    assertThat(((Number) link.get("type_id")).longValue()).isEqualTo(relates);
    assertThat(link.get("issue_is_source")).isEqualTo(true);
    assertThat(typeExists(type)).isFalse();

    var audit = auditRows("ISSUE_RELATION_TYPE_DELETED", type);
    assertThat(audit).hasSize(1);
    JsonNode meta = om.readTree(audit.get(0).getMetadata().data());
    // 관계 2건은 한 쌍으로 합쳐져 1건 + 외부 링크 1건 = 실제 바뀐 행 2건.
    assertThat(meta.get("moved").asLong()).isEqualTo(2);
    assertThat(meta.get("moveTo").asLong()).isEqualTo(relates);
  }

  /** 방향 없는 유형의 관계는 방향 있는 유형으로 옮길 수 없다(400) — 아무것도 바뀌지 않는다. 방향 있는 → 없는은 위 테스트처럼 된다. */
  @Test
  void deleteMoveUndirectedToDirectedRejected() throws Exception {
    long from = createCustom("방향없음원본", false, "그냥", null);
    long to = createCustom("방향있음대상", true, "앞", "뒤");
    insertRelation(from, newIssue(), newIssue());

    call(delete(ADMIN_PATH + "/" + from + "?moveTo=" + to), adminId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("RELATION_TYPE_MOVE_DIRECTION"));
    assertThat(relationCount(from)).isEqualTo(1);
    assertThat(typeExists(from)).isTrue();
  }

  /** 방향 있는 유형끼리 옮기면 A→B 순서를 그대로 유지한다. */
  @Test
  void deleteMoveToDirectedKeepsOrder() throws Exception {
    long from = createCustom("옮길것", true, "앞", "뒤");
    long to = createCustom("옮겨질곳", true, "앞2", "뒤2");
    long a = newIssue();
    long b = newIssue();
    // 큰 id 가 A 쪽(source)인 관계 — 순서가 뒤집히지 않아야 한다.
    long big = Math.max(a, b);
    long small = Math.min(a, b);
    insertRelation(from, big, small);

    call(delete(ADMIN_PATH + "/" + from + "?moveTo=" + to), adminId)
        .andExpect(status().isNoContent());

    List<long[]> rows = relationsOf(to);
    assertThat(rows).hasSize(1);
    assertThat(rows.get(0)).containsExactly(big, small);
  }

  /** 대상에 같은 쌍이 이미 있으면 하나로 합친다(대상 건수 불변). */
  @Test
  void deleteMoveToMergesExistingPair() throws Exception {
    long from = createCustom("합침원본", true, "앞", "뒤");
    long to = createCustom("합침대상", true, "앞2", "뒤2");
    long a = newIssue();
    long b = newIssue();
    insertRelation(from, a, b);
    insertRelation(to, a, b);

    call(delete(ADMIN_PATH + "/" + from + "?moveTo=" + to), adminId)
        .andExpect(status().isNoContent());

    assertThat(relationsOf(to)).hasSize(1);
  }

  /** deleteLinks=true 면 관계·외부 링크가 모두 지워지고 유형도 지워진다. */
  @Test
  void deleteWithLinks() throws Exception {
    long type = createCustom("함께삭제", true, "앞", "뒤");
    long a = newIssue();
    insertRelation(type, a, newIssue());
    insertExternalLink(type, a, "https://example.com/del", true);

    call(delete(ADMIN_PATH + "/" + type + "?deleteLinks=true"), adminId)
        .andExpect(status().isNoContent());

    assertThat(relationCount(type)).isZero();
    assertThat(
            dsl.fetchCount(dsl.selectOne().from("issue_external_link").where("type_id = ?", type)))
        .isZero();
    assertThat(typeExists(type)).isFalse();
    var audit = auditRows("ISSUE_RELATION_TYPE_DELETED", type);
    assertThat(om.readTree(audit.get(0).getMetadata().data()).get("deleted").asLong()).isEqualTo(2);
  }

  /** 옮길 대상이 차단·외부 전용·숨김·자기 자신·없음이거나 deleteLinks 와 동시 지정이면 400 — 아무것도 지워지지 않는다. */
  @Test
  void badMoveTarget() throws Exception {
    long type = createCustom("옮김실패", true, "앞", "뒤");
    long hiddenType = createCustom("숨김대상", false, "x", null);
    call(put(ADMIN_PATH + "/" + hiddenType + "/hidden").content("{\"hidden\":true}"), adminId)
        .andExpect(status().isOk());
    insertRelation(type, newIssue(), newIssue());

    for (long target :
        new long[] {typeId("BLOCKS"), typeId("PARENT_EPIC"), hiddenType, type, 999999999L}) {
      call(delete(ADMIN_PATH + "/" + type + "?moveTo=" + target), adminId)
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.errors.code").value("RELATION_TYPE_BAD_MOVE_TARGET"));
    }
    call(
            delete(ADMIN_PATH + "/" + type + "?moveTo=" + typeId("RELATES") + "&deleteLinks=true"),
            adminId)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("RELATION_TYPE_BAD_MOVE_TARGET"));

    assertThat(typeExists(type)).isTrue();
    assertThat(relationCount(type)).isEqualTo(1);
  }

  // ── 도우미 ──────────────────────────────────────────────────────────────────────────────

  /** 사용자 JWT(테넌트 1)로 JSON 요청을 보낸다. */
  private ResultActions call(MockHttpServletRequestBuilder req, long caller) throws Exception {
    return callRaw(req, bearer(caller));
  }

  private String bearer(long caller) {
    return "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L);
  }

  /** Authorization 헤더 값을 그대로 붙여 JSON 요청을 보낸다 — 요청 처리가 지우는 테넌트 문맥을 다시 심는다. */
  private ResultActions callRaw(MockHttpServletRequestBuilder req, String authorization)
      throws Exception {
    req.header("Authorization", authorization).contentType(MediaType.APPLICATION_JSON);
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }

  private String save(String name, boolean directed, String out, String in) throws Exception {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("name", name);
    m.put("directed", directed);
    m.put("outwardLabel", out);
    m.put("inwardLabel", in);
    return om.writeValueAsString(m);
  }

  private long createCustom(String name, boolean directed, String out, String in) throws Exception {
    return json(call(post(ADMIN_PATH).content(save(name, directed, out, in)), adminId)
            .andExpect(status().isOk()))
        .get("id")
        .asLong();
  }

  private JsonNode byCode(JsonNode list, String code) {
    for (JsonNode n : list) {
      if (!n.get("code").isNull() && code.equals(n.get("code").asText())) {
        return n;
      }
    }
    throw new AssertionError("code not found: " + code);
  }

  private JsonNode byIdOrNull(JsonNode list, long id) {
    for (JsonNode n : list) {
      if (n.get("id").asLong() == id) {
        return n;
      }
    }
    return null;
  }

  private JsonNode byId(JsonNode list, long id) {
    JsonNode n = byIdOrNull(list, id);
    assertThat(n).as("type %s in list", id).isNotNull();
    return n;
  }

  private long typeId(String code) {
    return dsl.fetchValue("SELECT id FROM issue_relation_type WHERE code = ?", code)
            instanceof Number n
        ? n.longValue()
        : -1;
  }

  private boolean typeExists(long id) {
    return dsl.fetchExists(dsl.selectOne().from("issue_relation_type").where("id = ?", id));
  }

  private long newIssue() {
    return IssueSeeds.insert(
            issueRepository,
            dsl,
            projectId,
            nextNumber++,
            "이슈" + nextNumber,
            null,
            "MID",
            null,
            adminId)
        .id();
  }

  private void insertRelation(long typeId, long source, long target) {
    dsl.execute(
        "INSERT INTO issue_relation (type_id, source_issue_id, target_issue_id, created_by)"
            + " VALUES (?, ?, ?, ?)",
        typeId,
        source,
        target,
        adminId);
  }

  private void insertExternalLink(long typeId, long issueId, String url, boolean isSource) {
    dsl.execute(
        "INSERT INTO issue_external_link (issue_id, type_id, issue_is_source, url, title,"
            + " created_by) VALUES (?, ?, ?, ?, '외부', ?)",
        issueId,
        typeId,
        isSource,
        url,
        adminId);
  }

  private long relationCount(long typeId) {
    return dsl.fetchCount(dsl.selectOne().from("issue_relation").where("type_id = ?", typeId));
  }

  /** 유형의 관계를 {source, target} 쌍으로 읽는다. */
  private List<long[]> relationsOf(long typeId) {
    return dsl.fetch(
            "SELECT source_issue_id, target_issue_id FROM issue_relation WHERE type_id = ?", typeId)
        .map(r -> new long[] {r.get(0, Long.class), r.get(1, Long.class)});
  }

  private List<com.workplace.jooq.tables.records.AuditLogRecord> auditRows(
      String actionType, long typeId) {
    return dsl.selectFrom(AUDIT_LOG)
        .where(AUDIT_LOG.ACTION_TYPE.eq(actionType))
        .and(AUDIT_LOG.RESOURCE.eq("issue_relation_type"))
        .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(typeId)))
        .fetch();
  }

  private int auditCount(String actionType, long typeId) {
    return auditRows(actionType, typeId).size();
  }
}
