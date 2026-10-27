package com.workplace.issue;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_RELATION;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.CreateIssueTypeRequest;
import com.workplace.issue.outbound.AgentToolWriteEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCreatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssuePriorityChangedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.issue.outbound.IssueHumanReplyPosted;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.service.IssueRelationService;
import com.workplace.issue.service.IssueService;
import com.workplace.issue.service.IssueTypeService;
import com.workplace.notify.push.InboxPushRequestedEvent;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.watcher.outbound.WatcherDomainEvents.WatcherAddedEvent;
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
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-887 이슈 사이 관계 — 걸기(같은·다른 프로젝트, A·B 쪽)·지우기(어느 쪽 팀이든 자기 이슈 주소로)·상세 목록·양쪽 이력·가림·찾기(lookup).
 *
 * <p>프로젝트 셋: WP(TEAM — alice 소유, reader 멤버), WPV(OPEN — bob 소유, 누구나 읽음). reader 는 WP 멤버이면서 OPEN 인
 * WPV 를 읽을 수 있다. @Transactional 이라 MockMvc 요청이 테스트 트랜잭션에 합류하고 끝나면 모두 롤백된다 — 그래서 알림은 AFTER_COMMIT
 * 리스너가 아니라 원인 이벤트가 발행되지 않았음을 {@link RecordApplicationEvents} 로 단언한다.
 */
@Transactional
@RecordApplicationEvents
class IssueRelationApiTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository memberRepository;
  @Autowired IssueService issueService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired ApplicationEvents events;
  @Autowired IssueRelationService relationService;
  @Autowired IssueHistoryRepository historyRepository;
  @Autowired ProjectRepository projectRepository;

  private long alice;
  private long reader;
  private long bob;
  private long outsider;
  private String wp;
  private long wpId;
  private String wpv;
  private long wpvId;

  /** WP 의 #1·#2, WPV 의 첫 이슈 번호. */
  private int wp1;

  private int wp2;
  private int wpv1;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    alice = user();
    reader = user();
    bob = user();
    outsider = user();
    wp = randomKey("RA");
    wpId = projectService.create(alice, new CreateProjectRequest(wp, "관계 WP", "x")).id();
    memberRepository.insert(wpId, reader, "MEMBER");
    wpv = randomKey("RB");
    wpvId = projectService.create(bob, new CreateProjectRequest(wpv, "관계 WPV", "x", "OPEN")).id();
    wp1 = newIssue(alice, wp, "WP 첫째");
    wp2 = newIssue(alice, wp, "WP 둘째");
    wpv1 = newIssue(bob, wpv, "WPV 첫째");
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ── 걸기·표시 ───────────────────────────────────────────────────────────────────────────

  /** 같은 프로젝트 RELATES — 응답·양쪽 상세 모두 「관련」, 이력은 두 이슈에 1건씩. */
  @Test
  void addRelatesSameProjectShowsOnBoth() throws Exception {
    JsonNode list =
        json(addRelation(alice, wp, wp1, "RELATES", null, null, wp2).andExpect(status().isOk()));
    assertThat(list).hasSize(1);
    assertThat(list.get(0).get("label").asText()).isEqualTo("관련");
    assertThat(list.get(0).get("typeCode").asText()).isEqualTo("RELATES");
    assertThat(list.get(0).get("issue").get("projectKey").asText()).isEqualTo(wp);
    assertThat(list.get(0).get("issue").get("number").asInt()).isEqualTo(wp2);
    assertThat(list.get(0).get("issue").get("title").asText()).isEqualTo("WP 둘째");
    assertThat(list.get(0).get("issue").get("type").get("name").isTextual()).isTrue();

    JsonNode d1 = detail(alice, wp, wp1);
    assertThat(d1.get("relations")).hasSize(1);
    assertThat(d1.get("relations").get(0).get("label").asText()).isEqualTo("관련");
    assertThat(d1.get("externalLinks")).isEmpty();
    JsonNode d2 = detail(alice, wp, wp2);
    assertThat(d2.get("relations").get(0).get("label").asText()).isEqualTo("관련");
    assertThat(d2.get("relations").get(0).get("issue").get("number").asInt()).isEqualTo(wp1);
    // 방향 없는 유형은 저장 쌍이 (작은 id, 큰 id) 여도 양쪽 모두 side=source — 화면이 한 묶음으로 그린다.
    assertThat(d1.get("relations").get(0).get("side").asText()).isEqualTo("source");
    assertThat(d2.get("relations").get(0).get("side").asText()).isEqualTo("source");

    assertThat(history(issueId(wpId, wp1), "RELATION_ADDED")).hasSize(1);
    assertThat(history(issueId(wpId, wp2), "RELATION_ADDED")).hasSize(1);
    JsonNode h1 = om.readTree(history(issueId(wpId, wp1), "RELATION_ADDED").get(0));
    assertThat(h1.get("typeId").asLong()).isEqualTo(typeId("RELATES"));
    assertThat(h1.get("label").asText()).isEqualTo("관련");
    assertThat(h1.get("other").get("projectKey").asText()).isEqualTo(wp);
    assertThat(h1.get("other").get("number").asInt()).isEqualTo(wp2);
    assertThat(h1.get("other").get("title").asText()).isEqualTo("WP 둘째");
  }

  /** #1 화면에서 CAUSES 를 B 쪽(side=target)으로 #2 와 걸면 #2 가 원인(source) — #1 은 「결과임」, #2 는 「원인임」. */
  @Test
  void addFromTargetSideStoresReversed() throws Exception {
    JsonNode list =
        json(addRelation(alice, wp, wp1, "CAUSES", "target", null, wp2).andExpect(status().isOk()));
    assertThat(list.get(0).get("label").asText()).isEqualTo("결과임");
    assertThat(list.get(0).get("side").asText()).isEqualTo("target");

    var row = dsl.selectFrom(ISSUE_RELATION).where(ISSUE_RELATION.TYPE_ID.eq(typeId("CAUSES")));
    var rel =
        row.and(ISSUE_RELATION.SOURCE_ISSUE_ID.eq(issueId(wpId, wp2)))
            .and(ISSUE_RELATION.TARGET_ISSUE_ID.eq(issueId(wpId, wp1)))
            .fetch();
    assertThat(rel).hasSize(1);

    assertThat(detail(alice, wp, wp1).get("relations").get(0).get("label").asText())
        .isEqualTo("결과임");
    assertThat(detail(alice, wp, wp2).get("relations").get(0).get("label").asText())
        .isEqualTo("원인임");
    assertThat(detail(alice, wp, wp2).get("relations").get(0).get("side").asText())
        .isEqualTo("source");
    // 이력도 각자 쪽 말.
    assertThat(
            om.readTree(history(issueId(wpId, wp1), "RELATION_ADDED").get(0)).get("label").asText())
        .isEqualTo("결과임");
    assertThat(
            om.readTree(history(issueId(wpId, wp2), "RELATION_ADDED").get(0)).get("label").asText())
        .isEqualTo("원인임");
  }

  /** 방향 없는 유형은 (작은 id, 큰 id) 로 저장 — 반대쪽에서 다시 걸어도 200, 행 1개, 이력 추가 없음. */
  @Test
  void symmetricNormalizedAndIdempotent() throws Exception {
    addRelation(alice, wp, wp2, "RELATES", null, null, wp1).andExpect(status().isOk());
    JsonNode again =
        json(addRelation(alice, wp, wp1, "RELATES", null, null, wp2).andExpect(status().isOk()));
    assertThat(again).hasSize(1);

    long id1 = issueId(wpId, wp1);
    long id2 = issueId(wpId, wp2);
    var rows =
        dsl.selectFrom(ISSUE_RELATION).where(ISSUE_RELATION.TYPE_ID.eq(typeId("RELATES"))).fetch();
    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).getSourceIssueId()).isEqualTo(Math.min(id1, id2));
    assertThat(rows.get(0).getTargetIssueId()).isEqualTo(Math.max(id1, id2));
    assertThat(history(id1, "RELATION_ADDED")).hasSize(1);
    assertThat(history(id2, "RELATION_ADDED")).hasSize(1);
  }

  /** WP 멤버이고 OPEN 인 WPV 를 읽을 수 있으면 다른 프로젝트에도 건다 — WPV 상세에 WP 쪽 줄. */
  @Test
  void crossProjectAllowedForReader() throws Exception {
    JsonNode list =
        json(addRelation(reader, wp, wp1, "RELATES", null, wpv, wpv1).andExpect(status().isOk()));
    assertThat(list.get(0).get("issue").get("projectKey").asText()).isEqualTo(wpv);

    JsonNode d = detail(bob, wpv, wpv1);
    // bob 은 WP(TEAM) 를 읽을 수 없다 — 그래서 alice(WP 소유, OPEN 인 WPV 를 읽음)로 확인한다.
    assertThat(d.get("relations")).isEmpty();
    JsonNode da = detail(alice, wpv, wpv1);
    assertThat(da.get("relations")).hasSize(1);
    assertThat(da.get("relations").get(0).get("issue").get("projectKey").asText()).isEqualTo(wp);
    assertThat(da.get("relations").get(0).get("issue").get("number").asInt()).isEqualTo(wp1);
    // 다른 프로젝트 이슈의 이력에도 남는다.
    assertThat(history(issueId(wpvId, wpv1), "RELATION_ADDED")).hasSize(1);
  }

  // ── 가시성 ─────────────────────────────────────────────────────────────────────────────

  /** WPV 를 TEAM(비멤버)로 바꾸면 WP 만 읽는 사람의 WP#1 상세에서 WPV 줄이 빠진다. 같은 프로젝트 줄은 남는다. */
  @Test
  void relationHiddenFromNonReader() throws Exception {
    addRelation(reader, wp, wp1, "RELATES", null, wpv, wpv1).andExpect(status().isOk());
    addRelation(reader, wp, wp1, "CAUSES", null, null, wp2).andExpect(status().isOk());
    assertThat(detail(reader, wp, wp1).get("relations")).hasSize(2);

    setProjectType(wpvId, "TEAM");
    JsonNode rels = detail(reader, wp, wp1).get("relations");
    assertThat(rels).hasSize(1);
    assertThat(rels.get(0).get("issue").get("projectKey").asText()).isEqualTo(wp);
  }

  /** 위 사용자에게 WP#1 이력의 RELATION_ADDED 상대는 {"hidden":true} — 유형·말은 남는다. 대조군: 읽을 수 있을 땐 키가 보인다. */
  @Test
  void historyRedactsUnreadableOther() throws Exception {
    addRelation(reader, wp, wp1, "RELATES", null, wpv, wpv1).andExpect(status().isOk());
    JsonNode before = relationHistory(detail(reader, wp, wp1), "RELATION_ADDED");
    assertThat(before.get("other").get("projectKey").asText()).isEqualTo(wpv);

    setProjectType(wpvId, "TEAM");
    JsonNode after = relationHistory(detail(reader, wp, wp1), "RELATION_ADDED");
    assertThat(after.get("other")).isEqualTo(om.readTree("{\"hidden\":true}"));
    assertThat(after.get("typeId").asLong()).isEqualTo(typeId("RELATES"));
    assertThat(after.get("label").asText()).isEqualTo("관련");
    // WPV 멤버(bob)는 WPV 이슈 이력에서 WP 상대를 못 본다(WP 는 TEAM 비멤버).
    JsonNode bobView = relationHistory(detail(bob, wpv, wpv1), "RELATION_ADDED");
    assertThat(bobView.get("other")).isEqualTo(om.readTree("{\"hidden\":true}"));
  }

  /** 조회자가 없는 출력(AI 요약 입력 — 그 이슈를 읽는 모든 사람이 결과를 본다)은 다른 프로젝트 상대 중 OPEN 만 남긴다. 같은 프로젝트 상대는 그대로. */
  @Test
  void historyRedactionWithoutViewerKeepsOnlyOpen() throws Exception {
    String team = randomKey("RD");
    projectService.create(alice, new CreateProjectRequest(team, "alice 팀", "x"));
    int teamIssue = newIssue(alice, team, "팀 이슈");
    addRelation(alice, wp, wp1, "RELATES", null, wpv, wpv1).andExpect(status().isOk());
    addRelation(alice, wp, wp1, "RELATES", null, team, teamIssue).andExpect(status().isOk());
    addRelation(alice, wp, wp1, "RELATES", null, null, wp2).andExpect(status().isOk());

    var redacted =
        relationService.redactHistory(
            null,
            projectRepository.findById(wpId).orElseThrow(),
            historyRepository.findByIssue(issueId(wpId, wp1)));
    List<String> others = new ArrayList<>();
    for (var h : redacted) {
      JsonNode other = om.readTree(h.toValue()).get("other");
      others.add(other.has("hidden") ? "hidden" : other.get("projectKey").asText());
    }
    assertThat(others).containsExactlyInAnyOrder(wpv, "hidden", wp);
  }

  /** 읽을 수 없는 프로젝트 이슈·없는 번호·없는 프로젝트 모두 400 RELATION_TARGET_NOT_FOUND, 같은 메시지. */
  @Test
  void targetUnreadableIs400Same() throws Exception {
    setProjectType(wpvId, "TEAM");
    JsonNode unreadable =
        json(
            addRelation(reader, wp, wp1, "RELATES", null, wpv, wpv1)
                .andExpect(status().isBadRequest()));
    JsonNode missingNumber =
        json(
            addRelation(reader, wp, wp1, "RELATES", null, null, 9999)
                .andExpect(status().isBadRequest()));
    JsonNode missingProject =
        json(
            addRelation(reader, wp, wp1, "RELATES", null, "ZZNOPE", 1)
                .andExpect(status().isBadRequest()));
    for (JsonNode n : List.of(unreadable, missingNumber, missingProject)) {
      assertThat(n.get("errors").get("code").asText()).isEqualTo("RELATION_TARGET_NOT_FOUND");
      assertThat(n.get("message").asText()).isEqualTo(unreadable.get("message").asText());
    }
    // 삭제된 이슈도 같은 답.
    softDelete(issueId(wpId, wp2));
    JsonNode deleted =
        json(
            addRelation(reader, wp, wp1, "RELATES", null, null, wp2)
                .andExpect(status().isBadRequest()));
    assertThat(deleted.get("errors").get("code").asText()).isEqualTo("RELATION_TARGET_NOT_FOUND");
    assertThat(relationCount()).isZero();
  }

  /** 자기 자신·차단·외부 전용·숨긴 유형·개인 프로젝트 사이·잘못된 방향은 400, OPEN 을 읽기만 하는 비멤버는 403. */
  @Test
  void rejects() throws Exception {
    assertCode(addRelation(alice, wp, wp1, "RELATES", null, null, wp1), 400, "RELATION_SELF");
    assertCode(addRelation(alice, wp, wp1, "BLOCKS", null, null, wp2), 400, "RELATION_TYPE_BLOCKS");
    assertCode(
        addRelation(alice, wp, wp1, "PARENT_EPIC", null, null, wp2),
        400,
        "RELATION_TYPE_EXTERNAL_ONLY");
    dsl.execute("UPDATE issue_relation_type SET hidden = true WHERE code = 'DUPLICATES'");
    assertCode(
        addRelation(alice, wp, wp1, "DUPLICATES", null, null, wp2), 400, "RELATION_TYPE_HIDDEN");
    assertCode(
        addRelation(alice, wp, wp1, "CAUSES", "sideways", null, wp2), 400, "RELATION_SIDE_INVALID");

    // 개인 프로젝트 — 어느 쪽 끝도 다른 프로젝트일 수 없다.
    String personal =
        projectService
            .create(alice, new CreateProjectRequest(null, "alice 개인", null, "PERSONAL"))
            .key();
    int p1 = newIssue(alice, personal, "개인 이슈");
    int p2 = newIssue(alice, personal, "개인 이슈 2");
    assertCode(
        addRelation(alice, wp, wp1, "RELATES", null, personal, p1),
        400,
        "RELATION_CROSS_PROJECT_NOT_ALLOWED");
    assertCode(
        addRelation(alice, personal, p1, "RELATES", null, wp, wp1),
        400,
        "RELATION_CROSS_PROJECT_NOT_ALLOWED");
    // 같은 개인 프로젝트 안은 된다.
    addRelation(alice, personal, p1, "RELATES", null, null, p2).andExpect(status().isOk());
    // 남의 개인 프로젝트 이슈는 없는 이슈와 같은 답(존재를 드러내지 않는다).
    assertCode(
        addRelation(bob, wpv, wpv1, "RELATES", null, personal, p1),
        400,
        "RELATION_TARGET_NOT_FOUND");

    // OPEN 비멤버는 읽을 수만 있다 — 걸기 403.
    call(post(relationsPath(wpv, wpv1)).content(body("RELATES", null, null, wpv1)), outsider)
        .andExpect(status().isForbidden());
    // 거절된 요청은 아무것도 남기지 않는다 — WP·WPV 이슈엔 관계·이력이 없다.
    assertThat(relationCount()).isZero();
    assertThat(history(issueId(wpId, wp1), "RELATION_ADDED")).isEmpty();
  }

  /**
   * B 쪽 말이 없는 방향 있는 유형은 이 이슈를 B 쪽(side=target)으로 둘 수 없다 — 지금은 상위 에픽(외부 전용이라 여기 못 온다)뿐이라 외부 전용을 풀어
   * 확인한다. 옛 데이터로 그런 줄이 이미 있어도 상세 목록 정렬은 500 이 나지 않는다(null 말은 뒤로).
   */
  @Test
  void directedTypeWithoutInwardLabelRejectsTargetSide() throws Exception {
    dsl.execute("UPDATE issue_relation_type SET external_only = false WHERE code = 'PARENT_EPIC'");
    assertCode(
        addRelation(alice, wp, wp1, "PARENT_EPIC", "target", null, wp2),
        400,
        "RELATION_SIDE_INVALID");
    assertThat(relationCount()).isZero();

    // source 로는 걸린다 — wp1 이 A, wp2 가 B. B 쪽(wp2) 상세는 말이 null 이어도 읽힌다.
    addRelation(alice, wp, wp1, "PARENT_EPIC", "source", null, wp2).andExpect(status().isOk());
    addRelation(alice, wp, wp2, "RELATES", null, null, wp1).andExpect(status().isOk());
    JsonNode relations = detail(alice, wp, wp2).get("relations");
    assertThat(relations).hasSize(2);
    assertThat(relations.get(1).get("typeCode").asText()).isEqualTo("PARENT_EPIC");
    assertThat(
            relations.get(1).path("label").isMissingNode()
                || relations.get(1).get("label").isNull())
        .isTrue();
  }

  // ── 지우기 ─────────────────────────────────────────────────────────────────────────────

  /** WP 에서 건 관계를 WPV 멤버가 WPV 이슈 주소로 지운다 — 204, 두 이슈 모두 RELATION_REMOVED. 다시 지워도 204. */
  @Test
  void removeFromEitherSide() throws Exception {
    JsonNode list =
        json(addRelation(alice, wp, wp1, "CAUSES", null, wpv, wpv1).andExpect(status().isOk()));
    long relId = list.get(0).get("id").asLong();

    // bob 은 WP(TEAM)를 읽을 수 없다 — 상대 읽기 규칙 때문에 지우지 못하고(204 이지만 그대로) 이력도 없다.
    call(delete(relationsPath(wpv, wpv1) + "/" + relId), bob).andExpect(status().isNoContent());
    assertThat(dsl.fetchCount(ISSUE_RELATION, ISSUE_RELATION.ID.eq(relId))).isEqualTo(1);

    // WP 를 읽을 수 있는 WPV 멤버(reader 를 WPV 에도 넣는다)는 WPV 쪽에서 지운다.
    memberRepository.insert(wpvId, reader, "MEMBER");
    call(delete(relationsPath(wpv, wpv1) + "/" + relId), reader).andExpect(status().isNoContent());
    assertThat(dsl.fetchCount(ISSUE_RELATION, ISSUE_RELATION.ID.eq(relId))).isZero();
    List<String> removedWp = history(issueId(wpId, wp1), "RELATION_REMOVED");
    List<String> removedWpv = history(issueId(wpvId, wpv1), "RELATION_REMOVED");
    assertThat(removedWp).hasSize(1);
    assertThat(removedWpv).hasSize(1);
    assertThat(om.readTree(removedWp.get(0)).get("label").asText()).isEqualTo("원인임");
    assertThat(om.readTree(removedWpv.get(0)).get("label").asText()).isEqualTo("결과임");
    assertThat(om.readTree(removedWpv.get(0)).get("other").get("projectKey").asText())
        .isEqualTo(wp);

    // 다시 지워도 204, 이력 추가 없음.
    call(delete(relationsPath(wpv, wpv1) + "/" + relId), reader).andExpect(status().isNoContent());
    assertThat(history(issueId(wpId, wp1), "RELATION_REMOVED")).hasSize(1);
  }

  /** 주소 이슈가 끝이 아닌 관계 id 는 지우지 않는다(204 이지만 그대로) — 아무 이슈 주소로 남의 관계를 지울 수 없다. */
  @Test
  void removeIgnoresRelationOfAnotherIssue() throws Exception {
    long relId =
        json(addRelation(alice, wp, wp1, "RELATES", null, null, wp2).andExpect(status().isOk()))
            .get(0)
            .get("id")
            .asLong();
    // bob 은 WPV 멤버 — WPV 이슈 주소로 WP 사이 관계를 지우려 한다.
    call(delete(relationsPath(wpv, wpv1) + "/" + relId), bob).andExpect(status().isNoContent());
    assertThat(dsl.fetchCount(ISSUE_RELATION, ISSUE_RELATION.ID.eq(relId))).isEqualTo(1);
    // 없는 id 도 204.
    call(delete(relationsPath(wp, wp1) + "/999999999"), alice).andExpect(status().isNoContent());
    // OPEN 비멤버는 지우기도 403.
    call(delete(relationsPath(wpv, wpv1) + "/" + relId), outsider)
        .andExpect(status().isForbidden());
  }

  // ── 삭제·차단·알림 ───────────────────────────────────────────────────────────────────────

  /** 상대 이슈를 소프트 삭제하면 상세에서 사라진다(행은 남는다). */
  @Test
  void deletedIssueHidden() throws Exception {
    addRelation(alice, wp, wp1, "RELATES", null, null, wp2).andExpect(status().isOk());
    softDelete(issueId(wpId, wp2));
    assertThat(detail(alice, wp, wp1).get("relations")).isEmpty();
    assertThat(relationCount()).isEqualTo(1);
  }

  /** 관련만 건 이슈는 블로커가 아니다 — blocked=false, blockedBy·blocks 비어 있음. */
  @Test
  void blockerUnaffected() throws Exception {
    addRelation(alice, wp, wp1, "RELATES", null, null, wp2).andExpect(status().isOk());
    addRelation(alice, wp, wp1, "CAUSES", null, null, wp2).andExpect(status().isOk());
    for (int n : List.of(wp1, wp2)) {
      JsonNode summary = detail(alice, wp, n).get("summary");
      assertThat(summary.get("blocked").asBoolean()).isFalse();
      assertThat(summary.get("blockedBy")).isEmpty();
      assertThat(summary.get("blocks")).isEmpty();
    }
  }

  /** 걸기·지우기는 알림·AI 착수 원인 이벤트를 내지 않는다 — 화면 갱신 신호만 두 이슈 각자 프로젝트로 1건씩. */
  @Test
  void noNotificationEvents() throws Exception {
    events.clear();
    long relId =
        json(addRelation(alice, wp, wp1, "RELATES", null, wpv, wpv1).andExpect(status().isOk()))
            .get(0)
            .get("id")
            .asLong();
    assertNoNotificationEvents();
    assertThat(events.stream(ResourceChangedEvent.class).map(ResourceChangedEvent::scopeId))
        .containsExactlyInAnyOrder(wpId, wpvId);

    events.clear();
    call(delete(relationsPath(wp, wp1) + "/" + relId), alice).andExpect(status().isNoContent());
    assertNoNotificationEvents();
    assertThat(events.stream(ResourceChangedEvent.class).map(ResourceChangedEvent::scopeId))
        .containsExactlyInAnyOrder(wpId, wpvId);
    assertThat(dsl.fetchCount(NOTIFICATION)).isZero();

    // 멱등 재요청은 신호도 없다.
    events.clear();
    call(delete(relationsPath(wp, wp1) + "/" + relId), alice).andExpect(status().isNoContent());
    assertThat(events.stream(ResourceChangedEvent.class).count()).isZero();
  }

  // ── 찾기(lookup) ───────────────────────────────────────────────────────────────────────

  /** 키·#번호·제목 조각으로 찾는다 — 읽을 수 없는 TEAM·삭제 이슈는 빠지고, 개인 프로젝트는 그 프로젝트에서 찾을 때만 나온다. 최대 20건. */
  @Test
  void lookupScopes() throws Exception {
    String token = "LK" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    int open = newIssue(bob, wpv, "열린 " + token + " 이슈");
    int mine = newIssue(alice, wp, "팀 " + token + " 이슈");
    int gone = newIssue(alice, wp, "지운 " + token + " 이슈");
    softDelete(issueId(wpId, gone));
    String team = randomKey("RC");
    long teamId = projectService.create(bob, new CreateProjectRequest(team, "남의 팀", "x")).id();
    int teamIssue = newIssue(bob, team, "남의 팀 " + token);
    String bobPersonal =
        projectService
            .create(bob, new CreateProjectRequest(null, "bob 개인", null, "PERSONAL"))
            .key();
    newIssue(bob, bobPersonal, "bob 개인 " + token);
    String readerPersonal =
        projectService
            .create(reader, new CreateProjectRequest(null, "reader 개인", null, "PERSONAL"))
            .key();
    int readerOwn = newIssue(reader, readerPersonal, "내 개인 " + token);

    // 제목 조각(대소문자 무시) — from 없음·TEAM·OPEN 이면 개인 프로젝트는 빠진다(다른 프로젝트와 관계를 못 맺는다).
    List<String> shared = List.of(wpv + "-" + open, wp + "-" + mine);
    assertThat(keys(lookup(reader, token.toLowerCase())))
        .containsExactlyInAnyOrderElementsOf(shared);
    assertThat(keys(lookup(reader, token, wp))).containsExactlyInAnyOrderElementsOf(shared);
    assertThat(keys(lookup(reader, token, wpv))).containsExactlyInAnyOrderElementsOf(shared);
    // 자기 개인 프로젝트에서 찾으면 그 프로젝트만(소문자 키도 받는다).
    assertThat(keys(lookup(reader, token, readerPersonal.toLowerCase())))
        .containsExactly(readerPersonal + "-" + readerOwn);
    // 읽을 수 없는(남의) 개인 프로젝트·없는 키를 from 으로 주면 없는 것처럼 — 비개인 범위.
    assertThat(keys(lookup(reader, token, bobPersonal)))
        .containsExactlyInAnyOrderElementsOf(shared);
    assertThat(keys(lookup(reader, token, "ZZNOPE"))).containsExactlyInAnyOrderElementsOf(shared);
    // 개인 프로젝트 범위에선 키로도 다른 프로젝트 이슈가 안 나온다.
    assertThat(lookup(reader, wpv + "-" + open, readerPersonal)).isEmpty();

    // 키 정확 일치(대소문자 무시).
    assertThat(keys(lookup(reader, (wpv + "-" + open).toLowerCase())))
        .containsExactly(wpv + "-" + open);
    // 읽을 수 없는 TEAM 의 키는 빈 결과.
    assertThat(lookup(reader, team + "-" + teamIssue)).isEmpty();

    // #번호 — 읽을 수 있는 프로젝트들에서 그 번호. 다른 테스트의 OPEN 프로젝트가 섞일 수 있어 포함·제외만 본다.
    List<String> byNumber = keys(lookup(reader, "#" + wpv1));
    assertThat(byNumber).contains(wpv + "-" + wpv1, wp + "-" + wpv1);
    assertThat(byNumber).doesNotContain(team + "-" + wpv1);
    assertThat(byNumber).hasSizeLessThanOrEqualTo(20);
    assertThat(keys(lookup(reader, String.valueOf(wp2)))).contains(wp + "-" + wp2);

    // 빈 q·넘치는 번호는 빈 목록(500 아님).
    assertThat(lookup(reader, "  ")).isEmpty();
    assertThat(lookup(reader, "#99999999999999999999")).isEmpty();

    // 최대 20건, 최신 수정순.
    String many = "MN" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    for (int i = 0; i < 21; i++) {
      newIssue(bob, wpv, many + " " + i);
    }
    assertThat(lookup(reader, many)).hasSize(20);
    assertThat(teamId).isPositive();
  }

  /**
   * 번호만 친 검색어(#N·N)는 from 프로젝트의 그 번호가 맨 앞 — 더 최근에 고친 다른 프로젝트 25곳에 같은 번호가 있어 20건에서 잘려도 빠지지 않는다. from
   * 프로젝트의 이슈를 가장 먼저(가장 오래전에) 만들어 최신 수정순만으로는 20건 밖으로 밀리게 둔다.
   */
  @Test
  void lookupByNumberPutsFromProjectFirst() throws Exception {
    for (int i = 0; i < 25; i++) {
      String other = randomKey("RN");
      projectService.create(bob, new CreateProjectRequest(other, "번호 " + i, "x", "OPEN"));
      assertThat(newIssue(bob, other, "같은 번호 " + i)).isEqualTo(wp1);
    }
    String mine = wp + "-" + wp1;
    assertThat(keys(lookup(reader, "#" + wp1, wp)).get(0)).isEqualTo(mine);
    assertThat(keys(lookup(reader, String.valueOf(wp1), wp.toLowerCase())).get(0)).isEqualTo(mine);
    assertThat(lookup(reader, "#" + wp1, wp)).hasSize(20);
    // from 이 없으면 앞세우지 않는다 — 최신 수정순이라 오래된 이 프로젝트 이슈는 20건 밖.
    assertThat(keys(lookup(reader, "#" + wp1))).doesNotContain(mine);
  }

  /** 키·번호 꼴 검색어라도 그 키·번호가 없으면 제목으로 다시 찾는다("covid-19" → "COVID-19 대응", "404" → "404 페이지"). */
  @Test
  void lookupFallsBackToTitleForKeyLikeQuery() throws Exception {
    String token = "CV" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    int byKeyShape = newIssue(alice, wp, token + "-19 대응");
    assertThat(keys(lookup(reader, (token + "-19").toLowerCase())))
        .containsExactly(wp + "-" + byKeyShape);

    // 어느 프로젝트에도 없을 큰 번호 — 번호 찾기는 비고 제목 찾기로 간다.
    String num = String.valueOf(900000000 + (int) (Math.random() * 90000000));
    int byNumberShape = newIssue(alice, wp, num + " 페이지");
    assertThat(keys(lookup(reader, num))).containsExactly(wp + "-" + byNumberShape);
  }

  /**
   * WP-1039 유형·열린 상태 거름 — 상한(20건) 전에 SQL 로 건다. 제목이 맞는 태스크 21건이 더 최근이어도 type=EPIC 이면 에픽이 나오고,
   * openOnly 면 완료·취소 에픽은 빠진다. 거름 없는 기존 찾기는 그대로(태스크로 20건이 차 에픽이 밀려난다).
   */
  @Test
  void lookupFiltersByTypeAndOpenBeforeLimit() throws Exception {
    String token = "EP" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    int openEpic = newEpic(bob, wpv, wpvId, "열린 에픽 " + token);
    int doneEpic = newEpic(bob, wpv, wpvId, "끝난 에픽 " + token);
    int canceledEpic = newEpic(bob, wpv, wpvId, "취소 에픽 " + token);
    closeIssue(issueId(wpvId, doneEpic), "DONE");
    closeIssue(issueId(wpvId, canceledEpic), "CANCELED");
    // 에픽보다 나중에 만든(더 최근 수정) 태스크 21건 — 거름 없는 찾기는 이것들로 20건이 찬다.
    for (int i = 0; i < 21; i++) {
      newIssue(bob, wpv, "태스크 " + token + " " + i);
    }
    String epicKey = wpv + "-" + openEpic;
    assertThat(keys(lookup(reader, token, wp))).hasSize(20).doesNotContain(epicKey);

    // type=EPIC(대소문자 무시) — 태스크는 빠지고 에픽 셋이 모두 나온다.
    assertThat(keys(lookupFiltered(reader, token, wp, "epic", false)))
        .containsExactlyInAnyOrder(epicKey, wpv + "-" + doneEpic, wpv + "-" + canceledEpic);
    // openOnly — 완료·취소 에픽은 빠진다.
    assertThat(keys(lookupFiltered(reader, token, wp, "EPIC", true))).containsExactly(epicKey);
    // 키로 찾아도 같은 거름이 걸린다 — 끝난 에픽 키는 openOnly 에서 빈 결과(제목 대체 찾기에도 걸리지 않는다).
    assertThat(lookupFiltered(reader, wpv + "-" + doneEpic, wp, "EPIC", true)).isEmpty();

    // excludeFrom — from(wp) 프로젝트의 더 최근 열린 에픽 20건이 상한을 채워도, 빼고 찾으면 다른 프로젝트 에픽이 남는다.
    for (int i = 0; i < 20; i++) {
      newEpic(alice, wp, wpId, "같은 프로젝트 에픽 " + token + " " + i);
    }
    assertThat(keys(lookupFiltered(reader, token, wp, "EPIC", true)))
        .hasSize(20)
        .doesNotContain(epicKey);
    assertThat(keys(lookupFiltered(reader, token, wp, "EPIC", true, true)))
        .containsExactly(epicKey);
  }

  @Test
  void lookupTypeFilterIgnoresCase() throws Exception {
    // 대문자로 저장되지 않은 사용자 유형(Spike)도 소문자·대문자 type 으로 찾는다 — 이름 비교는 대소문자 무시.
    String token = "SP" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    long spikeTypeId =
        issueTypeService
            .create(bob, wpv, new CreateIssueTypeRequest("Spike", "GRAY", "Circle"))
            .id();
    int spike =
        issueService
            .create(
                bob,
                wpv,
                new CreateIssueRequest(
                    "스파이크 " + token, null, null, null, null, spikeTypeId, null, null))
            .number();
    newIssue(bob, wpv, "태스크 " + token);
    String spikeKey = wpv + "-" + spike;
    assertThat(keys(lookupFiltered(reader, token, wp, "spike", false))).containsExactly(spikeKey);
    assertThat(keys(lookupFiltered(reader, token, wp, "SPIKE", false))).containsExactly(spikeKey);
    // 시스템 유형(TASK 로 저장)도 소문자로 찾는다.
    assertThat(keys(lookupFiltered(reader, token, wp, "task", false)))
        .hasSize(1)
        .doesNotContain(spikeKey);
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────────────────────

  private void assertNoNotificationEvents() {
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
  }

  /** USER 역할의 현재 테넌트 구성원. */
  private long user() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  private static String randomKey(String prefix) {
    return prefix + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
  }

  private int newIssue(long caller, String projectKey, String title) {
    return issueService
        .create(
            caller,
            projectKey,
            new CreateIssueRequest(title, null, null, null, null, null, null, null))
        .number();
  }

  /** 그 프로젝트의 EPIC 유형으로 이슈를 만든다(유형은 프로젝트마다 따로다). */
  private int newEpic(long caller, String projectKey, long projectId, String title) {
    long epicTypeId =
        ((Number)
                dsl.fetchValue(
                    "SELECT id FROM issue_type_def WHERE project_id = ? AND name = 'EPIC'",
                    projectId))
            .longValue();
    return issueService
        .create(
            caller,
            projectKey,
            new CreateIssueRequest(title, null, null, null, null, epicTypeId, null, null))
        .number();
  }

  private long issueId(long projectId, int number) {
    return dsl.select(ISSUE.ID)
        .from(ISSUE)
        .where(ISSUE.PROJECT_ID.eq(projectId).and(ISSUE.NUMBER.eq(number)))
        .fetchOne(ISSUE.ID);
  }

  private long typeId(String code) {
    return ((Number) dsl.fetchValue("SELECT id FROM issue_relation_type WHERE code = ?", code))
        .longValue();
  }

  /** WP·WPV 이슈가 끝인 관계 행 수(삭제된 이슈 포함) — 공유 DB 의 다른 행과 섞이지 않게 이 테스트의 프로젝트로 한정한다. */
  private int relationCount() {
    var mine = dsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.in(wpId, wpvId));
    return dsl.fetchCount(
        ISSUE_RELATION,
        ISSUE_RELATION.SOURCE_ISSUE_ID.in(mine).or(ISSUE_RELATION.TARGET_ISSUE_ID.in(mine)));
  }

  private void setProjectType(long projectId, String type) {
    dsl.execute("UPDATE project SET type = ? WHERE id = ?", type, projectId);
  }

  /** 그 이슈를 범주의 첫 프로젝트 상태로 바꾼다 — 상태는 (status_id, 범주) 복합 FK 라 둘을 함께 맞춘다. */
  private void closeIssue(long issueId, String category) {
    dsl.execute(
        "UPDATE issue i SET status = ?, status_id = (SELECT ps.id FROM project_status ps"
            + " WHERE ps.project_id = i.project_id AND ps.category = ? ORDER BY ps.position LIMIT 1)"
            + " WHERE i.id = ?",
        category,
        category,
        issueId);
  }

  private void softDelete(long issueId) {
    dsl.execute("UPDATE issue SET deleted_at = now() WHERE id = ?", issueId);
  }

  /** 그 이슈의 해당 종류 이력 toValue 들(저장된 그대로 — 가림 전). */
  private List<String> history(long issueId, String eventType) {
    return dsl.select(ISSUE_HISTORY.TO_VALUE)
        .from(ISSUE_HISTORY)
        .where(ISSUE_HISTORY.ISSUE_ID.eq(issueId).and(ISSUE_HISTORY.EVENT_TYPE.eq(eventType)))
        .orderBy(ISSUE_HISTORY.ID)
        .fetch(ISSUE_HISTORY.TO_VALUE);
  }

  /** 상세 응답(가림 뒤)의 해당 종류 이력 첫 건 toValue. */
  private JsonNode relationHistory(JsonNode detail, String eventType) throws Exception {
    for (JsonNode h : detail.get("history")) {
      if (eventType.equals(h.get("eventType").asText())) {
        return om.readTree(h.get("toValue").asText());
      }
    }
    throw new AssertionError(eventType + " 이력 없음");
  }

  private String relationsPath(String projectKey, int number) {
    return "/api/v1/projects/" + projectKey + "/issues/" + number + "/relations";
  }

  private String body(String typeCode, String side, String targetKey, int targetNumber)
      throws Exception {
    Map<String, Object> target = new LinkedHashMap<>();
    target.put("projectKey", targetKey);
    target.put("number", targetNumber);
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("typeId", typeId(typeCode));
    m.put("side", side);
    m.put("target", target);
    return om.writeValueAsString(m);
  }

  private ResultActions addRelation(
      long caller,
      String projectKey,
      int number,
      String typeCode,
      String side,
      String targetKey,
      int targetNumber)
      throws Exception {
    return call(
        post(relationsPath(projectKey, number))
            .content(body(typeCode, side, targetKey, targetNumber)),
        caller);
  }

  private JsonNode detail(long caller, String projectKey, int number) throws Exception {
    return json(
        call(get("/api/v1/projects/" + projectKey + "/issues/" + number), caller)
            .andExpect(status().isOk()));
  }

  private JsonNode lookup(long caller, String q) throws Exception {
    return json(
        call(get("/api/v1/issues/lookup").param("q", q), caller).andExpect(status().isOk()));
  }

  /** from(현재 이슈의 프로젝트 키)을 붙인 찾기. */
  private JsonNode lookup(long caller, String q, String from) throws Exception {
    return json(
        call(get("/api/v1/issues/lookup").param("q", q).param("from", from), caller)
            .andExpect(status().isOk()));
  }

  /** 유형·열린 상태 거름을 붙인 찾기(WP-1039). */
  private JsonNode lookupFiltered(long caller, String q, String from, String type, boolean openOnly)
      throws Exception {
    return lookupFiltered(caller, q, from, type, openOnly, false);
  }

  private JsonNode lookupFiltered(
      long caller, String q, String from, String type, boolean openOnly, boolean excludeFrom)
      throws Exception {
    return json(
        call(
                get("/api/v1/issues/lookup")
                    .param("q", q)
                    .param("from", from)
                    .param("type", type)
                    .param("openOnly", String.valueOf(openOnly))
                    .param("excludeFrom", String.valueOf(excludeFrom)),
                caller)
            .andExpect(status().isOk()));
  }

  /** 찾기 결과를 「키-번호」 문자열로. */
  private static List<String> keys(JsonNode items) {
    List<String> out = new ArrayList<>();
    items.forEach(n -> out.add(n.get("projectKey").asText() + "-" + n.get("number").asInt()));
    return out;
  }

  private void assertCode(ResultActions r, int httpStatus, String code) throws Exception {
    r.andExpect(status().is(httpStatus)).andExpect(jsonPath("$.errors.code").value(code));
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long caller) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L))
        .contentType(MediaType.APPLICATION_JSON);
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }
}
