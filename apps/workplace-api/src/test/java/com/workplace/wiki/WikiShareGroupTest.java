package com.workplace.wiki;

import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE_EVENT;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE_GROUP;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.outbound.WikiShareNotifyEvents.WikiSharedWithPeopleEvent;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiShareAccess;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
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
 * 노트를 조직도 부서(팀) 단위로 공유(WP-1023) — 지정한 사람(PEOPLE) 공유의 대상에 부서를 둔다.
 *
 * <ul>
 *   <li>부서와 하위 부서의 구성원은 열고, 아닌 사람은 403(접근 요청 가능). 소속은 열 때마다 다시 본다 — 빠지면 막히고 들어오면 열린다.
 *   <li>부서를 지우면 공유 대상에서도 빠진다(FK CASCADE). 개인 그룹·없는 그룹은 대상이 될 수 없다(400).
 *   <li>상위 공유의 하위 포함(WP-987)은 부서 대상에도 같다 — 하위 페이지가 열리고, 상위 공유 제외 표시면 막힌다.
 *   <li>공유 창 응답은 부서 이름과 지금 열 수 있는 사람 수(하위 부서 포함, 중복 제외, 활성 사람만)를 준다. 목록은 부서 수를 준다.
 *   <li>알림 보내기를 켜면 새로 열 수 있게 된 부서 구성원에게 한 번(공유한 사람·이미 열 수 있던 사람 제외).
 * </ul>
 *
 * <p>@Transactional: MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고 끝나면 롤백된다({@link WikiShareInheritanceTest} 와
 * 같은 방식).
 */
@Transactional
@RecordApplicationEvents
class WikiShareGroupTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired ApplicationEvents appEvents;

  private long ownerId; // 스페이스 OWNER, 공유한 사람
  private long devMemberId; // 개발팀 직속 구성원(스페이스 비멤버)
  private long backendMemberId; // 개발팀 > 백엔드 구성원(스페이스 비멤버)
  private long strangerId; // 같은 워크스페이스, 스페이스 비멤버, 어느 부서에도 없음
  private long spaceId;
  private long rootId;
  private long childId;
  private long devId; // 조직도 부서 「개발팀」
  private long backendId; // 개발팀의 하위 부서 「백엔드」
  private String suffix;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    suffix = UUID.randomUUID().toString().substring(0, 8);
    ownerId = human();
    devMemberId = human();
    backendMemberId = human();
    strangerId = human();
    spaceId = spaceService.createTeamSpace(ownerId, "부서공유-" + suffix).id();
    rootId = page(null, "제품 로드맵");
    childId = page(rootId, "1분기");
    devId = group("개발팀-" + suffix, "SHARED", null, null);
    backendId = group("백엔드-" + suffix, "SHARED", devId, null);
    member(devId, devMemberId);
    member(backendId, backendMemberId);
  }

  /** 부서를 대상으로 두면 그 부서와 하위 부서의 구성원은 열고, 아닌 사람은 403(접근 요청 화면). 하위 부서만 지정하면 상위 부서 구성원은 막힌다. */
  @Test
  void department_and_sub_department_members_open_others_forbidden() throws Exception {
    String token = save(rootId, false, List.of(), List.of(devId), null);

    openAs(devMemberId, rootId, token).andExpect(status().isOk());
    openAs(backendMemberId, rootId, token).andExpect(status().isOk());
    openAs(strangerId, rootId, token).andExpect(status().isForbidden());

    // 하위 부서만 대상이면 상위 부서의 구성원은 열 수 없다(위로 넓어지지 않는다).
    token = save(rootId, false, List.of(), List.of(backendId), null);
    openAs(backendMemberId, rootId, token).andExpect(status().isOk());
    openAs(devMemberId, rootId, token).andExpect(status().isForbidden());
  }

  /** 소속은 열 때마다 다시 본다 — 부서에서 빠지면 막히고, 나중에 들어온 사람은 열린다. 부서 구성원은 접근 요청을 만들지 않는다. */
  @Test
  void membership_is_checked_at_access_time() throws Exception {
    String token = save(rootId, false, List.of(), List.of(devId), null);
    openAs(backendMemberId, rootId, token).andExpect(status().isOk());

    dsl.deleteFrom(USER_GROUP_MEMBER)
        .where(USER_GROUP_MEMBER.GROUP_ID.eq(backendId))
        .and(USER_GROUP_MEMBER.TARGET_ID.eq(backendMemberId))
        .execute();
    openAs(backendMemberId, rootId, token).andExpect(status().isForbidden());

    member(backendId, strangerId);
    openAs(strangerId, rootId, token).andExpect(status().isOk());
    // 열 수 있는 사람의 접근 요청은 필요 없다(대기 요청을 만들지 않는다).
    call(post("/api/v1/wiki/shares/{t}/access-requests", token), strangerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("NOT_NEEDED"));
  }

  /** 부서를 지우면 공유 대상에서도 빠진다(FK CASCADE) — 그 구성원은 더 열 수 없고, 공유 창의 부서 목록도 빈다. */
  @Test
  void deleting_department_removes_target() throws Exception {
    String token = save(rootId, false, List.of(), List.of(devId), null);
    openAs(devMemberId, rootId, token).andExpect(status().isOk());

    // 하위 부서도 parent_id CASCADE 로 함께 지워진다.
    dsl.deleteFrom(USER_GROUP).where(USER_GROUP.ID.eq(devId)).execute();

    assertThat(dsl.fetchCount(WIKI_PAGE_SHARE_GROUP)).isZero();
    openAs(devMemberId, rootId, token).andExpect(status().isForbidden());
    openAs(backendMemberId, rootId, token).andExpect(status().isForbidden());
    call(get(sharePath(rootId)), ownerId).andExpect(jsonPath("$.share.groups").isEmpty());
  }

  /** 개인 그룹(내 그룹)·없는 그룹은 대상으로 저장할 수 없다(400) — 공유 창이 사람으로 펼쳐 보낸다. 저장되는 것은 없다. */
  @Test
  void personal_or_unknown_group_is_rejected() throws Exception {
    long personal = group("개발 스터디-" + suffix, "PERSONAL", null, ownerId);
    member(personal, strangerId);

    saveRaw(rootId, false, List.of(), List.of(personal), null)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("조직도 부서만 지정할 수 있습니다"));
    saveRaw(rootId, false, List.of(), List.of(99_999_999L), null)
        .andExpect(status().isBadRequest());
    assertThat(dsl.fetchCount(WIKI_PAGE_SHARE_GROUP)).isZero();
  }

  /** 상위 공유의 하위 포함(WP-987)은 부서 대상에도 같다 — 하위 부서 구성원도 하위 페이지를 열고, 그 하위가 상위 공유에서 제외되면 막힌다. */
  @Test
  void include_children_inheritance_applies_to_department_targets() throws Exception {
    String token = save(rootId, true, List.of(), List.of(devId), null);
    openAs(backendMemberId, childId, token).andExpect(status().isOk());
    openAs(strangerId, childId, token).andExpect(status().isForbidden());
    // 노트 주소로 들어온 부서 구성원(입구)도 그 공유의 토큰을 받는다.
    call(get("/api/v1/wiki/pages/{id}/entry", childId), backendMemberId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.shareToken").value(token));

    call(put(sharePath(childId) + "/exclusion"), ownerId).andExpect(status().isNoContent());
    openAs(backendMemberId, childId, token).andExpect(status().isNotFound());
  }

  /**
   * 공유 창 응답은 부서 이름과 지금 열 수 있는 사람 수(하위 부서 포함·중복 제외·활성 사람만 — 외부 연락처 제외)를 준다. 사람만 고친 요청(groupIds 없음)은
   * 부서를 지우지 않고, 대상을 워크스페이스 전체로 바꾸면 부서도 비워진다. 공유 목록은 부서 수를 준다. 기록에 부서 추가·제외가 남는다.
   */
  @Test
  void response_carries_department_name_and_member_count() throws Exception {
    member(backendId, devMemberId); // 상위·하위 둘 다에 든 사람은 한 번만 센다
    dsl.insertInto(USER_GROUP_MEMBER)
        .set(USER_GROUP_MEMBER.GROUP_ID, devId)
        .set(USER_GROUP_MEMBER.TARGET_TYPE, "EXTERNAL")
        .set(USER_GROUP_MEMBER.TARGET_ID, 123_456L)
        .execute();

    JsonNode saved =
        json(saveRaw(rootId, false, List.of(strangerId), List.of(devId), null)).get("groups");
    assertThat(saved).hasSize(1);
    assertThat(saved.get(0).get("groupId").asLong()).isEqualTo(devId);
    assertThat(saved.get(0).get("name").asText()).isEqualTo("개발팀-" + suffix);
    assertThat(saved.get(0).get("memberCount").asInt()).isEqualTo(2);

    // 사람만 고친 요청(groupIds 없음)은 부서를 그대로 둔다 — 부서를 모르는 이전 클라이언트.
    saveRaw(rootId, false, List.of(), null, null)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.groups[0].groupId").value(devId))
        .andExpect(jsonPath("$.people").isEmpty());

    call(get("/api/v1/wiki/spaces/{id}/shares", spaceId), ownerId)
        .andExpect(jsonPath("$[0].groupCount").value(1))
        .andExpect(jsonPath("$[0].peopleCount").value(0));

    // 워크스페이스 전체로 바꾸면 부서도 비워지고, 다시 지정한 사람으로 돌려도 옛 부서가 되살아나지 않는다.
    saveAudience(rootId, "WORKSPACE");
    saveRaw(rootId, false, List.of(), null, null).andExpect(jsonPath("$.groups").isEmpty());
    assertThat(eventTexts()).contains("개발팀-" + suffix + " 부서를 추가했습니다");

    save(rootId, false, List.of(), List.of(backendId), null);
    save(rootId, false, List.of(), List.of(), null);
    assertThat(eventTexts()).contains("백엔드-" + suffix + " 부서를 제외했습니다");
  }

  /**
   * 알림 보내기를 켜고 부서를 더하면 그 부서(하위 포함)의 지금 구성원과 새로 지정한 사람에게 한 번 — 공유한 사람 자신은 빼고, 이미 열 수 있던 사람(남아 있는 부서의
   * 구성원·이미 지정된 사람)에게는 다시 보내지 않는다. 알림 보내기를 끄면 보내지 않는다.
   */
  @Test
  void adding_department_notifies_new_members_once() throws Exception {
    member(devId, ownerId); // 공유한 사람이 부서에 있어도 자신에게는 보내지 않는다
    long newcomerId = human();
    save(rootId, false, List.of(strangerId), List.of(devId), Map.of());

    List<WikiSharedWithPeopleEvent> events =
        appEvents.stream(WikiSharedWithPeopleEvent.class).toList();
    assertThat(events).hasSize(1);
    assertThat(events.get(0).recipientIds())
        .containsExactlyInAnyOrder(strangerId, devMemberId, backendMemberId);

    // 다른 부서를 더한다 — 그 부서에 이미 열 수 있던 사람(개발팀 구성원·지정된 사람)이 있어도 새로 열린 사람에게만.
    long designId = group("디자인팀-" + suffix, "SHARED", null, null);
    member(designId, devMemberId);
    member(designId, strangerId);
    member(designId, newcomerId);
    save(rootId, false, List.of(strangerId), List.of(devId, designId), Map.of());
    events = appEvents.stream(WikiSharedWithPeopleEvent.class).toList();
    assertThat(events).hasSize(2);
    assertThat(events.get(1).recipientIds()).containsExactly(newcomerId);

    // 알림 보내기를 끄면 부서를 더해도 보내지 않는다.
    long opsId = group("운영팀-" + suffix, "SHARED", null, null);
    member(opsId, human());
    save(rootId, false, List.of(strangerId), List.of(devId, designId, opsId), null);
    assertThat(appEvents.stream(WikiSharedWithPeopleEvent.class)).hasSize(2);
  }

  /**
   * 부서 구성원으로 세는 사람은 공유 창의 사람 수와 같은 기준 — 활성 사람(HUMAN)·ACTIVE 멤버십만. 부서에 들어 있는 AI(AGENT)·정지된 구성원은 편집
   * 공유여도 열지 못하고(403), 사람 수·알림에서도 빠지며, 입구도 토큰을 주지 않는다.
   */
  @Test
  void only_active_human_members_count() throws Exception {
    long agentId = createAgentUserWithMembership("dept-agent");
    long suspendedId = human();
    member(devId, agentId);
    member(devId, suspendedId);
    TestFixtures.suspendMember(dsl, suspendedId, 1L);

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("audience", "PEOPLE");
    body.put("permission", "EDIT");
    body.put("includeChildren", false);
    body.put("userIds", List.of());
    body.put("groupIds", List.of(devId));
    body.put("expiresAt", null);
    body.put("notify", Map.of());
    JsonNode saved =
        json(
            call(
                    put(sharePath(rootId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(om.writeValueAsString(body)),
                    ownerId)
                .andExpect(status().isOk()));
    String token = saved.get("token").asText();
    // 개발팀 직속 사람 + 하위 백엔드 사람 = 2명(AI·정지된 구성원은 세지 않는다).
    assertThat(saved.get("groups").get(0).get("memberCount").asInt()).isEqualTo(2);

    openAs(agentId, rootId, token).andExpect(status().isForbidden());
    call(get("/api/v1/wiki/pages/{id}/entry", rootId), agentId).andExpect(status().isNotFound());
    openAs(devMemberId, rootId, token).andExpect(status().isOk());
    assertThat(appEvents.stream(WikiSharedWithPeopleEvent.class).toList().get(0).recipientIds())
        .containsExactlyInAnyOrder(devMemberId, backendMemberId);
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────

  private long human() {
    return withMembership(TestFixtures.createHuman(dsl));
  }

  private long page(Long parentId, String title) {
    TenantContext.set(1L);
    return pageService.create(ownerId, spaceId, new CreatePageRequest(parentId, title)).id();
  }

  /** 그룹 시드 — PERSONAL 이면 ownerId 가 소유자. */
  private long group(String name, String visibility, Long parentId, Long owner) {
    return dsl.insertInto(USER_GROUP)
        .set(USER_GROUP.NAME, name)
        .set(USER_GROUP.VISIBILITY, visibility)
        .set(USER_GROUP.PARENT_ID, parentId)
        .set(USER_GROUP.OWNER_ID, owner)
        .returning(USER_GROUP.ID)
        .fetchOne()
        .getId();
  }

  private void member(long groupId, long userId) {
    dsl.insertInto(USER_GROUP_MEMBER)
        .set(USER_GROUP_MEMBER.GROUP_ID, groupId)
        .set(USER_GROUP_MEMBER.TARGET_TYPE, "MEMBER")
        .set(USER_GROUP_MEMBER.TARGET_ID, userId)
        .execute();
  }

  /** 소유자가 PEOPLE 공유를 저장하고 토큰을 돌려준다. notify 가 null 이면 알림 보내기 끔. */
  private String save(
      long pageId,
      boolean children,
      List<Long> userIds,
      List<Long> groupIds,
      Map<String, Object> notify)
      throws Exception {
    return json(saveRaw(pageId, children, userIds, groupIds, notify).andExpect(status().isOk()))
        .get("token")
        .asText();
  }

  /** PEOPLE 공유 저장 요청 — groupIds 가 null 이면 필드를 보내지 않는다(부서를 모르는 이전 클라이언트). */
  private ResultActions saveRaw(
      long pageId,
      boolean children,
      List<Long> userIds,
      List<Long> groupIds,
      Map<String, Object> notify)
      throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("audience", "PEOPLE");
    body.put("permission", "VIEW");
    body.put("includeChildren", children);
    body.put("userIds", userIds);
    if (groupIds != null) {
      body.put("groupIds", groupIds);
    }
    body.put("expiresAt", null);
    body.put("notify", notify);
    return call(
        put(sharePath(pageId))
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(body)),
        ownerId);
  }

  private void saveAudience(long pageId, String audience) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("audience", audience);
    body.put("permission", "VIEW");
    body.put("includeChildren", false);
    body.put("userIds", List.of());
    body.put("expiresAt", null);
    call(
            put(sharePath(pageId))
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body)),
            ownerId)
        .andExpect(status().isOk());
  }

  private List<String> eventTexts() {
    return dsl.select(DSL.field("{0} ->> 'text'", String.class, WIKI_PAGE_SHARE_EVENT.DETAIL))
        .from(WIKI_PAGE_SHARE_EVENT)
        .where(WIKI_PAGE_SHARE_EVENT.PAGE_ID.eq(rootId))
        .fetch(r -> r.value1());
  }

  private ResultActions openAs(long userId, long pageId, String token) throws Exception {
    return call(get("/api/v1/wiki/pages/{id}", pageId), userId, token);
  }

  private static String sharePath(long pageId) {
    return "/api/v1/wiki/pages/" + pageId + "/share";
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    return call(req, userId, null);
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId, String shareToken)
      throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    if (shareToken != null) {
      req.header(WikiShareAccess.HEADER, shareToken);
    }
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}
