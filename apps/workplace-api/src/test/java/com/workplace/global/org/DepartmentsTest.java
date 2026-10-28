package com.workplace.global.org;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Record1;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 조직도 부서 판정 공통 규칙(WP-1055, {@link Departments}) — 부서 트리 아래로·위로, 부서 구성원으로 셀 사람, 직접 속한 부서.
 *
 * <p>트리: 본부 > 개발팀 > 백엔드, 본부 > 영업팀. 구성원: 개발팀 직속(dev), 백엔드(backend — 개발팀에도 함께 들어 있음), 영업팀(sales), 그리고
 * 개발팀에 들어 있지만 세지 않을 사람 — AI(agent)·정지된 구성원(suspended)·비활성 계정(inactive). 개인 그룹(personal)에만 든
 * 사람(personalOnly).
 *
 * <p>@Transactional: 시드는 테스트가 끝나면 롤백된다.
 */
@Transactional
class DepartmentsTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;

  private long hqId;
  private long devId;
  private long backendId;
  private long salesId;
  private long personalId;
  private long dev;
  private long backend;
  private long sales;
  private long agent;
  private long suspended;
  private long inactive;
  private long personalOnly;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    hqId = group("본부-" + suffix, "SHARED", null, null);
    devId = group("개발팀-" + suffix, "SHARED", hqId, null);
    backendId = group("백엔드-" + suffix, "SHARED", devId, null);
    salesId = group("영업팀-" + suffix, "SHARED", hqId, null);
    dev = human();
    backend = human();
    sales = human();
    agent = createAgentUserWithMembership("dep-ai");
    suspended = human();
    TestFixtures.suspendMember(dsl, suspended, 1L);
    inactive = human();
    dsl.update(USER).set(USER.IS_ACTIVE, false).where(USER.ID.eq(inactive)).execute();
    personalOnly = human();
    personalId = group("내 분류-" + suffix, "PERSONAL", null, dev);

    member(devId, dev);
    member(backendId, backend);
    member(devId, backend); // 하위 부서와 상위 부서에 함께 — 한 번만 센다
    member(salesId, sales);
    member(devId, agent);
    member(devId, suspended);
    member(devId, inactive);
    member(personalId, personalOnly);
  }

  /** 아래로: 부서마다 자기와 하위 부서의 활성 사람 구성원만, 중복 없이. AI·정지·비활성은 빠진다. */
  @Test
  void subtree_members_are_active_humans_of_department_and_descendants() {
    var m = Departments.subtreeMembers("x", ids(hqId, devId, backendId, salesId));
    var rows =
        dsl.select(m.rootId(), m.userId()).from(m.table()).fetchGroups(m.rootId(), m.userId());

    assertThat(rows.get(hqId)).containsExactlyInAnyOrder(dev, backend, sales);
    assertThat(rows.get(devId)).containsExactlyInAnyOrder(dev, backend);
    assertThat(rows.get(backendId)).containsExactly(backend);
    assertThat(rows.get(salesId)).containsExactly(sales);
  }

  /** 아래로(트리만): 깊이는 자기 0 부터, 하위 그룹을 모두 낸다. */
  @Test
  void subtree_lists_descendants_with_depth() {
    var st = Departments.subtree("st", ids(hqId));
    var depthById =
        dsl.select(st.groupId(), st.depth()).from(st.table()).fetchMap(st.groupId(), st.depth());

    assertThat(depthById)
        .containsEntry(hqId, 0)
        .containsEntry(devId, 1)
        .containsEntry(salesId, 1)
        .containsEntry(backendId, 2)
        .hasSize(4);
  }

  /** 아래로: 같은 깊이는 화면 트리의 정렬 순서(sort_order) — (깊이, 형제 순서 경로)로 정렬하면 너비 우선이다. */
  @Test
  void subtree_orders_siblings_by_sort_order() {
    dsl.update(USER_GROUP).set(USER_GROUP.SORT_ORDER, 0).where(USER_GROUP.ID.eq(salesId)).execute();
    dsl.update(USER_GROUP).set(USER_GROUP.SORT_ORDER, 1).where(USER_GROUP.ID.eq(devId)).execute();

    var st = Departments.subtree("st", ids(hqId));
    List<Long> order =
        dsl.select(st.groupId())
            .from(st.table())
            .orderBy(st.depth(), st.sortPath(), st.groupId())
            .fetch(st.groupId());

    assertThat(order).containsExactly(hqId, salesId, devId, backendId);
  }

  /**
   * 아래로: 부모와 공개 범위·주인이 다른 하위는 따라가지 않는다 — 남의 개인 그룹이 부서 밑에 잘못 매달린 데이터(WP-677)가 있어도 그 그룹과 구성원이 부서 트리로
   * 새지 않는다.
   */
  @Test
  void subtree_does_not_follow_into_other_visibility_or_owner() {
    long stray = group("잘못 매달린 개인 그룹", "PERSONAL", null, sales);
    // 부모 검증을 거치지 않은 옛 데이터를 흉내 낸다.
    dsl.update(USER_GROUP)
        .set(USER_GROUP.PARENT_ID, devId)
        .where(USER_GROUP.ID.eq(stray))
        .execute();
    member(stray, personalOnly);

    var st = Departments.subtree("st", ids(devId));
    assertThat(dsl.select(st.groupId()).from(st.table()).fetch(st.groupId()))
        .containsExactlyInAnyOrder(devId, backendId);
    var m = Departments.subtreeMembers("x", ids(devId));
    assertThat(dsl.select(m.userId()).from(m.table()).fetch(m.userId()))
        .containsExactlyInAnyOrder(dev, backend);
  }

  /** 위로: 그룹과 모든 상위 그룹을 가까운 순으로. */
  @Test
  void ancestors_walk_up_nearest_first() {
    var a = Departments.ancestors("a", ids(backendId));
    List<Long> chain =
        dsl.select(a.groupId()).from(a.table()).orderBy(a.depth()).fetch(a.groupId());

    assertThat(chain).containsExactly(backendId, devId, hqId);
  }

  /** 사이클 데이터에도 탐색이 끝난다 — 지나온 그룹은 다시 가지 않는다. */
  @Test
  void traversal_terminates_on_cycle() {
    dsl.update(USER_GROUP)
        .set(USER_GROUP.PARENT_ID, backendId)
        .where(USER_GROUP.ID.eq(hqId))
        .execute();

    var st = Departments.subtree("st", ids(hqId));
    assertThat(dsl.select(st.groupId()).from(st.table()).fetch(st.groupId()))
        .containsExactlyInAnyOrder(hqId, devId, backendId, salesId);
    var a = Departments.ancestors("a", ids(backendId));
    assertThat(dsl.select(a.groupId()).from(a.table()).fetch(a.groupId()))
        .containsExactlyInAnyOrder(backendId, devId, hqId);
  }

  /** 위로(사람 기준): 내 부서와 그 상위 부서. 형제 부서·개인 그룹은 아니고, 세지 않을 사람은 어느 부서에도 걸리지 않는다. */
  @Test
  void with_ancestors_of_person_covers_own_and_upper_departments_only() {
    assertThat(myDepartments(backend)).containsExactlyInAnyOrder(backendId, devId, hqId);
    assertThat(myDepartments(dev)).containsExactlyInAnyOrder(devId, hqId);
    assertThat(myDepartments(sales)).containsExactlyInAnyOrder(salesId, hqId);
    assertThat(myDepartments(agent)).isEmpty();
    assertThat(myDepartments(suspended)).isEmpty();
    assertThat(myDepartments(inactive)).isEmpty();
    assertThat(myDepartments(personalOnly)).isEmpty();
  }

  /** 직접 속한 부서: 상위 부서는 따라가지 않고 개인 그룹은 아니다. */
  @Test
  void direct_department_is_shared_and_direct_only() {
    assertThat(directDepartments(backend)).containsExactlyInAnyOrder(devId, backendId);
    assertThat(directDepartments(sales)).containsExactly(salesId);
    assertThat(directDepartments(personalOnly)).isEmpty();
  }

  /** 활성 사람 구성원 조건 — 바깥 질의에 "user" 가 있어도 섞이지 않는다. */
  @Test
  void active_human_member_works_inside_outer_user_query() {
    List<Long> active =
        dsl.select(USER.ID)
            .from(USER)
            .where(USER.ID.in(dev, agent, suspended, inactive))
            .and(Departments.activeHumanMember(USER.ID, DSL.val(1L)))
            .fetch(USER.ID);

    assertThat(active).containsExactly(dev);
  }

  private List<Long> myDepartments(long userId) {
    // IN 의 피연산자라 같은 상위 부서가 여러 번 나올 수 있다 — 집합으로 본다.
    return dsl.fetch(Departments.withAncestorsOf(DSL.val(userId))).getValues(0, Long.class).stream()
        .distinct()
        .toList();
  }

  private List<Long> directDepartments(long userId) {
    return dsl.select(USER_GROUP.ID)
        .from(USER_GROUP)
        .where(Departments.directDepartmentOf(USER_GROUP, DSL.val(userId)))
        .fetch(USER_GROUP.ID);
  }

  private static Select<Record1<Long>> ids(Long... groupIds) {
    return DSL.select(USER_GROUP.ID).from(USER_GROUP).where(USER_GROUP.ID.in(groupIds));
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
}
