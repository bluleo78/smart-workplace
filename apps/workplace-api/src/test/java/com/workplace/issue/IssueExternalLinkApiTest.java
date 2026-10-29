package com.workplace.issue;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_EXTERNAL_LINK;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.ResolvedExternalLink;
import com.workplace.issue.exception.IssueRelationException;
import com.workplace.issue.service.IssueExternalLinkService;
import com.workplace.issue.service.IssueService;
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
 * WP-887 외부 링크 — 붙이기(유형·방향 말, 스킴 검사, 같은 주소 멱등/충돌, 상한 50)·수정·삭제·이력·상세 표시·권한·가져오기용 삽입.
 *
 * <p>프로젝트 셋: WP(TEAM — alice 소유), WPV(OPEN — bob 소유, alice 는 읽기만). @Transactional 이라 요청이 테스트 트랜잭션에
 * 합류하고 끝나면 롤백된다.
 */
@Transactional
@RecordApplicationEvents
class IssueExternalLinkApiTest extends IntegrationTestBase {

  private static final String JIRA = "https://iacloud.atlassian.net/browse/CL-1867";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired IssueService issueService;
  @Autowired IssueExternalLinkService externalLinkService;
  @Autowired ApplicationEvents events;

  private long alice;
  private long bob;
  private String wp;
  private long wpId;
  private String wpv;
  private int wp1;
  private int wp2;
  private int wpv1;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    alice = user();
    bob = user();
    wp = randomKey("EA");
    wpId = projectService.create(alice, new CreateProjectRequest(wp, "외부 링크 WP", "x")).id();
    wpv = randomKey("EB");
    projectService.create(bob, new CreateProjectRequest(wpv, "외부 링크 WPV", "x", "OPEN"));
    wp1 = newIssue(alice, wp, "WP 첫째");
    wp2 = newIssue(alice, wp, "WP 둘째");
    wpv1 = newIssue(bob, wpv, "WPV 첫째");
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 상위 에픽 외부 링크 — 상세에 「에픽에 속함」으로 보이고 이력 1건, 실시간 신호는 나가지만 알림은 없다. */
  @Test
  void addParentEpicShowsLabel() throws Exception {
    JsonNode list =
        json(
            add(alice, wp, wp1, "PARENT_EPIC", null, JIRA, "CL-1867", "v1.7.0 버그 픽스")
                .andExpect(status().isOk()));
    assertThat(list).hasSize(1);
    assertThat(list.get(0).get("label").asText()).isEqualTo("에픽에 속함");
    assertThat(list.get(0).get("typeCode").asText()).isEqualTo("PARENT_EPIC");

    JsonNode link = detail(alice, wp, wp1).get("externalLinks").get(0);
    assertThat(link.get("label").asText()).isEqualTo("에픽에 속함");
    assertThat(link.get("url").asText()).isEqualTo(JIRA);
    assertThat(link.get("key").asText()).isEqualTo("CL-1867");
    assertThat(link.get("title").asText()).isEqualTo("v1.7.0 버그 픽스");

    List<String> h = history(wp1, "EXTERNAL_LINK_ADDED");
    assertThat(h).hasSize(1);
    JsonNode to = om.readTree(h.get(0));
    assertThat(to.get("label").asText()).isEqualTo("에픽에 속함");
    assertThat(to.get("key").asText()).isEqualTo("CL-1867");
    assertThat(to.get("title").asText()).isEqualTo("v1.7.0 버그 픽스");
    assertThat(to.get("url").asText()).isEqualTo(JIRA);
    assertThat(events.stream(ResourceChangedEvent.class).count()).isPositive();
  }

  /** 방향 있는 유형은 side 에 따라 말이 갈린다 — target 이면 「결과임」, 방향 없는 유형은 side 와 무관하게 늘 source 로 저장. */
  @Test
  void directedSideLabel() throws Exception {
    JsonNode list =
        json(
            add(alice, wp, wp1, "CAUSES", "target", "https://x.test/1", null, "원인 이슈")
                .andExpect(status().isOk()));
    assertThat(list.get(0).get("label").asText()).isEqualTo("결과임");
    assertThat(list.get(0).get("side").asText()).isEqualTo("target");

    JsonNode relates =
        json(
            add(alice, wp, wp1, "RELATES", "target", "https://x.test/2", null, "관련 이슈")
                .andExpect(status().isOk()));
    assertThat(relates).hasSize(2);
    boolean stored =
        dsl.select(ISSUE_EXTERNAL_LINK.ISSUE_IS_SOURCE)
            .from(ISSUE_EXTERNAL_LINK)
            .where(ISSUE_EXTERNAL_LINK.URL.eq("https://x.test/2"))
            .fetchOne(ISSUE_EXTERNAL_LINK.ISSUE_IS_SOURCE);
    assertThat(stored).isTrue();
    for (JsonNode l : relates) {
      if (l.get("url").asText().equals("https://x.test/2")) {
        assertThat(l.get("side").asText()).isEqualTo("source");
      }
    }

    add(alice, wp, wp1, "CAUSES", "up", "https://x.test/3", null, "x")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.code").value("RELATION_SIDE_INVALID"));
  }

  /** javascript:·data:·ftp:·호스트 없음·빈 값은 400, 앞뒤 공백은 떼고 저장. */
  @Test
  void rejectsNonHttpSchemes() throws Exception {
    for (String bad :
        new String[] {
          "javascript:alert(1)",
          "data:text/html,x",
          "ftp://a",
          "https:///nohost",
          "",
          "   ",
          "https://a b/c",
          "//a.test/x",
          "/relative"
        }) {
      assertCode(
          add(alice, wp, wp1, "RELATES", null, bad, null, "t"), 400, "EXTERNAL_LINK_URL_INVALID");
    }
    assertCode(
        add(alice, wp, wp1, "RELATES", null, null, null, "t"), 400, "EXTERNAL_LINK_URL_INVALID");
    assertThat(linkCount(wp1)).isZero();
    assertThat(history(wp1, "EXTERNAL_LINK_ADDED")).isEmpty();

    JsonNode list =
        json(
            add(alice, wp, wp1, "RELATES", null, "  https://a.b/c  ", null, "공백")
                .andExpect(status().isOk()));
    assertThat(list.get(0).get("url").asText()).isEqualTo("https://a.b/c");
    // 스킴은 대소문자 무시.
    add(alice, wp, wp1, "RELATES", null, "HTTP://A.B/d", null, "대문자").andExpect(status().isOk());
    assertThat(linkCount(wp1)).isEqualTo(2);
  }

  /** 같은 주소·같은 유형·방향은 200 으로 한 줄만(이력 추가 없음), 다른 유형이면 409. */
  @Test
  void sameUrlIdempotentOrConflict() throws Exception {
    add(alice, wp, wp1, "PARENT_EPIC", null, JIRA, "CL-1867", "에픽").andExpect(status().isOk());
    JsonNode again =
        json(
            add(alice, wp, wp1, "PARENT_EPIC", null, " " + JIRA + " ", "다른키", "다른 제목")
                .andExpect(status().isOk()));
    assertThat(again).hasSize(1);
    assertThat(again.get(0).get("title").asText()).isEqualTo("에픽");
    assertThat(history(wp1, "EXTERNAL_LINK_ADDED")).hasSize(1);

    assertCode(
        add(alice, wp, wp1, "RELATES", null, JIRA, null, "x"), 409, "EXTERNAL_LINK_CONFLICT");
    // 방향 있는 유형의 반대쪽도 충돌(상위 에픽은 B 쪽 말이 없어 target 자체가 400 이라 원인으로 본다).
    String causesUrl = JIRA + "-causes";
    add(alice, wp, wp1, "CAUSES", "source", causesUrl, null, "x").andExpect(status().isOk());
    assertCode(
        add(alice, wp, wp1, "CAUSES", "target", causesUrl, null, "x"),
        409,
        "EXTERNAL_LINK_CONFLICT");
    assertThat(linkCount(wp1)).isEqualTo(2);
    // 같은 주소라도 다른 이슈에는 붙는다.
    add(alice, wp, wp2, "RELATES", null, JIRA, null, "x").andExpect(status().isOk());
  }

  /**
   * 상위 에픽처럼 B 쪽 말이 없는 방향 있는 유형은 이 이슈를 B 쪽(side=target)으로 둘 수 없다 — 추가·수정(유형 바꾸기 포함)·가져오기 모두 400
   * RELATION_SIDE_INVALID. 저장되면 이 이슈 쪽 말이 null 이라 목록 정렬이 500 이 났다.
   */
  @Test
  void parentEpicRejectsTargetSide() throws Exception {
    assertCode(
        add(alice, wp, wp1, "PARENT_EPIC", "target", JIRA, "CL-1", "에픽"),
        400,
        "RELATION_SIDE_INVALID");
    assertThat(linkCount(wp1)).isZero();

    long epicId =
        json(add(alice, wp, wp1, "PARENT_EPIC", null, JIRA, "CL-1", "에픽")
                .andExpect(status().isOk()))
            .get(0)
            .get("id")
            .asLong();
    assertCode(
        update(alice, wp, wp1, epicId, "PARENT_EPIC", "target", null, "CL-1", "에픽"),
        400,
        "RELATION_SIDE_INVALID");

    // target 으로 저장된 원인 링크를 side 없이 상위 에픽으로 바꾸면 저장된 방향(target)이 그대로라 거절된다.
    long causesId = -1;
    for (JsonNode l :
        json(
            add(alice, wp, wp1, "CAUSES", "target", JIRA + "-2", null, "원인")
                .andExpect(status().isOk()))) {
      if (l.get("typeCode").asText().equals("CAUSES")) causesId = l.get("id").asLong();
    }
    assertCode(
        update(alice, wp, wp1, causesId, "PARENT_EPIC", null, null, null, "원인"),
        400,
        "RELATION_SIDE_INVALID");

    assertThatThrownBy(
            () ->
                externalLinkService.insertForImport(
                    issueId(wp1),
                    alice,
                    List.of(
                        new ResolvedExternalLink(
                            typeId("PARENT_EPIC"), false, JIRA + "-3", "CL-3", "가져옴"))))
        .isInstanceOf(IssueRelationException.class)
        .hasMessageContaining("target");
    assertThat(linkCount(wp1)).isEqualTo(2);

    // 옛 데이터로 B 쪽 말 없는 줄이 이미 있어도 상세 목록 정렬이 500 이 나지 않는다(null 말은 뒤로).
    dsl.execute(
        "INSERT INTO issue_external_link (issue_id, type_id, issue_is_source, url, title)"
            + " VALUES (?, ?, false, ?, '옛 줄')",
        issueId(wp1),
        typeId("PARENT_EPIC"),
        JIRA + "-legacy");
    JsonNode links = detail(alice, wp, wp1).get("externalLinks");
    assertThat(links).hasSize(3);
    assertThat(links.get(2).get("title").asText()).isEqualTo("옛 줄");
  }

  /** 이슈당 50개까지, 51번째는 400. */
  @Test
  void limitFifty() throws Exception {
    for (int i = 0; i < 50; i++) {
      add(alice, wp, wp1, "RELATES", null, "https://x.test/" + i, null, "t" + i)
          .andExpect(status().isOk());
    }
    assertCode(
        add(alice, wp, wp1, "RELATES", null, "https://x.test/50", null, "t"),
        400,
        "EXTERNAL_LINK_LIMIT");
    // 이미 있는 주소를 다시 넣는 건 상한과 무관하게 멱등.
    add(alice, wp, wp1, "RELATES", null, "https://x.test/3", null, "t").andExpect(status().isOk());
    assertThat(linkCount(wp1)).isEqualTo(50);
  }

  /** 제목·유형 수정은 UPDATED 이력(from/to), 삭제는 204 + REMOVED, 다시 삭제해도 204. */
  @Test
  void editAndRemove() throws Exception {
    long id =
        json(add(alice, wp, wp1, "RELATES", null, JIRA, "CL-1867", "처음 제목")
                .andExpect(status().isOk()))
            .get(0)
            .get("id")
            .asLong();

    // 주소는 요청 값을 무시하고 그대로.
    JsonNode edited =
        json(
            update(
                    alice,
                    wp,
                    wp1,
                    id,
                    "CAUSES",
                    "target",
                    "https://other.test/z",
                    "CL-1868",
                    "고친 제목")
                .andExpect(status().isOk()));
    assertThat(edited).hasSize(1);
    assertThat(edited.get(0).get("title").asText()).isEqualTo("고친 제목");
    assertThat(edited.get(0).get("label").asText()).isEqualTo("결과임");
    assertThat(edited.get(0).get("url").asText()).isEqualTo(JIRA);
    assertThat(edited.get(0).get("key").asText()).isEqualTo("CL-1868");

    List<String> upd = history(wp1, "EXTERNAL_LINK_UPDATED");
    assertThat(upd).hasSize(1);
    JsonNode to = om.readTree(upd.get(0));
    assertThat(to.get("label").asText()).isEqualTo("결과임");
    assertThat(to.get("title").asText()).isEqualTo("고친 제목");
    String fromValue =
        dsl.select(ISSUE_HISTORY.FROM_VALUE)
            .from(ISSUE_HISTORY)
            .where(ISSUE_HISTORY.EVENT_TYPE.eq("EXTERNAL_LINK_UPDATED"))
            .and(ISSUE_HISTORY.ISSUE_ID.eq(issueId(wp1)))
            .fetchOne(ISSUE_HISTORY.FROM_VALUE);
    JsonNode from = om.readTree(fromValue);
    assertThat(from.get("label").asText()).isEqualTo("관련");
    assertThat(from.get("title").asText()).isEqualTo("처음 제목");
    assertThat(from.get("key").asText()).isEqualTo("CL-1867");
    assertThat(from.get("url").asText()).isEqualTo(JIRA);

    // 바뀐 게 없으면 이력 없이 그대로.
    update(alice, wp, wp1, id, "CAUSES", "target", null, "CL-1868", "고친 제목")
        .andExpect(status().isOk());
    assertThat(history(wp1, "EXTERNAL_LINK_UPDATED")).hasSize(1);

    call(delete(path(wp, wp1) + "/" + id), alice).andExpect(status().isNoContent());
    assertThat(linkCount(wp1)).isZero();
    List<String> removed = history(wp1, "EXTERNAL_LINK_REMOVED");
    assertThat(removed).hasSize(1);
    assertThat(om.readTree(removed.get(0)).get("title").asText()).isEqualTo("고친 제목");
    call(delete(path(wp, wp1) + "/" + id), alice).andExpect(status().isNoContent());
    assertThat(history(wp1, "EXTERNAL_LINK_REMOVED")).hasSize(1);
  }

  /**
   * WP-1107: 제목이 보이지 않는 글자(제로폭 공백·한글 채움 등)뿐이면 공백만일 때처럼 「제목을 입력해 주세요」로 막는다 — 추가·수정 모두. 관계 카드에 ↗ 아이콘만
   * 남아 무슨 링크인지 알 수 없었다. 보이는 글자가 있으면 앞뒤 보이지 않는 글자만 다듬어 저장한다.
   */
  @Test
  void rejectsInvisibleOnlyTitle() throws Exception {
    for (String invisible : new String[] {"\u200B\u200B", "\u3164", "\u2800 \uFEFF"}) {
      add(alice, wp, wp1, "RELATES", null, "https://docs.example.com/spec/page", null, invisible)
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.errors.title").value("제목을 입력해 주세요"));
    }
    assertThat(linkCount(wp1)).isZero();

    long id =
        json(add(alice, wp, wp1, "RELATES", null, JIRA, "CL-1867", "\u200B처음 제목\u200B")
                .andExpect(status().isOk()))
            .get(0)
            .get("id")
            .asLong();
    assertThat(detail(alice, wp, wp1).toString()).doesNotContain("\u200B");
    update(alice, wp, wp1, id, "RELATES", null, JIRA, "CL-1867", "\u200B")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.title").value("제목을 입력해 주세요"));
    assertThat(detail(alice, wp, wp1).get("externalLinks").get(0).get("title").asText())
        .isEqualTo("처음 제목");
  }

  /** 다른 이슈 주소로는 남의 링크를 고치지도(404) 지우지도(204 이지만 그대로) 못 한다. */
  @Test
  void linkOfAnotherIssueUntouched() throws Exception {
    long id =
        json(add(alice, wp, wp1, "RELATES", null, JIRA, null, "t").andExpect(status().isOk()))
            .get(0)
            .get("id")
            .asLong();
    assertCode(
        update(alice, wp, wp2, id, "RELATES", null, null, null, "바꿈"),
        404,
        "EXTERNAL_LINK_NOT_FOUND");
    call(delete(path(wp, wp2) + "/" + id), alice).andExpect(status().isNoContent());
    assertThat(linkCount(wp1)).isEqualTo(1);
  }

  /** 없는 유형은 404, 숨긴 유형은 새로 못 붙이지만 이미 붙은 링크의 제목은 고칠 수 있다. */
  @Test
  void hiddenAndMissingType() throws Exception {
    long id =
        json(add(alice, wp, wp1, "RELATES", null, JIRA, null, "t").andExpect(status().isOk()))
            .get(0)
            .get("id")
            .asLong();
    dsl.execute("UPDATE issue_relation_type SET hidden = true WHERE code = 'RELATES'");
    assertCode(
        add(alice, wp, wp1, "RELATES", null, "https://x.test/h", null, "t"),
        400,
        "RELATION_TYPE_HIDDEN");
    update(alice, wp, wp1, id, "RELATES", null, null, null, "제목만 고침").andExpect(status().isOk());
    // 유형을 숨긴 유형으로 바꾸는 건 새로 거는 것과 같아 막는다.
    dsl.execute("UPDATE issue_relation_type SET hidden = true WHERE code = 'DUPLICATES'");
    assertCode(
        update(alice, wp, wp1, id, "DUPLICATES", null, null, null, "x"),
        400,
        "RELATION_TYPE_HIDDEN");

    call(
            post(path(wp, wp1))
                .content("{\"typeId\":999999999,\"url\":\"https://x.test/n\",\"title\":\"t\"}"),
            alice)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("RELATION_TYPE_NOT_FOUND"));
  }

  /** 외부 「차단」은 「차단 중」으로 보이지만 블로커 계산에는 들어가지 않는다. */
  @Test
  void blocksExternalNotBlocker() throws Exception {
    JsonNode list =
        json(
            add(alice, wp, wp1, "BLOCKS", null, "https://x.test/b", "X-1", "외부 차단")
                .andExpect(status().isOk()));
    assertThat(list.get(0).get("label").asText()).isEqualTo("차단 중");
    JsonNode d = detail(alice, wp, wp1);
    assertThat(d.get("summary").get("blocked").asBoolean()).isFalse();
    assertThat(d.get("summary").get("blockedBy")).isEmpty();
    assertThat(d.get("summary").get("blocks")).isEmpty();
  }

  /** OPEN 프로젝트를 읽기만 하는 비멤버는 붙이기·고치기·지우기 모두 403. */
  @Test
  void nonMemberForbidden() throws Exception {
    add(alice, wpv, wpv1, "RELATES", null, JIRA, null, "t").andExpect(status().isForbidden());
    update(alice, wpv, wpv1, 1L, "RELATES", null, null, null, "t")
        .andExpect(status().isForbidden());
    call(delete(path(wpv, wpv1) + "/1"), alice).andExpect(status().isForbidden());
    // 읽기는 된다.
    assertThat(detail(alice, wpv, wpv1).get("externalLinks")).isEmpty();
  }

  /** 상세 정렬 — 유형 정렬값 → 말 → 키 → id. */
  @Test
  void listSortedByTypeLabelKey() throws Exception {
    add(alice, wp, wp1, "PARENT_EPIC", null, "https://x.test/p", "Z-1", "에픽")
        .andExpect(status().isOk());
    add(alice, wp, wp1, "RELATES", null, "https://x.test/r2", "B-2", "관련2")
        .andExpect(status().isOk());
    add(alice, wp, wp1, "RELATES", null, "https://x.test/r1", "A-1", "관련1")
        .andExpect(status().isOk());
    add(alice, wp, wp1, "BLOCKS", null, "https://x.test/b", null, "차단").andExpect(status().isOk());
    JsonNode links = detail(alice, wp, wp1).get("externalLinks");
    assertThat(links).hasSize(4);
    assertThat(links.get(0).get("typeCode").asText()).isEqualTo("BLOCKS");
    assertThat(links.get(1).get("key").asText()).isEqualTo("A-1");
    assertThat(links.get(2).get("key").asText()).isEqualTo("B-2");
    assertThat(links.get(3).get("typeCode").asText()).isEqualTo("PARENT_EPIC");
  }

  /** 가져오기용 삽입 — 이력·실시간 없이 넣고, 같은 줄은 건너뛰고, 같은 주소 다른 유형은 409 예외. */
  @Test
  void insertForImportIdempotentAndConflict() {
    long issueId = issueId(wp1);
    long relates = typeId("RELATES");
    long causes = typeId("CAUSES");
    var link = new ResolvedExternalLink(relates, true, JIRA, "CL-1", "가져옴");
    long before = events.stream(ResourceChangedEvent.class).count();

    externalLinkService.insertForImport(issueId, alice, List.of(link, link));
    externalLinkService.insertForImport(issueId, alice, List.of(link));
    assertThat(linkCount(wp1)).isEqualTo(1);
    assertThat(history(wp1, "EXTERNAL_LINK_ADDED")).isEmpty();
    assertThat(events.stream(ResourceChangedEvent.class).count()).isEqualTo(before);

    // 방향 없는 유형은 side 와 무관하게 같은 줄로 본다.
    externalLinkService.insertForImport(
        issueId, alice, List.of(new ResolvedExternalLink(relates, false, JIRA, null, "x")));
    assertThat(linkCount(wp1)).isEqualTo(1);

    assertThatThrownBy(
            () ->
                externalLinkService.insertForImport(
                    issueId,
                    alice,
                    List.of(new ResolvedExternalLink(causes, true, JIRA, null, "x"))))
        .isInstanceOf(IssueRelationException.class)
        .hasMessageContaining("같은 주소");
  }

  /** 제목만 고치는 PUT(side 없음)은 저장된 방향을 지킨다 — target 링크가 source 로 뒤집히지 않는다. */
  @Test
  void putWithoutSideKeepsStoredDirection() throws Exception {
    long id =
        json(add(alice, wp, wp1, "CAUSES", "target", JIRA, null, "처음").andExpect(status().isOk()))
            .get(0)
            .get("id")
            .asLong();
    JsonNode edited =
        json(
            update(alice, wp, wp1, id, "CAUSES", null, null, null, "새 제목")
                .andExpect(status().isOk()));
    assertThat(edited.get(0).get("label").asText()).isEqualTo("결과임");
    assertThat(edited.get(0).get("title").asText()).isEqualTo("새 제목");
    assertThat(
            dsl.select(ISSUE_EXTERNAL_LINK.ISSUE_IS_SOURCE)
                .from(ISSUE_EXTERNAL_LINK)
                .where(ISSUE_EXTERNAL_LINK.ID.eq(id))
                .fetchOne(ISSUE_EXTERNAL_LINK.ISSUE_IS_SOURCE))
        .isFalse();
    JsonNode from =
        om.readTree(
            dsl.select(ISSUE_HISTORY.FROM_VALUE)
                .from(ISSUE_HISTORY)
                .where(ISSUE_HISTORY.EVENT_TYPE.eq("EXTERNAL_LINK_UPDATED"))
                .and(ISSUE_HISTORY.ISSUE_ID.eq(issueId(wp1)))
                .fetchOne(ISSUE_HISTORY.FROM_VALUE));
    assertThat(from.get("label").asText()).isEqualTo("결과임");
  }

  /** 관리자 가져오기는 숨긴 유형도 쓸 수 있다(이관 직전에 유형을 숨겨 둬도 일괄이 실패하지 않게). */
  @Test
  void insertForImportAllowsHiddenType() {
    dsl.execute("UPDATE issue_relation_type SET hidden = true WHERE code = 'RELATES'");
    externalLinkService.insertForImport(
        issueId(wp1),
        alice,
        List.of(new ResolvedExternalLink(typeId("RELATES"), true, JIRA, "CL-1", "숨긴 유형")));
    assertThat(linkCount(wp1)).isEqualTo(1);
  }

  /** normalizeUrl — 단위 확인(스킴·호스트·공백·길이). */
  @Test
  void normalizeUrlRules() {
    assertThat(IssueExternalLinkService.normalizeUrl("  https://a.b/c?q=1#f  "))
        .isEqualTo("https://a.b/c?q=1#f");
    assertThatThrownBy(
            () -> IssueExternalLinkService.normalizeUrl("https://a.b/" + "x".repeat(2000)))
        .isInstanceOf(IssueRelationException.class);
    assertThatThrownBy(() -> IssueExternalLinkService.normalizeUrl("mailto:a@b.c"))
        .isInstanceOf(IssueRelationException.class);
  }

  // ── 헬퍼 ────────────────────────────────────────────────────────────────────────────────

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

  /** WP 프로젝트의 이슈 번호 → id. */
  private long issueId(int number) {
    return dsl.select(ISSUE.ID)
        .from(ISSUE)
        .where(ISSUE.PROJECT_ID.eq(wpId).and(ISSUE.NUMBER.eq(number)))
        .fetchOne(ISSUE.ID);
  }

  private long typeId(String code) {
    return ((Number) dsl.fetchValue("SELECT id FROM issue_relation_type WHERE code = ?", code))
        .longValue();
  }

  private int linkCount(int number) {
    return dsl.fetchCount(ISSUE_EXTERNAL_LINK, ISSUE_EXTERNAL_LINK.ISSUE_ID.eq(issueId(number)));
  }

  /** WP 이슈의 해당 종류 이력 toValue 들(저장된 그대로). */
  private List<String> history(int number, String eventType) {
    return dsl.select(ISSUE_HISTORY.TO_VALUE)
        .from(ISSUE_HISTORY)
        .where(
            ISSUE_HISTORY.ISSUE_ID.eq(issueId(number)).and(ISSUE_HISTORY.EVENT_TYPE.eq(eventType)))
        .orderBy(ISSUE_HISTORY.ID)
        .fetch(ISSUE_HISTORY.TO_VALUE);
  }

  private String path(String projectKey, int number) {
    return "/api/v1/projects/" + projectKey + "/issues/" + number + "/external-links";
  }

  private String body(String typeCode, String side, String url, String key, String title)
      throws Exception {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("typeId", typeId(typeCode));
    m.put("side", side);
    m.put("url", url);
    m.put("key", key);
    m.put("title", title);
    return om.writeValueAsString(m);
  }

  private ResultActions add(
      long caller,
      String projectKey,
      int number,
      String typeCode,
      String side,
      String url,
      String key,
      String title)
      throws Exception {
    return call(
        post(path(projectKey, number)).content(body(typeCode, side, url, key, title)), caller);
  }

  private ResultActions update(
      long caller,
      String projectKey,
      int number,
      long linkId,
      String typeCode,
      String side,
      String url,
      String key,
      String title)
      throws Exception {
    return call(
        put(path(projectKey, number) + "/" + linkId).content(body(typeCode, side, url, key, title)),
        caller);
  }

  private JsonNode detail(long caller, String projectKey, int number) throws Exception {
    return json(
        call(get("/api/v1/projects/" + projectKey + "/issues/" + number), caller)
            .andExpect(status().isOk()));
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }

  private void assertCode(ResultActions r, int httpStatus, String code) throws Exception {
    r.andExpect(status().is(httpStatus));
    if (code != null) {
      r.andExpect(jsonPath("$.errors.code").value(code));
    }
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long caller) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L))
        .contentType(MediaType.APPLICATION_JSON);
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}
