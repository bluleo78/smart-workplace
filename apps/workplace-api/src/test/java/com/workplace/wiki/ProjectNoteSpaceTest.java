package com.workplace.wiki;

import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.SharedMemoryFixtures;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.dto.UpdateMemberRoleRequest;
import com.workplace.project.dto.UpdateProjectRequest;
import com.workplace.project.service.ProjectMemberGroupService;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.WikiMemberGroupResponse;
import com.workplace.wiki.dto.WikiSpaceResponse;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.exception.WikiProjectSpaceConflictException;
import com.workplace.wiki.exception.WikiSpaceNotFoundException;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageCreatedEvent;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import com.workplace.wiki.service.ProjectNoteSpaceBackfill;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceMemberGroupService;
import com.workplace.wiki.service.WikiSpaceService;
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
 * 프로젝트 노트 공간(WP-1480) — TEAM·OPEN 프로젝트마다 노트 공간 하나, 멤버는 프로젝트를 따라간다.
 *
 * <ul>
 *   <li>만들기: 프로젝트 생성 → 공간 + 맨 위 「리포트」 + 만든 사람 OWNER. 개인 프로젝트는 없음. 백필은 멱등
 *   <li>이름: 프로젝트 이름, 겹치면 「X 프로젝트」·「X 프로젝트 2」. 이름 변경 따라감
 *   <li>멤버: OWNER→OWNER, MEMBER(사람·AI)→EDITOR, 부서→부서 EDITOR, 빠지면 공간에서도 빠짐. 테넌트 ADMIN·OPEN 비멤버는 못 봄
 *   <li>노트 앱 수동 멤버 편집·삭제 거절. 프로젝트 삭제 → 연결 끊김. 기존 팀 공간 연결 API
 * </ul>
 *
 * <p>@Transactional: MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고 끝나면 롤백된다.
 */
@Transactional
@RecordApplicationEvents
class ProjectNoteSpaceTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberGroupService projectGroupService;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiSpaceMemberGroupService spaceGroupService;
  @Autowired WikiSpaceMemberRepository spaceMembers;
  @Autowired WikiPageService pageService;
  @Autowired ProjectNoteSpaceBackfill backfill;
  @Autowired ApplicationEvents appEvents;

  private long ownerId;
  private String suffix;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    suffix = UUID.randomUUID().toString().substring(0, 8);
    ownerId = human();
  }

  // ── 만들기·이름 ──

  /** TEAM·OPEN 프로젝트를 만들면 공간 하나 + 「리포트」 + 만든 사람 OWNER, 응답에 projectKey. 개인 프로젝트는 공간이 없다. */
  @Test
  void creating_team_and_open_projects_creates_a_space_with_report_page() {
    for (String type : List.of("TEAM", "OPEN")) {
      ProjectResponse p = project(ownerId, "N-" + type + "-" + suffix, type);
      long spaceId = spaceIdOf(p);
      WikiSpaceResponse space = spaceService.getSpace(ownerId, spaceId);
      assertThat(space.type()).isEqualTo("TEAM");
      assertThat(space.name()).isEqualTo("N-" + type + "-" + suffix);
      assertThat(space.role()).isEqualTo("OWNER");
      assertThat(space.projectKey()).isEqualTo(p.key());
      assertThat(pageService.listTree(ownerId, spaceId))
          .extracting(s -> s.title())
          .containsExactly("리포트");
    }
    ProjectResponse personal =
        projectService.create(
            ownerId, new CreateProjectRequest(null, "개인-" + suffix, null, "PERSONAL"));
    assertThat(linkedSpace(personal.id())).isNull();
  }

  /** 일반 공간은 projectKey 가 null — 목록에서 프로젝트 공간만 채워진다. */
  @Test
  void project_key_is_filled_only_for_project_spaces() {
    ProjectResponse p = project(ownerId, "K-" + suffix, "TEAM");
    long plain = spaceService.createTeamSpace(ownerId, "일반-" + suffix).id();
    Map<Long, String> keys = new java.util.HashMap<>();
    spaceService.listMySpaces(ownerId).forEach(s -> keys.put(s.id(), s.projectKey()));
    assertThat(keys.get(spaceIdOf(p))).isEqualTo(p.key());
    assertThat(keys).containsKey(plain);
    assertThat(keys.get(plain)).isNull();
  }

  /** 같은 이름 팀 공간이 있으면 「X 프로젝트」, 그것도 있으면 「X 프로젝트 2」. 프로젝트 이름을 바꾸면 따라간다. */
  @Test
  void name_collisions_get_suffixes_and_rename_follows() {
    String name = "이름-" + suffix;
    // 다른 사람의(호출자가 볼 수 없는) 팀 공간과도 겹치지 않게 한다 — 테넌트 전체 기준.
    spaceService.createTeamSpace(human(), name);
    ProjectResponse first = project(ownerId, name, "TEAM");
    assertThat(spaceName(first)).isEqualTo(name + " 프로젝트");
    ProjectResponse second = project(ownerId, name, "TEAM");
    assertThat(spaceName(second)).isEqualTo(name + " 프로젝트 2");

    // 설명만 바꾸면 이름은 그대로(규칙 꼴이라 「X」로 오가지 않는다).
    projectService.update(
        ownerId, first.key(), new UpdateProjectRequest(null, "설명", null, null, null, null));
    assertThat(spaceName(first)).isEqualTo(name + " 프로젝트");

    projectService.update(
        ownerId,
        first.key(),
        new UpdateProjectRequest("새이름-" + suffix, null, null, null, null, null));
    assertThat(spaceName(first)).isEqualTo("새이름-" + suffix);
  }

  /** 공간 없는 기존 프로젝트에 백필이 공간을 만들고, 두 번 돌려도 하나다. */
  @Test
  void backfill_creates_missing_space_once() {
    ProjectResponse p = project(ownerId, "B-" + suffix, "TEAM");
    // 기능 전 프로젝트 흉내 — 자동으로 생긴 공간을 지운다.
    dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.LINKED_PROJECT_ID.eq(p.id())).execute();
    assertThat(linkedSpace(p.id())).isNull();

    backfill.backfillTenant(1L);
    backfill.backfillTenant(1L);
    assertThat(dsl.fetchCount(WIKI_SPACE, WIKI_SPACE.LINKED_PROJECT_ID.eq(p.id()))).isEqualTo(1);
    long spaceId = spaceIdOf(p);
    assertThat(spaceService.getSpace(ownerId, spaceId).role()).isEqualTo("OWNER");
    assertThat(dsl.fetchCount(WIKI_PAGE, WIKI_PAGE.SPACE_ID.eq(spaceId))).isEqualTo(1);
  }

  /** 대소문자만 바꾼 이름 변경(Alpha→ALPHA)도 공간 이름에 반영된다. */
  @Test
  void case_only_rename_renames_space() {
    ProjectResponse p = project(ownerId, "Alpha-" + suffix, "TEAM");
    assertThat(spaceName(p)).isEqualTo("Alpha-" + suffix);
    projectService.update(
        ownerId,
        p.key(),
        new UpdateProjectRequest("ALPHA-" + suffix.toUpperCase(), null, null, null, null, null));
    assertThat(spaceName(p)).isEqualTo("ALPHA-" + suffix.toUpperCase());
  }

  /** 백필 때 프로젝트 소유자(owner_id)가 이미 떠났으면 「리포트」 작성자는 지금 OWNER 멤버다. */
  @Test
  void backfill_report_author_is_current_owner_when_original_owner_left() {
    ProjectResponse p = project(ownerId, "A-" + suffix, "TEAM");
    long newOwner = human();
    projectService.addMember(ownerId, p.key(), new AddMemberRequest(newOwner, "OWNER"));
    projectService.removeMember(newOwner, p.key(), ownerId);
    dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.LINKED_PROJECT_ID.eq(p.id())).execute();
    appEvents.clear();

    backfill.backfillTenant(1L);
    long spaceId = spaceIdOf(p);
    assertThat(appEvents.stream(WikiPageCreatedEvent.class))
        .filteredOn(e -> e.spaceId() == spaceId)
        .extracting(WikiPageCreatedEvent::actorId)
        .containsExactly(newOwner);
  }

  // ── 멤버 맞추기 ──

  /** 사람·AI 추가 → EDITOR, OWNER 로 바꾸면 OWNER, 빼면 공간·「리포트」를 못 읽는다(404). */
  @Test
  void member_changes_sync_to_space() {
    ProjectResponse p = project(ownerId, "M-" + suffix, "TEAM");
    long spaceId = spaceIdOf(p);
    long reportId = reportPage(spaceId);
    long member = human();
    long agent = createAgentUserWithMembership("ai");

    projectService.addMember(ownerId, p.key(), new AddMemberRequest(member, "MEMBER"));
    projectService.addMember(ownerId, p.key(), new AddMemberRequest(agent, "MEMBER"));
    assertThat(spaceMembers.findDirectRole(spaceId, member)).contains("EDITOR");
    assertThat(spaceMembers.findDirectRole(spaceId, agent)).contains("EDITOR");
    assertThat(pageService.get(member, reportId).title()).isEqualTo("리포트");

    projectService.updateMemberRole(ownerId, p.key(), member, new UpdateMemberRoleRequest("OWNER"));
    assertThat(spaceMembers.findDirectRole(spaceId, member)).contains("OWNER");

    projectService.removeMember(ownerId, p.key(), member);
    assertThat(spaceMembers.findDirectRole(spaceId, member)).isEmpty();
    assertThatThrownBy(() -> spaceService.getSpace(member, spaceId))
        .isInstanceOf(WikiSpaceNotFoundException.class);
    assertThatThrownBy(() -> pageService.get(member, reportId))
        .isInstanceOfAny(WikiSpaceNotFoundException.class, WikiPageNotFoundException.class);
  }

  /** 프로젝트 멤버 부서 추가·제거 → 공간 부서 EDITOR 추가·제거. */
  @Test
  void department_changes_sync_to_space_groups() {
    ProjectResponse p = project(ownerId, "G-" + suffix, "TEAM");
    long spaceId = spaceIdOf(p);
    long dept = department("부서-" + suffix);
    long deptMember = human();
    dsl.insertInto(USER_GROUP_MEMBER)
        .set(USER_GROUP_MEMBER.GROUP_ID, dept)
        .set(USER_GROUP_MEMBER.TARGET_TYPE, "MEMBER")
        .set(USER_GROUP_MEMBER.TARGET_ID, deptMember)
        .execute();

    projectGroupService.add(ownerId, p.key(), dept, null);
    assertThat(spaceGroupService.list(ownerId, spaceId))
        .extracting(WikiMemberGroupResponse::groupId, WikiMemberGroupResponse::role)
        .containsExactly(org.assertj.core.groups.Tuple.tuple(dept, "EDITOR"));
    assertThat(spaceService.getSpace(deptMember, spaceId).role()).isEqualTo("EDITOR");

    projectGroupService.remove(ownerId, p.key(), dept);
    assertThat(spaceGroupService.list(ownerId, spaceId)).isEmpty();
    assertThatThrownBy(() -> spaceService.getSpace(deptMember, spaceId))
        .isInstanceOf(WikiSpaceNotFoundException.class);
  }

  /** 프로젝트 밖 사람 — 테넌트 ADMIN·OPEN 프로젝트 비멤버 — 은 목록에 안 보이고 읽기 404. */
  @Test
  void outsiders_including_admin_cannot_see_project_space() {
    ProjectResponse open = project(ownerId, "O-" + suffix, "OPEN");
    long spaceId = spaceIdOf(open);
    long admin = human();
    SharedMemoryFixtures.grantAdmin(dsl, admin);
    long stranger = human();
    for (long outsider : List.of(admin, stranger)) {
      assertThat(spaceService.listMySpaces(outsider))
          .extracting(WikiSpaceResponse::id)
          .doesNotContain(spaceId);
      assertThatThrownBy(() -> spaceService.getSpace(outsider, spaceId))
          .isInstanceOf(WikiSpaceNotFoundException.class);
    }
  }

  /** 노트 앱에서 프로젝트 공간의 사람·부서 멤버를 바꾸거나 공간을 지우면 409. 멤버 목록 읽기는 된다. */
  @Test
  void manual_member_edits_and_delete_are_rejected_on_project_space() {
    ProjectResponse p = project(ownerId, "L-" + suffix, "TEAM");
    long spaceId = spaceIdOf(p);
    long other = human();
    long dept = department("잠금-" + suffix);

    assertThatThrownBy(() -> spaceService.addMember(ownerId, spaceId, other, "VIEWER"))
        .isInstanceOf(WikiProjectSpaceConflictException.class);
    assertThatThrownBy(() -> spaceService.changeRole(ownerId, spaceId, ownerId, "EDITOR"))
        .isInstanceOf(WikiProjectSpaceConflictException.class);
    assertThatThrownBy(() -> spaceService.removeMember(ownerId, spaceId, ownerId))
        .isInstanceOf(WikiProjectSpaceConflictException.class);
    assertThatThrownBy(() -> spaceGroupService.add(ownerId, spaceId, dept, "EDITOR"))
        .isInstanceOf(WikiProjectSpaceConflictException.class);
    assertThatThrownBy(() -> spaceService.deleteTeamSpace(ownerId, spaceId))
        .isInstanceOf(WikiProjectSpaceConflictException.class);
    assertThat(spaceService.listMembers(ownerId, spaceId)).hasSize(1);
  }

  /** 프로젝트를 지우면 공간 연결이 끊겨 일반 팀 공간으로 남는다(멤버 그대로). */
  @Test
  void deleting_project_unlinks_space() {
    ProjectResponse p = project(ownerId, "D-" + suffix, "TEAM");
    long spaceId = spaceIdOf(p);
    projectService.softDelete(ownerId, p.key());
    assertThat(linkedSpace(p.id())).isNull();
    WikiSpaceResponse space = spaceService.getSpace(ownerId, spaceId);
    assertThat(space.projectKey()).isNull();
    assertThat(space.role()).isEqualTo("OWNER");
  }

  // ── 조회·연결 API ──

  /** GET 은 공간 멤버만, 아니면 404. */
  @Test
  void get_project_space_for_members_only() throws Exception {
    ProjectResponse p = project(ownerId, "Q-" + suffix, "TEAM");
    long spaceId = spaceIdOf(p);
    call(get("/api/v1/wiki/project-spaces/" + p.key()), ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(spaceId))
        .andExpect(jsonPath("$.projectKey").value(p.key()));
    call(get("/api/v1/wiki/project-spaces/" + p.key()), human()).andExpect(status().isNotFound());
  }

  /** 연결 조건 — 프로젝트 OWNER 아님 403, 공간 OWNER 아님 403, 이미 연결된 공간 409, 개인 공간 409. */
  @Test
  void link_rejects_when_conditions_fail() throws Exception {
    ProjectResponse p = project(ownerId, "C-" + suffix, "TEAM");
    long projectMember = human();
    projectService.addMember(ownerId, p.key(), new AddMemberRequest(projectMember, "MEMBER"));
    long ownTeam = spaceService.createTeamSpace(projectMember, "멤버공간-" + suffix).id();
    // 프로젝트 MEMBER 는 자기 공간이어도 연결할 수 없다.
    link(p.key(), ownTeam, projectMember).andExpect(status().isForbidden());

    // 대상 공간에서 OWNER 가 아니면 403.
    long othersSpace = spaceService.createTeamSpace(projectMember, "남의공간-" + suffix).id();
    spaceService.addMember(projectMember, othersSpace, ownerId, "EDITOR");
    link(p.key(), othersSpace, ownerId).andExpect(status().isForbidden());

    // 이미 다른 프로젝트에 이어진 공간은 409.
    ProjectResponse other = project(ownerId, "C2-" + suffix, "TEAM");
    link(p.key(), spaceIdOf(other), ownerId).andExpect(status().isConflict());

    // 개인 공간은 409.
    long personal = spaceService.ensurePersonalSpace(ownerId).id();
    link(p.key(), personal, ownerId).andExpect(status().isConflict());
  }

  /** 연결 성공 — 「리포트」가 대상으로 옮겨지고, 비게 된 자동 공간은 지워지며, 대상의 프로젝트 밖 멤버는 빠진다. 이름은 그대로. */
  @Test
  void link_moves_report_deletes_empty_auto_space_and_syncs_members() throws Exception {
    ProjectResponse p = project(ownerId, "S-" + suffix, "TEAM");
    long autoId = spaceIdOf(p);
    long reportId = reportPage(autoId);
    long target = spaceService.createTeamSpace(ownerId, "기존공간-" + suffix).id();
    long outsider = human();
    spaceService.addMember(ownerId, target, outsider, "EDITOR");

    link(p.key(), target, ownerId)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(target))
        .andExpect(jsonPath("$.name").value("기존공간-" + suffix));

    assertThat(linkedSpace(p.id())).isEqualTo(target);
    assertThat(dsl.fetchExists(WIKI_SPACE, WIKI_SPACE.ID.eq(autoId))).isFalse();
    assertThat(dsl.select(WIKI_PAGE.SPACE_ID).from(WIKI_PAGE).where(WIKI_PAGE.ID.eq(reportId)))
        .extracting(r -> r.value1())
        .containsExactly(target);
    assertThat(spaceMembers.findDirectRole(target, outsider)).isEmpty();
    assertThat(spaceService.getSpace(ownerId, target).projectKey()).isEqualTo(p.key());
  }

  /** 연결한 공간(사용자가 고른 이름)은 설명만 고친 수정에 이름이 바뀌지 않고, 프로젝트 이름을 바꾸면 따라간다. */
  @Test
  void linked_space_keeps_user_name_on_description_edit_and_follows_rename() throws Exception {
    ProjectResponse p = project(ownerId, "R-" + suffix, "TEAM");
    long target = spaceService.createTeamSpace(ownerId, "고른이름-" + suffix).id();
    link(p.key(), target, ownerId).andExpect(status().isOk());

    projectService.update(
        ownerId, p.key(), new UpdateProjectRequest(null, "설명만", null, null, null, null));
    assertThat(spaceName(p)).isEqualTo("고른이름-" + suffix);

    projectService.update(
        ownerId, p.key(), new UpdateProjectRequest("바뀐이름-" + suffix, null, null, null, null, null));
    assertThat(spaceName(p)).isEqualTo("바뀐이름-" + suffix);
  }

  /** 다른 페이지가 있던 자동 공간은 지우지 않고 일반 팀 공간(연결 없음)으로 남는다. */
  @Test
  void link_keeps_auto_space_with_other_pages_as_plain_team_space() throws Exception {
    ProjectResponse p = project(ownerId, "K2-" + suffix, "TEAM");
    long autoId = spaceIdOf(p);
    pageService.create(ownerId, autoId, new CreatePageRequest(null, "회의록"));
    long target = spaceService.createTeamSpace(ownerId, "대상-" + suffix).id();

    link(p.key(), target, ownerId).andExpect(status().isOk());

    WikiSpaceResponse auto = spaceService.getSpace(ownerId, autoId);
    assertThat(auto.projectKey()).isNull();
    assertThat(pageService.listTree(ownerId, autoId))
        .extracting(s -> s.title())
        .containsExactly("회의록");
    assertThat(pageService.listTree(ownerId, target))
        .extracting(s -> s.title())
        .containsExactly("리포트");
  }

  // ── 도우미 ──

  private ProjectResponse project(long owner, String name, String type) {
    String key =
        "NS" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    return projectService.create(owner, new CreateProjectRequest(key, name, null, type));
  }

  private Long linkedSpace(long projectId) {
    return dsl.select(WIKI_SPACE.ID)
        .from(WIKI_SPACE)
        .where(WIKI_SPACE.LINKED_PROJECT_ID.eq(projectId))
        .fetchOne(WIKI_SPACE.ID);
  }

  private long spaceIdOf(ProjectResponse p) {
    Long id = linkedSpace(p.id());
    assertThat(id).as("프로젝트 노트 공간").isNotNull();
    return id;
  }

  private String spaceName(ProjectResponse p) {
    return dsl.select(WIKI_SPACE.NAME)
        .from(WIKI_SPACE)
        .where(WIKI_SPACE.ID.eq(spaceIdOf(p)))
        .fetchOne(WIKI_SPACE.NAME);
  }

  private long reportPage(long spaceId) {
    return dsl.select(WIKI_PAGE.ID)
        .from(WIKI_PAGE)
        .where(WIKI_PAGE.SPACE_ID.eq(spaceId))
        .and(WIKI_PAGE.TITLE.eq("리포트"))
        .fetchOne(WIKI_PAGE.ID);
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(id);
    return id;
  }

  private long department(String name) {
    return dsl.insertInto(USER_GROUP)
        .set(USER_GROUP.NAME, name)
        .set(USER_GROUP.VISIBILITY, "SHARED")
        .returning(USER_GROUP.ID)
        .fetchOne()
        .getId();
  }

  private ResultActions link(String key, long spaceId, long callerId) throws Exception {
    return call(
        put("/api/v1/wiki/project-spaces/" + key + "/link")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"spaceId\":" + spaceId + "}"),
        callerId);
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}
