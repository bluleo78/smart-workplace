package com.workplace.issue;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE_DEPENDENCY;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_RELATION;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.outbound.AgentToolWriteEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCreatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssuePriorityChangedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.issue.outbound.IssueHumanReplyPosted;
import com.workplace.issue.service.IssueService;
import com.workplace.notify.push.InboxPushRequestedEvent;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.support.TestFixtures;
import com.workplace.user.dto.AgentRuntime;
import com.workplace.watcher.outbound.WatcherDomainEvents.WatcherAddedEvent;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 가져오기의 관계 부분(WP-887) — 가져오기 요청의 외부 링크, 관계 일괄 호출(전부 아니면 무·멱등·차단 순환·숨긴 유형·관리자 전용), 이력·알림이 없는지.
 *
 * <p>@Transactional 이라 AFTER_COMMIT 비동기 리스너는 돌지 않는다 — 알림을 만드는 원인 이벤트가 발행되지 않았음을 {@link
 * RecordApplicationEvents} 로 단언한다. 프로젝트는 TEAM 한 개(admin 이 가져올 곳)와 OPEN 한 개(다른 프로젝트 쪽 상대).
 */
@Transactional
@RecordApplicationEvents
class IssueImportRelationsTest extends IssueImportTestSupport {

  @Autowired ApplicationEvents events;
  @Autowired IssueService issueService;
  @Autowired JwtTokenProvider jwt;
  @Autowired AiAgentCredentialService credentialService;

  /** 시드 프로젝트의 이슈 번호 — n[0] 이 #1 번째로 만든 이슈. */
  private final List<Integer> n = new ArrayList<>();

  private String otherKey;
  private int otherNumber;

  @BeforeEach
  void seed() {
    seedProject("RI", "관계 가져오기");
    for (int i = 1; i <= 6; i++) {
      n.add(newIssue(key, "이슈 " + i));
    }
    otherKey = "RO" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    projectService.create(owner, new CreateProjectRequest(otherKey, "다른 프로젝트", "x", "OPEN"));
    otherNumber = newIssue(otherKey, "다른 프로젝트 이슈");
  }

  // ── 외부 링크 ───────────────────────────────────────────────────────────────────────────

  /** 가져오기 요청의 외부 링크 2개 — 상세에 2개, 이슈 이력엔 아무것도 남지 않는다. */
  @Test
  void importIssueWithExternalLinks() throws Exception {
    Map<String, Object> m = body("외부 링크 이슈");
    m.put(
        "externalLinks",
        List.of(
            link("PARENT_EPIC", null, "https://jira.example.com/browse/CL-1", "CL-1", "에픽"),
            link("RELATES", "source", "https://jira.example.com/browse/CL-2", "CL-2", "관련 건")));

    int number = numberOf(importAs(admin, m).andExpect(status().isCreated()));

    JsonNode links = detail(admin, key, number).get("externalLinks");
    assertThat(links).hasSize(2);
    assertThat(links.get(0).get("typeCode").asText()).isEqualTo("RELATES");
    assertThat(links.get(1).get("typeCode").asText()).isEqualTo("PARENT_EPIC");
    assertThat(links.get(1).get("label").asText()).isEqualTo("에픽에 속함");
    assertThat(dsl.fetchCount(ISSUE_HISTORY, ISSUE_HISTORY.ISSUE_ID.eq(issueId(number)))).isZero();
  }

  /** 모르는 유형·http 아닌 주소는 이슈를 만들기 전에 400 — 이슈가 남지 않는다. */
  @Test
  void importIssueWithBadExternalLinkIs400() throws Exception {
    int before = issueCount();
    Map<String, Object> unknown = body("모르는 유형");
    unknown.put("externalLinks", List.of(link("없는유형", null, "https://x.example.com/1", null, "t")));
    importAs(admin, unknown)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_UNKNOWN_RELATION_TYPE"));

    Map<String, Object> script = body("나쁜 주소");
    script.put("externalLinks", List.of(link("RELATES", null, "javascript:alert(1)", null, "t")));
    importAs(admin, script).andExpect(status().isBadRequest());
    assertThat(issueCount()).isEqualTo(before);

    // 상대 쪽 말이 없는 상위 에픽을 target 으로 — 가져오기 오류(errors.reason)로, 이슈를 만들기 전에 막힌다.
    Map<String, Object> epicTarget = body("에픽 반대 방향");
    epicTarget.put(
        "externalLinks",
        List.of(
            link("PARENT_EPIC", "target", "https://jira.example.com/browse/CL-9", "CL-9", "t")));
    importAs(admin, epicTarget)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_RELATION_SIDE_NOT_ALLOWED"));
    assertThat(issueCount()).isEqualTo(before);
  }

  /** 외부 링크 제목이 보이지 않는 글자(제로폭 공백·한글 채움)뿐이면 공백만일 때처럼 이슈를 만들기 전에 400 (WP-1107). */
  @Test
  void importExternalLinkWithInvisibleOnlyTitleIs400() throws Exception {
    int before = issueCount();
    Map<String, Object> invisible = body("보이지 않는 제목");
    invisible.put(
        "externalLinks",
        List.of(link("RELATES", null, "https://x.example.com/1", null, "\u200B\u3164")));
    importAs(admin, invisible).andExpect(status().isBadRequest());
    assertThat(issueCount()).isEqualTo(before);
  }

  /** 같은 주소가 다른 유형·방향으로 두 번이면 이슈를 만들기 전에 400, 같은 유형·방향이면 건너뛰고 만든다. */
  @Test
  void duplicateExternalLinkUrlWithDifferentTypeIs400() throws Exception {
    int before = issueCount();
    String url = "https://jira.example.com/browse/CL-77";
    Map<String, Object> m = body("중복 외부 링크");
    m.put(
        "externalLinks",
        List.of(link("RELATES", null, url, "CL-77", "a"), link("CAUSES", null, url, "CL-77", "b")));
    importAs(admin, m)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_DUPLICATE_EXTERNAL_LINK"))
        .andExpect(jsonPath("$.errors.url").value(url));
    assertThat(issueCount()).isEqualTo(before);

    Map<String, Object> same = body("같은 외부 링크 두 줄");
    same.put(
        "externalLinks",
        List.of(
            link("RELATES", null, url, "CL-77", "a"), link("RELATES", null, url, "CL-77", "a")));
    int number = numberOf(importAs(admin, same).andExpect(status().isCreated()));
    assertThat(detail(admin, key, number).get("externalLinks")).hasSize(1);
  }

  // ── 관계 일괄 ───────────────────────────────────────────────────────────────────────────

  /** 다섯 유형 각 1줄 + 다른 프로젝트 1줄 — 6건, 차단은 blockedBy 에 보이고 이력·알림은 없다. */
  @Test
  void importRelationsCreatesAll() throws Exception {
    long historyBefore = dsl.fetchCount(ISSUE_HISTORY);
    events.clear();

    JsonNode res = relationsOk(admin, sixRows());

    assertThat(res.get("created").asInt()).isEqualTo(6);
    assertThat(res.get("skipped").asInt()).isZero();
    assertThat(
            dsl.fetchCount(
                ISSUE_RELATION,
                ISSUE_RELATION.TYPE_ID.in(types("RELATES", "CAUSES", "CLONES", "DUPLICATES"))))
        .isEqualTo(5);
    JsonNode blocked = detail(admin, key, n.get(5)).get("summary").get("blockedBy");
    assertThat(blocked).hasSize(1);
    assertThat(blocked.get(0).get("number").asInt()).isEqualTo(n.get(4));
    assertThat(detail(admin, otherKey, otherNumber).get("relations")).hasSize(1);

    assertThat(dsl.fetchCount(ISSUE_HISTORY)).isEqualTo(historyBefore);
    for (Class<?> c :
        List.of(
            IssueCreatedEvent.class,
            IssueAssignedEvent.class,
            IssueCommentedEvent.class,
            IssueStatusChangedEvent.class,
            IssuePriorityChangedEvent.class,
            WatcherAddedEvent.class,
            AgentToolWriteEvent.class,
            IssueHumanReplyPosted.class,
            InboxPushRequestedEvent.class)) {
      assertThat(events.stream(c).count()).as(c.getSimpleName()).isZero();
    }
    // 화면 갱신은 관계가 생긴 프로젝트마다 한 번(이 프로젝트 + 다른 프로젝트).
    assertThat(events.stream(ResourceChangedEvent.class).count()).isEqualTo(2);
    assertThat(dsl.fetchCount(NOTIFICATION)).isZero();
    assertThat(dsl.fetchCount(AGENT_WORK)).isZero();
  }

  /** 같은 요청을 두 번 — 두 번째는 전부 건너뜀. 한 요청 안 (1,2)·(2,1) 은 1건 + 건너뜀 1건. */
  @Test
  void importRelationsIdempotentAndDuplicateRows() throws Exception {
    relationsOk(admin, sixRows());
    events.clear();
    JsonNode again = relationsOk(admin, sixRows());
    assertThat(again.get("created").asInt()).isZero();
    assertThat(again.get("skipped").asInt()).isEqualTo(6);
    assertThat(events.stream(ResourceChangedEvent.class).count()).isZero();

    // 방향 없는 유형 — 뒤집힌 쌍도 같은 관계. 이 이슈 둘은 위 요청이 쓰지 않은 쌍이다.
    JsonNode dup =
        relationsOk(
            admin,
            List.of(
                row("RELATES", n.get(2), n.get(0), null),
                row("RELATES", n.get(0), n.get(2), null)));
    assertThat(dup.get("created").asInt()).isEqualTo(1);
    assertThat(dup.get("skipped").asInt()).isEqualTo(1);
  }

  /** 6줄 중 5번째가 없는 번호 — 400, 틀린 줄 목록, 관계 0건. */
  @Test
  void allOrNothing() throws Exception {
    List<Map<String, Object>> rows = sixRows();
    rows.set(4, row("BLOCKS", n.get(4), 999, null));

    ResultActions r =
        relations(admin, key, rows)
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors.reason").value("IMPORT_INVALID_RELATIONS"));
    JsonNode errs = objectMapper.readTree(json(r).get("errors").get("rows").asText());
    assertThat(errs).hasSize(1);
    assertThat(errs.get(0).get("index").asInt()).isEqualTo(4);
    assertThat(errs.get(0).get("reason").asText()).isNotBlank();
    assertThat(dsl.fetchCount(ISSUE_RELATION, ISSUE_RELATION.SOURCE_ISSUE_ID.eq(issueId(n.get(0)))))
        .isZero();
    assertThat(dsl.fetchCount(ISSUE_DEPENDENCY, ISSUE_DEPENDENCY.ISSUE_ID.eq(issueId(n.get(4)))))
        .isZero();
  }

  /** 틀린 줄은 모두 알린다 — 유형·상대·형식 오류가 한 응답에. */
  @Test
  void reportsEveryInvalidRow() throws Exception {
    List<Map<String, Object>> rows =
        List.of(
            row("없는유형", n.get(0), n.get(1), null),
            row("PARENT_EPIC", n.get(0), n.get(1), null),
            row("RELATES", n.get(0), n.get(0), null),
            row("RELATES", n.get(0), null, "NOPE-1"),
            row("RELATES", n.get(0), n.get(1), "X-1"),
            row("RELATES", n.get(0), null, "bad key"),
            row("RELATES", n.get(0), n.get(1), null));
    ResultActions r = relations(admin, key, rows).andExpect(status().isBadRequest());
    JsonNode errs = objectMapper.readTree(json(r).get("errors").get("rows").asText());
    List<Integer> idx = new ArrayList<>();
    errs.forEach(e -> idx.add(e.get("index").asInt()));
    assertThat(idx).containsExactly(0, 1, 2, 3, 4, 5);
  }

  /** 차단 (1→2),(2→1) — 두 번째가 순환이라 400, 아무것도 안 쓴다. 이미 저장된 간선과 이어진 순환도 막는다. */
  @Test
  void blocksCycleRejected() throws Exception {
    ResultActions r =
        relations(
                admin,
                key,
                List.of(
                    row("BLOCKS", n.get(0), n.get(1), null),
                    row("BLOCKS", n.get(1), n.get(0), null)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors.reason").value("IMPORT_INVALID_RELATIONS"));
    JsonNode errs = objectMapper.readTree(json(r).get("errors").get("rows").asText());
    assertThat(errs).hasSize(1);
    assertThat(errs.get(0).get("index").asInt()).isEqualTo(1);
    assertThat(
            dsl.fetchCount(
                ISSUE_DEPENDENCY,
                ISSUE_DEPENDENCY.ISSUE_ID.in(issueId(n.get(0)), issueId(n.get(1)))))
        .isZero();

    // 저장된 간선 1→2 위에 새 요청의 2→3, 3→1 — 3→1 이 (저장 + 앞 줄) 순환.
    relationsOk(admin, List.of(row("BLOCKS", n.get(0), n.get(1), null)));
    relations(
            admin,
            key,
            List.of(
                row("BLOCKS", n.get(1), n.get(2), null), row("BLOCKS", n.get(2), n.get(0), null)))
        .andExpect(status().isBadRequest());
    // 같은 차단을 다시 보내면 건너뜀(순환 아님).
    JsonNode again = relationsOk(admin, List.of(row("BLOCKS", n.get(0), n.get(1), null)));
    assertThat(again.get("skipped").asInt()).isEqualTo(1);
  }

  /** 차단은 같은 프로젝트만 — 다른 프로젝트 toKey 는 그 줄 오류. */
  @Test
  void blocksCrossProjectRejected() throws Exception {
    relations(admin, key, List.of(row("BLOCKS", n.get(0), null, otherKey + "-" + otherNumber)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_INVALID_RELATIONS"));
  }

  /** 숨긴 유형도 가져오기는 쓴다. */
  @Test
  void hiddenTypeAllowed() throws Exception {
    dsl.execute("UPDATE issue_relation_type SET hidden = true WHERE code = 'RELATES'");
    JsonNode res = relationsOk(admin, List.of(row("RELATES", n.get(0), n.get(1), null)));
    assertThat(res.get("created").asInt()).isEqualTo(1);
  }

  /** 이슈 가져오기의 외부 링크도 숨긴 유형을 받는다. */
  @Test
  void hiddenTypeAllowedForExternalLink() throws Exception {
    dsl.execute("UPDATE issue_relation_type SET hidden = true WHERE code = 'RELATES'");
    Map<String, Object> m = body("숨긴 유형 링크");
    m.put(
        "externalLinks",
        List.of(link("RELATES", null, "https://jira.example.com/browse/CL-9", "CL-9", "t")));
    importAs(admin, m).andExpect(status().isCreated());
  }

  /** 관리자만 — 프로젝트 OWNER(비 ADMIN)·AI(ADMIN 이어도)는 403, 개인 프로젝트는 400. */
  @Test
  void adminOnly() throws Exception {
    List<Map<String, Object>> rows = List.of(row("RELATES", n.get(0), n.get(1), null));
    relations(owner, key, rows)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_ADMIN_ONLY"));

    long agent = TestFixtures.createAgentWithToken(dsl, credentialService, admin);
    TestFixtures.activeMemberOfCurrentTenant(dsl, agent);
    dsl.update(USER)
        .set(USER.AGENT_RUNTIME, AgentRuntime.EXTERNAL)
        .where(USER.ID.eq(agent))
        .execute();
    TestFixtures.grantRole(dsl, agent, "ADMIN");
    relations(agent, key, rows)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_ADMIN_ONLY"));

    var personal =
        projectService.create(admin, new CreateProjectRequest(null, "내 일", null, "PERSONAL"));
    relations(admin, personal.key(), rows)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_PERSONAL_PROJECT"));
    assertThat(dsl.fetchCount(ISSUE_RELATION, ISSUE_RELATION.SOURCE_ISSUE_ID.eq(issueId(n.get(0)))))
        .isZero();
  }

  // ── 도우미 ──────────────────────────────────────────────────────────────────────────────

  /** RELATES·CAUSES·CLONES·DUPLICATES·BLOCKS 각 1줄 + 다른 프로젝트 RELATES 1줄. */
  private List<Map<String, Object>> sixRows() {
    return new ArrayList<>(
        List.of(
            row("RELATES", n.get(0), n.get(1), null),
            row("CAUSES", n.get(1), n.get(2), null),
            row("CLONES", n.get(2), n.get(3), null),
            row("DUPLICATES", n.get(3), n.get(4), null),
            row("BLOCKS", n.get(4), n.get(5), null),
            row("RELATES", n.get(0), null, otherKey + "-" + otherNumber)));
  }

  private static Map<String, Object> row(String type, int from, Integer toNumber, String toKey) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("type", type);
    m.put("from", from);
    if (toNumber != null) m.put("toNumber", toNumber);
    if (toKey != null) m.put("toKey", toKey);
    return m;
  }

  private static Map<String, Object> link(
      String type, String side, String url, String linkKey, String title) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("type", type);
    if (side != null) m.put("side", side);
    m.put("url", url);
    if (linkKey != null) m.put("key", linkKey);
    m.put("title", title);
    return m;
  }

  private List<Long> types(String... codes) {
    return dsl.fetch("SELECT id FROM issue_relation_type WHERE code = ANY(?)", (Object) codes)
        .map(r -> ((Number) r.get(0)).longValue());
  }

  private int newIssue(String projectKey, String title) {
    return issueService
        .create(
            owner,
            projectKey,
            new CreateIssueRequest(title, null, null, null, null, null, null, null))
        .number();
  }

  private int issueCount() {
    return dsl.fetchCount(
        com.workplace.jooq.Tables.ISSUE, com.workplace.jooq.Tables.ISSUE.PROJECT_ID.eq(projectId));
  }

  /** 관계 일괄 호출 — 인증(issue:write 포함)을 붙이고 테넌트 문맥을 다시 심는다. */
  private ResultActions relations(long callerId, String projectKey, List<Map<String, Object>> rows)
      throws Exception {
    TenantContext.set(1L);
    var auth =
        new UsernamePasswordAuthenticationToken(
            callerId, "n/a", List.of(new SimpleGrantedAuthority("issue:write")));
    ResultActions r =
        mvc.perform(
            post("/api/v1/projects/" + projectKey + "/import/relations")
                .with(
                    org.springframework.security.test.web.servlet.request
                        .SecurityMockMvcRequestPostProcessors.authentication(auth))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("relations", rows))));
    TenantContext.set(1L);
    return r;
  }

  private JsonNode relationsOk(long callerId, List<Map<String, Object>> rows) throws Exception {
    return json(relations(callerId, key, rows).andExpect(status().isOk()));
  }

  private JsonNode detail(long caller, String projectKey, int number) throws Exception {
    ResultActions r =
        mvc.perform(
            get("/api/v1/projects/" + projectKey + "/issues/" + number)
                .header(
                    "Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L))
                .contentType(MediaType.APPLICATION_JSON));
    TenantContext.set(1L);
    return json(r.andExpect(status().isOk()));
  }

  private JsonNode json(ResultActions r) throws Exception {
    return objectMapper.readTree(r.andReturn().getResponse().getContentAsString());
  }
}
