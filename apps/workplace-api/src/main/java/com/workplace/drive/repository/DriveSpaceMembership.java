package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER_GROUP;

import com.workplace.global.org.Departments;
import com.workplace.jooq.tables.DriveSpaceMember;
import com.workplace.jooq.tables.DriveSpaceMemberGroup;
import org.jooq.Condition;
import org.jooq.Field;
import org.jooq.Record1;
import org.jooq.Select;
import org.jooq.impl.DSL;

/**
 * 드라이브 공간 멤버십 판정(WP-1056) — 사람이 공간 멤버인지, 실효 역할이 무엇인지, 공간의 실효 멤버가 누구인지의 <b>유일한 규칙</b>. 공간 멤버는 직접 멤버
 * 행(drive_space_member)과 멤버로 둔 조직도 부서 행(drive_space_member_group) 두 가지다. 부서 행은 그 부서와 하위 부서의 활성 사람
 * 구성원에게 그 역할을 준다 — 소속은 판정할 때마다 공통 부서 규칙({@link Departments})으로 다시 본다. 실효 역할은 직접 행과 내가 걸리는 부서 행 중 가장
 * 높은 것(OWNER &gt; EDITOR &gt; VIEWER)이다. 노트 스페이스의 같은 규칙({@code WikiSpaceMembership}, WP-1052)을
 * 드라이브에 옮긴 것이다.
 *
 * <p>드라이브 밖에서는 쓰지 않아 드라이브 패키지에 둔다(다른 도메인이 쓰게 되면 노트처럼 공용 global 로 옮긴다). 조회를 실행하지 않고 jOOQ 조각만 만든다 —
 * 쓰는 쪽이 자기 쿼리 안에 끼워 한 번에 판정한다. 인자는 값(DSL.val)이나 바깥 질의의 열이고, 안쪽 테이블은 바깥과 섞이지 않게 별칭을 쓴다.
 */
public final class DriveSpaceMembership {

  private DriveSpaceMembership() {}

  /** 역할의 높이 — 실효 역할을 고를 때 정렬에 쓴다(OWNER 3 &gt; EDITOR 2 &gt; VIEWER 1). */
  private static Field<Integer> rank(Field<String> role) {
    return DSL.when(role.eq("OWNER"), DSL.inline(3))
        .when(role.eq("EDITOR"), DSL.inline(2))
        .otherwise(DSL.inline(1));
  }

  /**
   * 사람(userId)의 공간(spaceId) 실효 역할 — 직접 멤버 역할과, 내가 걸리는 부서 행(내 부서와 그 상위 부서가 멤버로 들어 있는 행)의 역할 중 가장 높은
   * 것. 멤버가 아니면 NULL. 스칼라 부분 질의라 select 목록이나 조건에 그대로 쓴다.
   */
  public static Field<String> effectiveRole(Field<Long> spaceId, Field<Long> userId) {
    DriveSpaceMember m = DRIVE_SPACE_MEMBER.as("dsm_er_m");
    var roles =
        DSL.select(m.ROLE.as("role"))
            .from(m)
            .where(m.SPACE_ID.eq(spaceId))
            .and(m.USER_ID.eq(userId))
            // 부서 쪽은 멤버 창 안내와 같은 규칙(departmentRole) 하나로 — 둘이 어긋나지 않게(WP-1102). 부서 역할이 없으면(NULL) 행을
            // 내지 않는다 — NULL 행이 직접 VIEWER 와 같은 높이로 정렬돼 실효 역할이 NULL 로 나오지 않게.
            .unionAll(
                DSL.select(departmentRole(spaceId, userId).as("role"))
                    .where(departmentRole(spaceId, userId).isNotNull()))
            .asTable("dsm_er");
    Field<String> role = roles.field("role", String.class);
    return DSL.field(DSL.select(role).from(roles).orderBy(rank(role).desc()).limit(1));
  }

  /**
   * 사람(userId)이 공간(spaceId)에서 멤버 부서로 받는 역할(WP-1102) — 내 부서와 그 상위 부서가 멤버로 들어 있는 행의 역할 중 가장 높은 것. 부서로
   * 받는 역할이 없으면 NULL. 멤버 창이 직접 역할보다 부서 역할이 높을 때 「조직으로 편집자」처럼 실효 역할을 안내하는 데 쓴다.
   */
  public static Field<String> departmentRole(Field<Long> spaceId, Field<Long> userId) {
    DriveSpaceMemberGroup g = DRIVE_SPACE_MEMBER_GROUP.as("dsm_dr_g");
    return DSL.field(
        DSL.select(g.ROLE)
            .from(g)
            .where(g.SPACE_ID.eq(spaceId))
            .and(g.GROUP_ID.in(Departments.withAncestorsOf(userId)))
            .orderBy(rank(g.ROLE).desc())
            .limit(1));
  }

  /**
   * 사람(userId)이 공간(spaceId)의 멤버인가 — 직접 멤버이거나, 내 부서와 그 상위 부서 중 하나가 멤버로 들어 있다. 역할은 보지 않는다(어떤 역할이든
   * 멤버). 목록·이름 충돌 검사처럼 행을 거르는 곳에서 조인 대신 쓴다 — 직접·부서 양쪽에 걸려도 행이 겹치지 않는다.
   */
  public static Condition isMember(Field<Long> spaceId, Field<Long> userId) {
    DriveSpaceMember m = DRIVE_SPACE_MEMBER.as("dsm_im_m");
    DriveSpaceMemberGroup g = DRIVE_SPACE_MEMBER_GROUP.as("dsm_im_g");
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
   * 사람(userId)이 (실효) 멤버인 공간 id(중복 없음) — 직접 멤버 행의 공간과, 내 부서·상위 부서를 멤버로 둔 공간. 바깥 행을 참조하지 않아 한 번만
   * 계산된다. 「내 공간」 목록과, 원시 SQL 로 쓰인 콘텐츠 검색이 접근 가능한 공간을 먼저 구할 때 쓴다.
   */
  public static Select<Record1<Long>> spaceIdsOf(Field<Long> userId) {
    DriveSpaceMember m = DRIVE_SPACE_MEMBER.as("dsm_si_m");
    DriveSpaceMemberGroup g = DRIVE_SPACE_MEMBER_GROUP.as("dsm_si_g");
    // UNION 이 직접·부서 양쪽에 걸린 공간을 한 번만 낸다.
    return DSL.select(m.SPACE_ID.as("space_id"))
        .from(m)
        .where(m.USER_ID.eq(userId))
        .union(
            DSL.select(g.SPACE_ID.as("space_id"))
                .from(g)
                .where(g.GROUP_ID.in(Departments.withAncestorsOf(userId))));
  }

  /**
   * 공간(spaceId)의 실효 멤버 user id(중복 없음) — 직접 멤버와, 멤버로 둔 부서·하위 부서의 활성 사람 구성원({@link
   * Departments#subtreeMembers}). 실시간 알림 수신자·공간 삭제 알림처럼 「지금 이 공간에 들어 있는 사람 전원」에 쓴다.
   */
  public static Select<Record1<Long>> audienceUserIds(Field<Long> spaceId) {
    DriveSpaceMember m = DRIVE_SPACE_MEMBER.as("dsm_au_m");
    DriveSpaceMemberGroup g = DRIVE_SPACE_MEMBER_GROUP.as("dsm_au_g");
    var dept =
        Departments.subtreeMembers(
            "dsm_au_d", DSL.select(g.GROUP_ID).from(g).where(g.SPACE_ID.eq(spaceId)));
    // UNION 이 직접·부서 양쪽에 걸린 사람을 한 번만 낸다.
    return DSL.select(m.USER_ID.as("user_id"))
        .from(m)
        .where(m.SPACE_ID.eq(spaceId))
        .union(DSL.select(dept.userId()).from(dept.table()));
  }
}
