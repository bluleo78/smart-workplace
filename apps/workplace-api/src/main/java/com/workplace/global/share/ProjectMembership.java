package com.workplace.global.share;

import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.PROJECT_MEMBER_GROUP;

import com.workplace.global.org.Departments;
import com.workplace.jooq.tables.ProjectMember;
import com.workplace.jooq.tables.ProjectMemberGroup;
import java.util.Collection;
import java.util.function.Function;
import org.jooq.Condition;
import org.jooq.Field;
import org.jooq.Record1;
import org.jooq.Select;
import org.jooq.Table;
import org.jooq.impl.DSL;

/**
 * 프로젝트 멤버십 판정(WP-1057) — 사람이 프로젝트 멤버인지, 실효 역할이 무엇인지, 프로젝트의 실효 멤버가 누구인지의 <b>유일한 규칙</b>. 프로젝트 멤버는 직접
 * 멤버 행(project_member)과 멤버로 둔 조직도 부서 행(project_member_group) 두 가지다. 부서 행은 그 부서와 하위 부서의 활성 사람 구성원에게
 * MEMBER 를 준다 — 소속은 판정할 때마다 공통 부서 규칙({@link Departments})으로 다시 본다. 실효 역할은 직접 행 역할과 부서 행(MEMBER) 중
 * 높은 것이다(OWNER &gt; MEMBER) — 부서 행은 MEMBER 고정이라 직접 행이 있으면 그 역할, 없고 부서로 걸리면 MEMBER 다.
 *
 * <p>프로젝트 접근 가드·목록(project), 이슈·관계·첨부 가시성(issue), 라벨·마일스톤·사이클·버전·구성요소·상태·유형 목록, 저장된 뷰 고정, 알림
 * 가시성(notify), 홈 공용 메모리(home), 이슈 대화 참여(chat)가 모두 이 판정을 쓴다 — 프로젝트에서 볼 수 있는 사람과 다른 화면에 보이는 사람이 갈라지지
 * 않게. 도메인끼리 서로의 패키지를 import 하지 않는다는 규칙(apps/workplace-api/CLAUDE.md) 때문에 {@link
 * WikiSpaceMembership} 처럼 공용(global)에 둔다. 조회를 실행하지 않고 jOOQ 조각만 만든다 — 쓰는 쪽이 자기 쿼리 안에 끼워 한 번에 판정한다.
 * 인자는 값(DSL.val)이나 바깥 질의의 열이고, 안쪽 테이블은 바깥과 섞이지 않게 별칭을 쓴다.
 *
 * <p>성능: 부서 쪽은 「내 부서와 그 상위 부서」({@link Departments#withAncestorsOf}) 를 한 번 구해 {@code group_id IN
 * (…)} 으로 본다 — userId 가 값이면 바깥 행을 참조하지 않아 목록 조회 안에서도 한 번만 계산된다. 부서 행은 (project_id, group_id) PK 와
 * group_id 인덱스로 찾는다.
 */
public final class ProjectMembership {

  private ProjectMembership() {}

  /** 부서 행이 주는 역할 — 부서에는 MEMBER 만 준다(OWNER 는 사람만). */
  public static final String GROUP_ROLE = "MEMBER";

  /**
   * 사람(userId)이 프로젝트(projectId)의 멤버인가 — 직접 멤버이거나, 내 부서와 그 상위 부서 중 하나가 멤버로 들어 있다. 목록·가시성처럼 행을 거르는
   * 곳에서 조인 대신 쓴다 — 직접·부서 양쪽에 걸려도 행이 겹치지 않는다.
   */
  public static Condition isMember(Field<Long> projectId, Field<Long> userId) {
    ProjectMember m = PROJECT_MEMBER.as("pms_im_m");
    return DSL.exists(
            DSL.selectOne().from(m).where(m.PROJECT_ID.eq(projectId)).and(m.USER_ID.eq(userId)))
        .or(viaDepartment(projectId, userId));
  }

  /**
   * 사람(userId 값)이 프로젝트(projectId 열)의 멤버인가 — {@link #isMember} 와 같은 판정을 {@code project_id IN}
   * ({@link #projectIdsOf}) 로 쓴다. 부분 질의가 바깥 행을 참조하지 않아 목록 조회 안에서도 한 번만 계산된다(행마다 상위 부서 재귀를 돌지 않게).
   * 사람이 값인 곳은 이쪽을, 사람이 바깥 열이면 {@link #isMember} 를 쓴다.
   */
  public static Condition isMemberOf(Field<Long> projectId, Long userId) {
    return projectId.in(projectIdsOf(DSL.val(userId)));
  }

  /** 사람(userId)이 멤버로 둔 부서(하위 부서 포함)로 프로젝트(projectId)에 걸리는가 — 직접 행은 보지 않는다. */
  public static Condition viaDepartment(Field<Long> projectId, Field<Long> userId) {
    ProjectMemberGroup g = PROJECT_MEMBER_GROUP.as("pms_vd_g");
    return DSL.exists(
        DSL.selectOne()
            .from(g)
            .where(g.PROJECT_ID.eq(projectId))
            .and(g.GROUP_ID.in(Departments.withAncestorsOf(userId))));
  }

  /**
   * 사람(userId)의 프로젝트(projectId) 실효 역할 — 직접 멤버 역할이 있으면 그것(OWNER·MEMBER, 부서의 MEMBER 보다 낮지 않다), 없고 부서로
   * 걸리면 MEMBER, 멤버가 아니면 NULL. 스칼라 부분 질의라 select 목록에 그대로 쓴다.
   */
  public static Field<String> effectiveRole(Field<Long> projectId, Field<Long> userId) {
    ProjectMember m = PROJECT_MEMBER.as("pms_er_m");
    Field<String> direct =
        DSL.field(
            DSL.select(m.ROLE).from(m).where(m.PROJECT_ID.eq(projectId)).and(m.USER_ID.eq(userId)));
    return DSL.coalesce(direct, DSL.when(viaDepartment(projectId, userId), DSL.inline(GROUP_ROLE)));
  }

  /**
   * 사람(userId)이 멤버인 프로젝트 id 의 부분 질의 — 직접 멤버 행과 내가 걸리는 부서 행. 라벨·마일스톤 같은 「내가 멤버인 프로젝트의 것」 목록이 {@code
   * project_id IN (…)} 으로 쓴다(IN 의 피연산자라 중복을 빼지 않는다).
   */
  public static Select<Record1<Long>> projectIdsOf(Field<Long> userId) {
    ProjectMember m = PROJECT_MEMBER.as("pms_pi_m");
    ProjectMemberGroup g = PROJECT_MEMBER_GROUP.as("pms_pi_g");
    return DSL.select(m.PROJECT_ID.as("project_id"))
        .from(m)
        .where(m.USER_ID.eq(userId))
        .unionAll(
            DSL.select(g.PROJECT_ID)
                .from(g)
                .where(g.GROUP_ID.in(Departments.withAncestorsOf(userId))));
  }

  /**
   * 사람(userId)이 멤버로 둔 부서(하위 부서 포함)로 걸리는 프로젝트 id 의 부분 질의(중복 없음) — 직접 행은 보지 않는다. 프로젝트 목록에 LEFT JOIN 해
   * 실효 역할을 한 번만 계산할 때 쓴다(행마다 {@link #viaDepartment} 를 돌리지 않게). userId 가 값이면 한 번만 계산된다.
   */
  public static Select<Record1<Long>> projectIdsViaDepartment(Field<Long> userId) {
    ProjectMemberGroup g = PROJECT_MEMBER_GROUP.as("pms_pv_g");
    return DSL.selectDistinct(g.PROJECT_ID.as("project_id"))
        .from(g)
        .where(g.GROUP_ID.in(Departments.withAncestorsOf(userId)));
  }

  /**
   * 프로젝트에 멤버로 둔 부서·하위 부서의 활성 사람 구성원({@link Departments#subtreeMembers}) — 행은 (부서 행 = 프로젝트·부서·추가 시각,
   * 그 부서로 들어오는 사람). 같은 사람이 여러 부서로 걸리면 부서 행마다 한 번씩 나온다. 실효 멤버 명단·인원·잠금처럼 「이 프로젝트의 부서로 누가 들어오나」를 보는
   * 조회가 모두 이 위에 선다 — 부서 행에서 출발해 트리를 내려가는 짜임을 곳곳에서 손으로 다시 쓰지 않게.
   *
   * @param alias 안쪽 테이블 별칭의 접두어(같은 쿼리에서 두 번 쓰면 달라야 한다)
   * @param projects 볼 프로젝트 조건 — 부서 행 테이블(별칭)을 받아 조건을 만든다(출발 부서 고르기와 바깥 부서 행 양쪽에 쓴다)
   * @param onlyUserIds 이 사람들만 본다(부서 트리 구성원 전원을 만들지 않게 먼저 거른다) — null 이면 거르지 않는다
   */
  public static DepartmentAudience departmentAudience(
      String alias,
      Function<ProjectMemberGroup, Condition> projects,
      Collection<Long> onlyUserIds) {
    ProjectMemberGroup roots = PROJECT_MEMBER_GROUP.as(alias + "_pr");
    ProjectMemberGroup g = PROJECT_MEMBER_GROUP.as(alias + "_g");
    var dept =
        Departments.subtreeMembers(
            alias + "_d",
            DSL.select(roots.GROUP_ID).from(roots).where(projects.apply(roots)),
            onlyUserIds);
    Table<?> t = g.join(dept.table()).on(dept.rootId().eq(g.GROUP_ID)).and(projects.apply(g));
    return new DepartmentAudience(t, g, dept.userId());
  }

  /**
   * {@link #departmentAudience} 의 결과 — 부서 행과 그 부서 구성원을 붙인 테이블, 부서 행 별칭(프로젝트·부서·추가 시각 열과 잠금 대상), 사람
   * id 열.
   */
  public record DepartmentAudience(Table<?> table, ProjectMemberGroup group, Field<Long> userId) {}

  /** 프로젝트(projectId)에 멤버로 둔 부서·하위 부서의 활성 사람 구성원 user id 의 부분 질의(중복 없음, 직접 멤버 포함 여부는 보지 않는다). */
  public static Select<Record1<Long>> departmentUserIds(Field<Long> projectId) {
    DepartmentAudience a = departmentAudience("pms_du", g -> g.PROJECT_ID.eq(projectId), null);
    return DSL.selectDistinct(a.userId()).from(a.table());
  }

  /**
   * 프로젝트(projectId)의 실효 멤버 user id(중복 없음) — 직접 멤버와, 멤버로 둔 부서·하위 부서의 활성 사람 구성원. 실시간 알림 수신자처럼 「지금 이
   * 프로젝트에 들어 있는 사람 전원」에 쓴다.
   */
  public static Select<Record1<Long>> memberUserIds(Field<Long> projectId) {
    ProjectMember m = PROJECT_MEMBER.as("pms_mu_m");
    // UNION 이 직접·부서 양쪽에 걸린 사람을 한 번만 낸다.
    return DSL.select(m.USER_ID.as("user_id"))
        .from(m)
        .where(m.PROJECT_ID.eq(projectId))
        .union(departmentUserIds(projectId));
  }
}
