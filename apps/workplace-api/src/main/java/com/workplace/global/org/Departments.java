package com.workplace.global.org;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;

import com.workplace.global.tenant.WorkspaceActive;
import com.workplace.jooq.tables.Membership;
import com.workplace.jooq.tables.User;
import com.workplace.jooq.tables.UserGroup;
import com.workplace.jooq.tables.UserGroupMember;
import com.workplace.user.dto.UserKind;
import java.util.Collection;
import org.jooq.Condition;
import org.jooq.Field;
import org.jooq.Record1;
import org.jooq.Select;
import org.jooq.Table;
import org.jooq.impl.DSL;

/**
 * 조직도 부서 판정의 공통 규칙(WP-1055) — 부서 트리 탐색(아래로·위로), 부서 구성원으로 셀 사람, 사람이 직접 속한 부서를 <b>여기서만</b> 정의한다. 노트
 * 공유(WP-1023)가 처음 만든 규칙을 드라이브·프로젝트·채널 같은 다른 도메인이 부서를 대상으로 둘 때 그대로 쓰게 한 곳에 모았다(에픽 WP-1054). 도메인끼리
 * 서로의 패키지를 import 하지 않는다는 규칙(apps/workplace-api/CLAUDE.md) 때문에 공용(global)에 둔다.
 *
 * <p>조회를 실행하지 않고 jOOQ 조각(조건·부분 질의·파생 테이블)만 만든다 — 멤버 테이블을 직접 읽는 쿼리가 많아, 쓰는 쪽이 자기 쿼리 안에 끼워 넣어 한 번의
 * 조회로 판정하게 하려는 것이다. 사용자 값은 바인드로만 들어간다. 트리는 RLS 로 지금 워크스페이스의 그룹만 보인다.
 *
 * <p>트리 탐색은 조직도 부서(SHARED)뿐 아니라 개인 그룹(PERSONAL) 트리에도 쓸 수 있다 — 하위 그룹은 부모와 공개 범위·주인이 같다({@code
 * UserGroupService#validateParent}). 부서만 대상으로 할 때는 출발점을 SHARED 로 거르는 것이 쓰는 쪽의 몫이다. 사이클 데이터에도 끝나도록
 * 지나온 경로를 들고 다닌다.
 */
public final class Departments {

  private Departments() {}

  /** 조직도 부서(공유 그룹)의 공개 범위 값. 개인 그룹(PERSONAL)은 부서가 아니다. */
  public static final String SHARED = "SHARED";

  /**
   * 부서 구성원으로 셀 사람인가 — 이 워크스페이스(tenantId)의 활성({@link WorkspaceActive}) 사람(HUMAN)(WP-1023, #832).
   * AI(AGENT)·정지된 구성원·비활성 계정은 부서에 들어 있어도 세지 않는다. 연락처의 그룹 멤버 목록, 부서 공유의 접근·인원 수·알림이 모두 이 조건이다 — 보이는
   * 「개발팀 · 3명」과 실제로 열 수 있는 사람이 갈라지지 않게. 두 인자는 바깥 질의의 열이나 값이다(바깥에 {@code "user"} 가 있어도 섞이지 않게 안쪽은
   * 별칭을 쓴다).
   */
  public static Condition activeHumanMember(Field<Long> userId, Field<Long> tenantId) {
    return humanMember(userId, tenantId, MemberStatus.ACTIVE);
  }

  /**
   * 부서 구성원으로 셀 사람의 활성 범위. 접근 판정·인원 수·들어오는 사람은 늘 {@link #ACTIVE} 다. {@link #INCLUDING_INACTIVE} 는
   * 구성원 정지·전역 비활성이 접근을 막을 뿐 부서 소속을 끊지 않는다고 볼 때 쓴다 — 부서 구성원을 사람 행으로 펼쳐 두는 채널(WP-1058)이 정지된 사람의 행(읽은
   * 위치·가입 시각)을 지우지 않게.
   */
  public enum MemberStatus {
    /** 활성({@link WorkspaceActive}) 사람만 — {@link #activeHumanMember}. */
    ACTIVE,
    /** 이 워크스페이스에 멤버십 행이 있는 사람(정지·비활성 포함). */
    INCLUDING_INACTIVE
  }

  /** 부서 구성원 판정의 본체 — 이 워크스페이스(tenantId)의 사람(HUMAN)이고, status 가 ACTIVE 면 활성이기도 하다. */
  private static Condition humanMember(
      Field<Long> userId, Field<Long> tenantId, MemberStatus status) {
    User u = USER.as("dep_ahm_u");
    Membership ms = MEMBERSHIP.as("dep_ahm_ms");
    return DSL.exists(
        DSL.selectOne()
            .from(u)
            .join(ms)
            .on(WorkspaceActive.join(ms, u.ID, tenantId))
            .where(u.ID.eq(userId))
            .and(u.KIND.eq(UserKind.HUMAN))
            .and(
                status == MemberStatus.ACTIVE
                    ? WorkspaceActive.condition(u, ms)
                    : DSL.noCondition()));
  }

  /**
   * 그룹 g 가 사람(userId)이 MEMBER 로 <b>직접</b> 속한 조직도 부서인가 — 상위 부서는 따라가지 않고, 개인 그룹은 소속이 아니다(그 주인만의 분류).
   * 소속 부서 이름 표시(구성원 목록·메일 사람 카드)와 「내 부서와 상위 부서」({@link #withAncestorsOf})의 출발점이 같은 규칙을 쓴다. 활성 여부는
   * 보지 않는다 — 부서 대상 권한처럼 활성 사람만 세야 하면 {@link #activeHumanMember} 를 더한다.
   */
  public static Condition directDepartmentOf(UserGroup g, Field<Long> userId) {
    UserGroupMember m = USER_GROUP_MEMBER.as("dep_dir_m");
    // 사람의 멤버 행(target 인덱스)에서 출발한다 — 부서마다 멤버 행을 찾아보지 않게.
    return g.VISIBILITY
        .eq(SHARED)
        .and(
            g.ID.in(
                DSL.select(m.GROUP_ID)
                    .from(m)
                    .where(m.TARGET_TYPE.eq("MEMBER"))
                    .and(m.TARGET_ID.eq(userId))));
  }

  /**
   * 부서 트리 아래로 — 출발 그룹(roots)마다 자기와 모든 하위 그룹을 내는 파생 테이블(WP-1055). 행은 (출발 그룹, 그룹, 깊이 — 자기 0, 형제 순서
   * 경로). 출발 그룹이 여럿이면 출발 그룹별로 따로 내므로, 겹치는 트리에서는 같은 그룹이 출발 그룹마다 한 번씩 나온다. roots 는 그룹 id 한 열의 질의이고, 없는
   * 그룹은 건너뛴다.
   *
   * <p>하위로는 부모와 공개 범위·주인이 같은 그룹만 따라간다 — 부모 검증(validateParent)이 지키는 규칙이지만, 그 전에 남의 개인 그룹 밑으로 잘못 옮겨진
   * 데이터(WP-677)가 남아 있어도 다른 사람의 개인 그룹이 부서 트리로 새지 않게 조회에서도 막는다. 형제 순서 경로는 지나온 그룹들의 정렬 순서(sort_order)
   * 배열이라, (깊이, 경로, id) 로 정렬하면 화면 트리 순서의 너비 우선 순서가 된다.
   */
  public static Subtree subtree(String alias, Select<? extends Record1<Long>> roots) {
    Table<?> t =
        DSL.table(
                """
                (WITH RECURSIVE tree(root_id, id, visibility, owner_id, depth, sort_path, path) AS (
                  SELECT g.id, g.id, g.visibility, g.owner_id, 0, ARRAY[]::int[], ARRAY[g.id]
                  FROM user_group g WHERE g.id IN ({0})
                  UNION ALL
                  SELECT t.root_id, g.id, g.visibility, g.owner_id, t.depth + 1,
                         t.sort_path || g.sort_order, t.path || g.id
                  FROM user_group g JOIN tree t ON g.parent_id = t.id
                  WHERE g.id <> ALL(t.path)
                    AND g.visibility = t.visibility
                    AND g.owner_id IS NOT DISTINCT FROM t.owner_id
                )
                SELECT root_id, id AS group_id, depth, sort_path FROM tree)""",
                roots)
            .as(alias);
    return new Subtree(
        t,
        DSL.field(DSL.name(alias, "root_id"), Long.class),
        DSL.field(DSL.name(alias, "group_id"), Long.class),
        DSL.field(DSL.name(alias, "depth"), Integer.class),
        DSL.field(DSL.name(alias, "sort_path"), Integer[].class));
  }

  /** {@link #subtree} 의 결과 — 파생 테이블과 그 열(출발 그룹·그룹·깊이·형제 순서 경로). */
  public record Subtree(
      Table<?> table,
      Field<Long> rootId,
      Field<Long> groupId,
      Field<Integer> depth,
      Field<Integer[]> sortPath) {}

  /**
   * 부서와 하위 부서의 구성원 — 출발 부서(roots)마다 그 트리의 부서 구성원({@link #activeHumanMember}, 중복 제외)을 내는 파생 테이블. 행은
   * (출발 부서, 사람 id). 부서 공유의 인원 수·새로 열 수 있게 된 사람 알림처럼 「이 부서를 대상으로 두면 누가 들어오나」를 셀 때 쓴다. roots 중 조직도
   * 부서(SHARED)만 출발점이 된다 — 개인 그룹을 넘겨도 그 구성원이 부서 구성원으로 세어지지 않게 여기서 거른다.
   */
  public static SubtreeMembers subtreeMembers(String alias, Select<? extends Record1<Long>> roots) {
    return subtreeMembers(alias, roots, null);
  }

  /**
   * {@link #subtreeMembers(String, Select)} 를 주어진 사람(onlyUserIds)으로 좁힌 것 — 「이 몇 명이 부서로 들어오나」만 볼 때
   * 부서 트리의 구성원 전원을 만들지 않게, 구성원 행을 사람 id 로 먼저 거른다(같은 규칙, 결과는 원래 결과 중 그 사람들만). null 이면 거르지 않는다.
   */
  public static SubtreeMembers subtreeMembers(
      String alias, Select<? extends Record1<Long>> roots, Collection<Long> onlyUserIds) {
    return subtreeMembers(alias, roots, onlyUserIds, MemberStatus.ACTIVE);
  }

  /**
   * {@link #subtreeMembers(String, Select, Collection)} 에 셀 사람의 활성 범위(status)를 고른 것 — {@link
   * MemberStatus#INCLUDING_INACTIVE} 면 정지·비활성 구성원도 세어 「이 사람이 아직 부서로 걸리는가」(소속은 그대로인가)를 본다(WP-1058).
   */
  public static SubtreeMembers subtreeMembers(
      String alias,
      Select<? extends Record1<Long>> roots,
      Collection<Long> onlyUserIds,
      MemberStatus status) {
    UserGroup r = USER_GROUP.as(alias + "_r");
    Subtree st =
        subtree(
            alias + "_tree",
            DSL.select(r.ID).from(r).where(r.ID.in(roots)).and(r.VISIBILITY.eq(SHARED)));
    UserGroupMember m = USER_GROUP_MEMBER.as(alias + "_m");
    Table<?> t =
        DSL.selectDistinct(st.rootId().as("root_id"), m.TARGET_ID.as("user_id"))
            .from(st.table())
            .join(m)
            .on(m.GROUP_ID.eq(st.groupId()))
            .and(m.TARGET_TYPE.eq("MEMBER"))
            .where(onlyUserIds == null ? DSL.noCondition() : m.TARGET_ID.in(onlyUserIds))
            .and(humanMember(m.TARGET_ID, m.TENANT_ID, status))
            .asTable(alias);
    return new SubtreeMembers(
        t,
        DSL.field(DSL.name(alias, "root_id"), Long.class),
        DSL.field(DSL.name(alias, "user_id"), Long.class));
  }

  /** {@link #subtreeMembers} 의 결과 — 파생 테이블과 그 열(출발 부서·사람). */
  public record SubtreeMembers(Table<?> table, Field<Long> rootId, Field<Long> userId) {}

  /**
   * 부서 트리 위로 — 출발 그룹(starts)과 그 모든 상위 그룹의 id 와 깊이(자기 0, 가까울수록 작다)를 내는 파생 테이블. 행은 (그룹, 깊이). 출발 그룹이
   * 여럿이고 같은 상위를 지나면 한 번씩 더 나올 수 있다 — {@code IN} 처럼 집합으로 쓰거나 깊이로 줄인다. starts 는 그룹 id 한 열의 질의이고, 없는
   * 그룹은 건너뛴다. 위로도 {@link #subtree} 와 같이 공개 범위·주인이 같은 부모만 따라간다(WP-677 데이터가 남아 있어도 부서에서 개인 그룹으로 올라가지
   * 않게).
   */
  public static Ancestors ancestors(String alias, Select<? extends Record1<Long>> starts) {
    Table<?> t =
        DSL.table(
                """
                (WITH RECURSIVE chain(id, parent_id, depth, path) AS (
                  SELECT g.id, g.parent_id, 0, ARRAY[g.id]
                  FROM user_group g WHERE g.id IN ({0})
                  UNION ALL
                  SELECT p.id, p.parent_id, c.depth + 1, c.path || p.id
                  FROM user_group p JOIN chain c ON p.id = c.parent_id
                  JOIN user_group child ON child.id = c.id
                  WHERE p.id <> ALL(c.path)
                    AND p.visibility = child.visibility
                    AND p.owner_id IS NOT DISTINCT FROM child.owner_id
                )
                SELECT id AS group_id, depth FROM chain)""",
                starts)
            .as(alias);
    return new Ancestors(
        t,
        DSL.field(DSL.name(alias, "group_id"), Long.class),
        DSL.field(DSL.name(alias, "depth"), Integer.class));
  }

  /** {@link #ancestors} 의 결과 — 파생 테이블과 그 열(그룹·깊이). */
  public record Ancestors(Table<?> table, Field<Long> groupId, Field<Integer> depth) {}

  /**
   * 사람(userId)이 부서 구성원으로 들어 있는 조직도 부서와 그 모든 상위 부서 id 의 부분 질의 — 「이 사람이 부서 대상 권한에 걸리는가」 판정용(WP-1023).
   * 부서를 대상으로 두면 그 부서와 하위 부서의 구성원에게 열리므로, 대상 부서가 이 집합에 있으면 걸린다({@code target IN (…)}). 출발점은 {@link
   * #directDepartmentOf} 이고 {@link #activeHumanMember} 인 사람만 — 정지·AI·비활성은 어느 부서에도 걸리지 않는다. userId 가
   * 값이면 바깥 행을 참조하지 않아 목록 조회 안에서도 한 번만 계산된다.
   */
  public static Select<Record1<Long>> withAncestorsOf(Field<Long> userId) {
    UserGroup g = USER_GROUP.as("dep_my_g");
    return withAncestorsOf("dep_my", g, activeHumanMember(userId, g.TENANT_ID), userId);
  }

  /**
   * {@link #withAncestorsOf} 와 같되 활성 여부를 보지 않는다 — 사람이 직접 속한 조직도 부서와 그 모든 상위 부서. 구성원 정지처럼 「사람이 부서
   * 구성원으로 세어지지 않게 된」 뒤에도 그 사람이 부서로 걸려 있던 곳을 찾을 때 쓴다({@link #withAncestorsOf} 는 활성 사람만 출발점으로 삼아 정지
   * 뒤에는 비어 있다). 권한 판정에는 쓰지 않는다.
   */
  public static Select<Record1<Long>> withAncestorsOfIncludingInactive(Field<Long> userId) {
    return withAncestorsOf("dep_mya", USER_GROUP.as("dep_mya_g"), DSL.noCondition(), userId);
  }

  /** 두 「내 부서와 상위 부서」의 본체 — 출발점(직접 속한 부서)에 extra 조건을 더해 위로 올라간다. */
  private static Select<Record1<Long>> withAncestorsOf(
      String alias, UserGroup g, Condition extra, Field<Long> userId) {
    Ancestors a =
        ancestors(alias, DSL.select(g.ID).from(g).where(directDepartmentOf(g, userId)).and(extra));
    return DSL.select(a.groupId()).from(a.table()); // IN 의 피연산자라 중복을 빼지 않는다
  }
}
