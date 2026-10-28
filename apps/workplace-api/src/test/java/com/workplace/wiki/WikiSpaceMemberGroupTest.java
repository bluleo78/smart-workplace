package com.workplace.wiki;

import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE;
import static com.workplace.jooq.Tables.WIKI_SPACE_MEMBER_GROUP;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.repository.SharedMemorySpaceRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.UserGroupService;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiSpaceAudienceChangedEvent;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceMemberGroupService;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
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
 * 노트 스페이스 멤버에 조직도 부서(부서 자체)를 둔다(WP-1052).
 *
 * <ul>
 *   <li>부서와 하위 부서의 활성 사람 구성원이 부서 행의 역할로 스페이스를 읽고(VIEWER)·고친다(EDITOR). 소속은 판정 때마다 다시 본다.
 *   <li>실효 역할 = 직접 멤버 역할과 부서 역할 중 가장 높은 것 — 스페이스 단건·목록·홈 공용 메모리가 같은 값을 보인다.
 *   <li>부서 행은 EDITOR·VIEWER 만, 조직도 부서(SHARED)만(개인·없는 그룹 400). 부서를 지우면 행도 사라진다(CASCADE).
 *   <li>검색은 직접·부서 양쪽에 걸려도 페이지를 한 번만 낸다.
 *   <li>부서로 들어오는 사람이 바뀌면 스페이스 단위 신호(WikiSpaceAudienceChangedEvent) — 편집을 잃은 사람이 만든 공유는 해제된다.
 * </ul>
 *
 * <p>@Transactional: MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고 끝나면 롤백된다({@link WikiShareGroupTest} 와 같은 방식).
 * 그래서 커밋 직전 리스너(공유 정리)는 테스트에서 직접 부른다.
 */
@Transactional
@RecordApplicationEvents
class WikiSpaceMemberGroupTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiSpaceMemberGroupService memberGroupService;
  @Autowired WikiSpaceMemberRepository spaceMembers;
  @Autowired WikiPageService pageService;
  @Autowired SharedMemorySpaceRepository sharedMemorySpaces;
  @Autowired UserGroupService groupService;
  @Autowired ApplicationEvents appEvents;

  private long ownerId; // 스페이스 OWNER
  private long devMemberId; // 개발팀 직속 구성원(스페이스 직접 멤버 아님)
  private long backendMemberId; // 개발팀 > 백엔드 구성원
  private long strangerId; // 어느 부서에도 없음
  private long spaceId;
  private long rootId;
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
    spaceId = spaceService.createTeamSpace(ownerId, "부서멤버-" + suffix).id();
    rootId =
        pageService.create(ownerId, spaceId, new CreatePageRequest(null, "로드맵-" + suffix)).id();
    devId = group("개발팀-" + suffix, "SHARED", null, null);
    backendId = group("백엔드-" + suffix, "SHARED", devId, null);
    member(devId, devMemberId);
    member(backendId, backendMemberId);
  }

  /** 부서 EDITOR — 부서·하위 부서 구성원은 페이지를 읽고 새 페이지를 만들 수 있다. 부서 밖 사람은 비멤버(404). */
  @Test
  void department_and_sub_department_members_read_and_edit() throws Exception {
    addGroup(devId, "EDITOR").andExpect(status().isCreated());

    for (long user : List.of(devMemberId, backendMemberId)) {
      call(get("/api/v1/wiki/pages/{id}", rootId), user).andExpect(status().isOk());
      createPage(user).andExpect(status().isCreated());
      call(get("/api/v1/wiki/spaces/{id}", spaceId), user)
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.role").value("EDITOR"));
    }
    call(get("/api/v1/wiki/pages/{id}", rootId), strangerId).andExpect(status().isNotFound());
  }

  /** 부서 VIEWER 는 읽기만 — 페이지 만들기는 403. 부서 구성원이라도 멤버 관리(OWNER)는 할 수 없다. */
  @Test
  void department_viewer_reads_only_and_cannot_manage() throws Exception {
    addGroup(devId, "VIEWER").andExpect(status().isCreated());

    call(get("/api/v1/wiki/pages/{id}", rootId), devMemberId).andExpect(status().isOk());
    createPage(devMemberId).andExpect(status().isForbidden());
    call(get("/api/v1/wiki/spaces/{id}/member-groups", spaceId), devMemberId)
        .andExpect(status().isOk());
    call(
            post("/api/v1/wiki/spaces/{id}/member-groups", spaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("groupId", backendId, "role", "EDITOR"))),
            devMemberId)
        .andExpect(status().isForbidden());
  }

  /** 실효 역할은 가장 높은 것 — 직접 VIEWER + 부서 EDITOR → EDITOR. 단건·목록·홈 공용 메모리가 같은 값. 거꾸로도 같다. */
  @Test
  void highest_role_wins() throws Exception {
    spaceService.addMember(ownerId, spaceId, devMemberId, "VIEWER");
    addGroup(devId, "EDITOR").andExpect(status().isCreated());

    call(get("/api/v1/wiki/spaces/{id}", spaceId), devMemberId)
        .andExpect(jsonPath("$.role").value("EDITOR"));
    JsonNode list = json(call(get("/api/v1/wiki/spaces"), devMemberId).andExpect(status().isOk()));
    List<JsonNode> mine = matching(list, spaceId);
    assertThat(mine).hasSize(1); // 직접·부서 양쪽에 걸려도 한 번만
    assertThat(mine.get(0).get("role").asText()).isEqualTo("EDITOR");
    assertThat(sharedMemorySpaces.teamWikis(devMemberId))
        .filteredOn(w -> w.wiki().id() == spaceId)
        .singleElement()
        .satisfies(w -> assertThat(w.role()).isEqualTo("EDITOR"));
    createPage(devMemberId).andExpect(status().isCreated());

    // 직접 EDITOR + 부서 VIEWER → EDITOR.
    spaceService.changeRole(ownerId, spaceId, devMemberId, "EDITOR");
    changeGroup(devId, "VIEWER").andExpect(status().isOk());
    assertThat(spaceMembers.findRole(spaceId, devMemberId)).contains("EDITOR");
  }

  /** 부서로만 들어온 사람의 스페이스는 목록에 보인다(부서 역할로). 부서에서 빠지면 다시 막힌다(404). */
  @Test
  void removed_from_department_loses_access() throws Exception {
    addGroup(devId, "EDITOR").andExpect(status().isCreated());
    JsonNode list = json(call(get("/api/v1/wiki/spaces"), backendMemberId));
    assertThat(matching(list, spaceId)).singleElement();

    dsl.deleteFrom(USER_GROUP_MEMBER)
        .where(USER_GROUP_MEMBER.GROUP_ID.eq(backendId))
        .and(USER_GROUP_MEMBER.TARGET_ID.eq(backendMemberId))
        .execute();

    call(get("/api/v1/wiki/pages/{id}", rootId), backendMemberId).andExpect(status().isNotFound());
    assertThat(matching(json(call(get("/api/v1/wiki/spaces"), backendMemberId)), spaceId))
        .isEmpty();
  }

  /** 부서 행은 EDITOR·VIEWER 만, 조직도 부서만 — OWNER·모르는 역할·개인 그룹·없는 그룹은 400. */
  @Test
  void rejects_owner_role_personal_and_missing_groups() throws Exception {
    addGroup(devId, "OWNER").andExpect(status().isBadRequest());
    addGroup(devId, "ADMIN").andExpect(status().isBadRequest());
    long personal = group("내그룹-" + suffix, "PERSONAL", null, ownerId);
    member(personal, strangerId);
    addGroup(personal, "EDITOR").andExpect(status().isBadRequest());
    addGroup(-1L, "EDITOR").andExpect(status().isBadRequest());
    assertThat(dsl.fetchCount(WIKI_SPACE_MEMBER_GROUP)).isZero();

    addGroup(devId, "EDITOR").andExpect(status().isCreated());
    changeGroup(devId, "OWNER").andExpect(status().isBadRequest());
  }

  /** 검색 — 직접 멤버이면서 부서 멤버여도 페이지가 한 번만 나온다. 부서로만 들어온 사람도 찾는다. */
  @Test
  void search_has_no_duplicates() throws Exception {
    spaceService.addMember(ownerId, spaceId, devMemberId, "VIEWER");
    addGroup(devId, "EDITOR").andExpect(status().isCreated());

    for (long user : List.of(devMemberId, backendMemberId)) {
      JsonNode found =
          json(
              call(get("/api/v1/wiki/search").param("q", "로드맵-" + suffix), user)
                  .andExpect(status().isOk()));
      assertThat(found).hasSize(1);
      assertThat(found.get(0).get("id").asLong()).isEqualTo(rootId);
    }
  }

  /** 부서를 지우면 멤버 부서 행도 사라지고(CASCADE) 그 구성원은 더 열 수 없다. */
  @Test
  void deleting_department_removes_row() throws Exception {
    addGroup(devId, "EDITOR").andExpect(status().isCreated());
    call(get("/api/v1/wiki/pages/{id}", rootId), devMemberId).andExpect(status().isOk());

    dsl.deleteFrom(USER_GROUP).where(USER_GROUP.ID.eq(devId)).execute();

    assertThat(dsl.fetchCount(WIKI_SPACE_MEMBER_GROUP)).isZero();
    call(get("/api/v1/wiki/pages/{id}", rootId), devMemberId).andExpect(status().isNotFound());
  }

  /**
   * member-groups CRUD — 추가 201(이름·역할·하위 포함 인원 수, 같은 부서 다시 추가는 역할 덮어쓰기), 목록, 역할 변경, 제거 204. 없는 부서
   * 행의 변경·제거는 404. 변경마다 스페이스 단위 신호가 나간다.
   */
  @Test
  void member_groups_crud_and_member_count() throws Exception {
    // AI·정지된 구성원은 세지 않는다 — 직속 사람 1 + 하위 부서 사람 1 = 2명. 두 부서에 겹친 사람은 한 번.
    member(devId, createAgentUserWithMembership("dept-agent"));
    member(devId, backendMemberId);
    appEvents.clear();

    JsonNode added = json(addGroup(devId, "EDITOR").andExpect(status().isCreated()));
    assertThat(added.get("groupId").asLong()).isEqualTo(devId);
    assertThat(added.get("name").asText()).isEqualTo("개발팀-" + suffix);
    assertThat(added.get("role").asText()).isEqualTo("EDITOR");
    assertThat(added.get("memberCount").asInt()).isEqualTo(2);
    assertThat(audienceChanged()).containsExactly(List.of(spaceId));

    // 같은 부서를 다시 더하면 역할을 덮어쓴다(사람 멤버 추가와 같은 업서트).
    addGroup(devId, "VIEWER")
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.role").value("VIEWER"));
    addGroup(backendId, "EDITOR").andExpect(status().isCreated());

    JsonNode list =
        json(
            call(get("/api/v1/wiki/spaces/{id}/member-groups", spaceId), ownerId)
                .andExpect(status().isOk()));
    assertThat(list).hasSize(2);
    JsonNode backend = matchingGroup(list, backendId);
    assertThat(backend.get("role").asText()).isEqualTo("EDITOR");
    assertThat(backend.get("memberCount").asInt()).isEqualTo(1);
    assertThat(matchingGroup(list, devId).get("role").asText()).isEqualTo("VIEWER");

    changeGroup(devId, "EDITOR")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.role").value("EDITOR"))
        .andExpect(jsonPath("$.memberCount").value(2));

    call(delete("/api/v1/wiki/spaces/{id}/member-groups/{g}", spaceId, devId), ownerId)
        .andExpect(status().isNoContent());
    call(delete("/api/v1/wiki/spaces/{id}/member-groups/{g}", spaceId, devId), ownerId)
        .andExpect(status().isNotFound());
    changeGroup(devId, "VIEWER").andExpect(status().isNotFound());
    // 실효 멤버(실시간 알림 수신자) — 직접 OWNER + 남은 백엔드 부서 구성원.
    assertThat(spaceMembers.memberUserIds(spaceId))
        .containsExactlyInAnyOrder(ownerId, backendMemberId);
  }

  /** 실효 멤버 명단(SSE·변경 알림 수신자)은 직접 멤버와 부서·하위 부서 구성원을 중복 없이 낸다. */
  @Test
  void member_user_ids_include_department_members_once() throws Exception {
    spaceService.addMember(ownerId, spaceId, devMemberId, "VIEWER");
    addGroup(devId, "EDITOR").andExpect(status().isCreated());

    assertThat(spaceMembers.memberUserIds(spaceId))
        .containsExactlyInAnyOrder(ownerId, devMemberId, backendMemberId);
  }

  /**
   * 부서로만 편집자인 사람도 공유를 만들 수 있고, 부서에서 빠져 편집을 잃으면 그 공유가 해제된다 — 부서 구성원 감소가 스페이스 단위 신호를 내고, 커밋 직전 정리가
   * 공유를 해제한다(테스트 트랜잭션은 커밋하지 않아 정리 리스너를 직접 부른다).
   */
  @Test
  void department_member_reduction_revokes_shares_of_creators_who_lost_edit() throws Exception {
    TestFixtures.grantRole(dsl, ownerId, "ADMIN"); // 조직도 쓰기 권한
    addGroup(devId, "EDITOR").andExpect(status().isCreated());
    saveShare(backendMemberId).andExpect(status().isOk());
    saveShare(devMemberId, pageAs(ownerId)).andExpect(status().isOk());
    assertThat(dsl.fetchCount(WIKI_PAGE_SHARE)).isEqualTo(2);
    appEvents.clear();

    groupService.removeMember(ownerId, backendId, "MEMBER", backendMemberId);

    List<WikiSpaceAudienceChangedEvent> events =
        appEvents.stream(WikiSpaceAudienceChangedEvent.class).toList();
    assertThat(events).hasSize(1);
    assertThat(events.get(0).spaceIds()).containsExactly(spaceId);
    memberGroupService.onSpaceAudienceChanged(events.get(0));

    // 편집을 잃은 백엔드 구성원의 공유만 해제되고, 여전히 부서 편집자인 개발팀 구성원의 공유는 남는다.
    assertThat(
            dsl.select(WIKI_PAGE_SHARE.CREATED_BY)
                .from(WIKI_PAGE_SHARE)
                .fetch(WIKI_PAGE_SHARE.CREATED_BY))
        .containsExactly(devMemberId);
  }

  /** 직접 역할을 보기로 내려도 부서로 여전히 편집자면 그 사람의 공유는 남는다. 부서 행을 빼면(편집을 잃으면) 해제된다. */
  @Test
  void direct_demotion_keeps_shares_while_department_grants_edit() throws Exception {
    spaceService.addMember(ownerId, spaceId, devMemberId, "EDITOR");
    addGroup(devId, "EDITOR").andExpect(status().isCreated());
    saveShare(devMemberId).andExpect(status().isOk());

    spaceService.changeRole(ownerId, spaceId, devMemberId, "VIEWER");
    assertThat(dsl.fetchCount(WIKI_PAGE_SHARE)).isEqualTo(1);

    appEvents.clear();
    call(delete("/api/v1/wiki/spaces/{id}/member-groups/{g}", spaceId, devId), ownerId)
        .andExpect(status().isNoContent());
    memberGroupService.onSpaceAudienceChanged(
        appEvents.stream(WikiSpaceAudienceChangedEvent.class).findFirst().orElseThrow());
    assertThat(dsl.fetchCount(WIKI_PAGE_SHARE)).isZero();
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────

  private List<List<Long>> audienceChanged() {
    return appEvents.stream(WikiSpaceAudienceChangedEvent.class)
        .map(WikiSpaceAudienceChangedEvent::spaceIds)
        .toList();
  }

  private static List<JsonNode> matching(JsonNode spaces, long id) {
    List<JsonNode> out = new java.util.ArrayList<>();
    spaces.forEach(
        s -> {
          if (s.get("id").asLong() == id) out.add(s);
        });
    return out;
  }

  private static JsonNode matchingGroup(JsonNode groups, long groupId) {
    for (JsonNode g : groups) {
      if (g.get("groupId").asLong() == groupId) return g;
    }
    throw new AssertionError("부서 " + groupId + " 가 목록에 없다");
  }

  private ResultActions addGroup(long groupId, String role) throws Exception {
    return call(
        post("/api/v1/wiki/spaces/{id}/member-groups", spaceId)
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(Map.of("groupId", groupId, "role", role))),
        ownerId);
  }

  private ResultActions changeGroup(long groupId, String role) throws Exception {
    return call(
        patch("/api/v1/wiki/spaces/{id}/member-groups/{g}", spaceId, groupId)
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(Map.of("role", role))),
        ownerId);
  }

  private ResultActions createPage(long userId) throws Exception {
    return call(
        post("/api/v1/wiki/spaces/{id}/pages", spaceId)
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(Map.of("title", "새 페이지"))),
        userId);
  }

  /** 소유자가 만든 새 페이지 id — 공유는 페이지마다 하나라 사람마다 다른 페이지에 둔다. */
  private long pageAs(long userId) {
    TenantContext.set(1L);
    return pageService.create(userId, spaceId, new CreatePageRequest(null, "쪽-" + suffix)).id();
  }

  private ResultActions saveShare(long userId) throws Exception {
    return saveShare(userId, rootId);
  }

  /** userId 가 pageId 에 워크스페이스 전체 보기 공유를 만든다. */
  private ResultActions saveShare(long userId, long pageId) throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("audience", "WORKSPACE");
    body.put("permission", "VIEW");
    body.put("includeChildren", false);
    body.put("userIds", List.of());
    body.put("expiresAt", null);
    return call(
        put("/api/v1/wiki/pages/{id}/share", pageId)
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(body)),
        userId);
  }

  private long human() {
    return withMembership(TestFixtures.createHuman(dsl));
  }

  /** 그룹 시드 — PERSONAL 이면 owner 가 소유자. */
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

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}
