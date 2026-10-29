package com.workplace.global.share;

import static com.workplace.jooq.Tables.WIKI_SPACE_MEMBER;
import static com.workplace.jooq.Tables.WIKI_SPACE_MEMBER_GROUP;

import com.workplace.global.org.Departments;
import com.workplace.jooq.tables.WikiSpaceMember;
import com.workplace.jooq.tables.WikiSpaceMemberGroup;
import java.util.Collection;
import java.util.List;
import org.jooq.Condition;
import org.jooq.Field;
import org.jooq.Record1;
import org.jooq.Record2;
import org.jooq.Select;
import org.jooq.impl.DSL;

/**
 * 노트 스페이스 멤버십 판정(WP-1052) — 사람이 스페이스 멤버인지, 실효 역할이 무엇인지, 스페이스의 실효 멤버가 누구인지의 <b>유일한 규칙</b>. 스페이스 멤버는
 * 직접 멤버 행(wiki_space_member)과 멤버로 둔 조직도 부서 행(wiki_space_member_group) 두 가지다. 부서 행은 그 부서와 하위 부서의 활성
 * 사람 구성원에게 그 역할을 준다 — 소속은 판정할 때마다 공통 부서 규칙({@link Departments})으로 다시 본다. 실효 역할은 직접 행과 내가 걸리는 부서 행 중
 * 가장 높은 것(OWNER &gt; EDITOR &gt; VIEWER)이다.
 *
 * <p>노트 권한·목록·검색(wiki)과 홈 공용 메모리(home), 알림 목록의 가시성({@code NotificationRepository}, notify)이 함께 쓴다 —
 * 노트에서 열 수 있는 사람과 알림이 보이는 사람이 갈라지지 않게. 도메인끼리 서로의 패키지를 import 하지 않는다는
 * 규칙(apps/workplace-api/CLAUDE.md) 때문에 {@link WikiShareTargets} 처럼 공용(global)에 둔다. 조회를 실행하지 않고 jOOQ
 * 조각만 만든다 — 쓰는 쪽이 자기 쿼리 안에 끼워 한 번에 판정한다. 인자는 값(DSL.val)이나 바깥 질의의 열이고, 안쪽 테이블은 바깥과 섞이지 않게 별칭을 쓴다.
 */
public final class WikiSpaceMembership {

  private WikiSpaceMembership() {}

  /** 역할의 높이 — 실효 역할을 고를 때 정렬에 쓴다(OWNER 3 &gt; EDITOR 2 &gt; VIEWER 1). */
  private static Field<Integer> rank(Field<String> role) {
    return DSL.when(role.eq("OWNER"), DSL.inline(3))
        .when(role.eq("EDITOR"), DSL.inline(2))
        .otherwise(DSL.inline(1));
  }

  /**
   * 사람(userId)의 스페이스(spaceId) 실효 역할 — 직접 멤버 역할과, 내가 걸리는 부서 행(내 부서와 그 상위 부서가 멤버로 들어 있는 행)의 역할 중 가장
   * 높은 것. 멤버가 아니면 NULL. 스칼라 부분 질의라 select 목록이나 조건에 그대로 쓴다.
   */
  public static Field<String> effectiveRole(Field<Long> spaceId, Field<Long> userId) {
    WikiSpaceMember m = WIKI_SPACE_MEMBER.as("wsm_er_m");
    var roles =
        DSL.select(m.ROLE.as("role"))
            .from(m)
            .where(m.SPACE_ID.eq(spaceId))
            .and(m.USER_ID.eq(userId))
            // 부서 쪽은 멤버 창 안내와 같은 규칙(departmentRole) 하나로 — 둘이 어긋나지 않게(WP-1102).
            .unionAll(DSL.select(departmentRole(spaceId, userId).as("role")))
            .asTable("wsm_er");
    Field<String> role = roles.field("role", String.class);
    // 부서 역할이 없으면(NULL) 바깥에서 거른다 — NULL 행이 직접 VIEWER 와 같은 높이로 정렬돼 실효 역할이 NULL 로 나오지 않게. 안쪽 조건에 다시 쓰면
    // 부서 쪽 재귀 질의가 두 번 돌아 여기서 한 번만 거른다(WP-1166).
    return DSL.field(
        DSL.select(role).from(roles).where(role.isNotNull()).orderBy(rank(role).desc()).limit(1));
  }

  /**
   * 사람(userId)이 스페이스(spaceId)에서 멤버 부서로 받는 역할(WP-1102) — 내 부서와 그 상위 부서가 멤버로 들어 있는 행의 역할 중 가장 높은 것.
   * 부서로 받는 역할이 없으면 NULL. 멤버 창이 직접 역할보다 부서 역할이 높을 때 「조직으로 편집자」처럼 실효 역할을 안내하는 데 쓴다.
   */
  public static Field<String> departmentRole(Field<Long> spaceId, Field<Long> userId) {
    WikiSpaceMemberGroup g = WIKI_SPACE_MEMBER_GROUP.as("wsm_dr_g");
    return DSL.field(
        DSL.select(g.ROLE)
            .from(g)
            .where(g.SPACE_ID.eq(spaceId))
            .and(g.GROUP_ID.in(Departments.withAncestorsOf(userId)))
            .orderBy(rank(g.ROLE).desc())
            .limit(1));
  }

  /**
   * 사람들(userIds)이 스페이스(spaceId)에서 멤버 부서로 받는 역할 행 — (사람, 역할)을 부서 행마다 낸다(WP-1166). 멤버 목록처럼 여러 사람의 부서
   * 역할이 필요할 때 사람마다 {@link #departmentRole}(사람마다 재귀 질의)을 부르지 않고, 스페이스의 멤버 부서 트리를 한 번 펼쳐 구한다. 같은 규칙이다
   * — 멤버 부서와 그 하위 부서의 활성 사람 구성원({@link Departments#subtreeMembers}). 가장 높은 것을 고르는 것은 쓰는 쪽({@link
   * #higher})이 한다.
   */
  public static Select<Record2<Long, String>> departmentRoles(
      Field<Long> spaceId, Collection<Long> userIds) {
    WikiSpaceMemberGroup roots = WIKI_SPACE_MEMBER_GROUP.as("wsm_drs_r");
    Departments.SubtreeMembers sm =
        Departments.subtreeMembers(
            "wsm_drs",
            DSL.select(roots.GROUP_ID).from(roots).where(roots.SPACE_ID.eq(spaceId)),
            userIds);
    WikiSpaceMemberGroup g = WIKI_SPACE_MEMBER_GROUP.as("wsm_drs_g");
    return DSL.select(sm.userId(), g.ROLE)
        .from(sm.table())
        .join(g)
        .on(g.GROUP_ID.eq(sm.rootId()))
        .and(g.SPACE_ID.eq(spaceId));
  }

  /**
   * 사람(userId)이 스페이스(spaceId)의 멤버인가 — 직접 멤버이거나, 내 부서와 그 상위 부서 중 하나가 멤버로 들어 있다. 역할은 보지 않는다(어떤 역할이든
   * 멤버). 목록·검색처럼 행을 거르는 곳에서 조인 대신 쓴다 — 직접·부서 양쪽에 걸려도 행이 겹치지 않는다.
   */
  public static Condition isMember(Field<Long> spaceId, Field<Long> userId) {
    WikiSpaceMember m = WIKI_SPACE_MEMBER.as("wsm_im_m");
    WikiSpaceMemberGroup g = WIKI_SPACE_MEMBER_GROUP.as("wsm_im_g");
    return DSL.exists(
            DSL.selectOne().from(m).where(m.SPACE_ID.eq(spaceId)).and(m.USER_ID.eq(userId)))
        .or(
            DSL.exists(
                DSL.selectOne()
                    .from(g)
                    .where(g.SPACE_ID.eq(spaceId))
                    .and(g.GROUP_ID.in(Departments.withAncestorsOf(userId)))));
  }

  /**
   * 사람(userId)의 실효 역할이 minRole 이상인가 — 직접 행이나 부서 행 중 하나라도 minRole 이상이면 참. 공유 목록처럼 「편집 이상인 스페이스」를 거를
   * 때 쓴다.
   */
  public static Condition hasRoleAtLeast(Field<Long> spaceId, Field<Long> userId, String minRole) {
    // 실효 역할이 minRole 이상인 역할 이름 중 하나인가 — 멤버가 아니면(NULL) IN 이 참이 되지 않는다.
    List<String> atLeast =
        switch (minRole) {
          case "OWNER" -> List.of("OWNER");
          case "EDITOR" -> List.of("OWNER", "EDITOR");
          case "VIEWER" -> List.of("OWNER", "EDITOR", "VIEWER");
          default -> throw new IllegalArgumentException("알 수 없는 역할: " + minRole);
        };
    return effectiveRole(spaceId, userId).in(atLeast);
  }

  /**
   * 스페이스(spaceId)의 실효 멤버 user id(중복 없음) — 직접 멤버와, 멤버로 둔 부서·하위 부서의 활성 사람 구성원({@link
   * Departments#subtreeMembers}). 실시간 알림 수신자·스페이스 삭제 알림·이동 영향 인원 수처럼 「지금 이 스페이스에 들어 있는 사람 전원」에 쓴다.
   */
  public static Select<Record1<Long>> memberUserIds(Field<Long> spaceId) {
    WikiSpaceMember m = WIKI_SPACE_MEMBER.as("wsm_mu_m");
    WikiSpaceMemberGroup g = WIKI_SPACE_MEMBER_GROUP.as("wsm_mu_g");
    var dept =
        Departments.subtreeMembers(
            "wsm_mu_d", DSL.select(g.GROUP_ID).from(g).where(g.SPACE_ID.eq(spaceId)));
    // UNION 이 직접·부서 양쪽에 걸린 사람을 한 번만 낸다.
    return DSL.select(m.USER_ID.as("user_id"))
        .from(m)
        .where(m.SPACE_ID.eq(spaceId))
        .union(DSL.select(dept.userId()).from(dept.table()));
  }
}
