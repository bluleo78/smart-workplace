package com.workplace.global.share;

import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE_GROUP;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE_MEMBER;

import org.jooq.Condition;
import org.jooq.Field;
import org.jooq.impl.DSL;

/**
 * 노트 공유 대상 판정(WP-1023) — 지정한 사람 공유(PEOPLE)가 이 사용자에게 열리는지의 <b>유일한 규칙</b>. 노트 접근(토큰 판정·입구 토큰 찾기,
 * {@code WikiShareRepository})과 알림 목록의 가시성({@code NotificationRepository#wikiReadableByRecipient})이
 * 함께 쓴다 — 보이는 알림 ⇔ 누르면 열림이 갈라지지 않게. 도메인끼리 서로의 패키지를 import 하지 않는다는 규칙(apps/workplace-api/CLAUDE.md)
 * 때문에 wiki 저장소가 아니라 공용(global)에 둔다. 조회를 실행하지 않고 jOOQ 조건만 만든다.
 */
public final class WikiShareTargets {

  private WikiShareTargets() {}

  /**
   * 부서 구성원으로 셀 사람 — user_group_member(별칭 {@code m})의 MEMBER 행 중 지금 이 워크스페이스의 활성 사람(HUMAN·계정
   * 활성·ACTIVE 멤버십)만(WP-1023). 연락처의 그룹 멤버 목록({@code UserGroupRepository#findMembers})과 같은 기준이라, 공유
   * 창의 「개발팀 · 3명」과 실제로 열 수 있는 사람이 같다 — AI(AGENT)·정지된 구성원·비활성 계정은 부서에 들어 있어도 열지 못한다. 워크스페이스는 그 행의
   * tenant_id 로 맞춘다(RLS 로 지금 워크스페이스 행만 보인다). 별칭 {@code u}·{@code ms} 를 쓴다. 부서별 인원 세기도 같은 조각을 쓴다.
   */
  public static final String ACTIVE_HUMAN_MEMBER =
      """
      JOIN "user" u ON u.id = m.target_id AND u.kind = 'HUMAN' AND u.is_active
      JOIN membership ms ON ms.user_id = u.id AND ms.tenant_id = m.tenant_id AND ms.status = 'ACTIVE'
      """;

  /**
   * 사용자가 부서 구성원({@link #ACTIVE_HUMAN_MEMBER})으로 들어 있는 조직도 부서와 그 모든 상위 부서 id 를 내는 부분 질의(WP-1023) —
   * 대상 부서는 그 부서와 하위 부서의 구성원에게 열리므로, 「내 부서들의 조상 체인(자기 포함)」에 대상 부서가 있으면 열린다. 바깥 행을 참조하지
   * 않아(uncorrelated) 목록 조회 안에 넣어도 한 번만 계산된다. 플레이스홀더 {@code {1}} 이 사용자 id 다. 개인 그룹(PERSONAL)은 보지 않는다
   * — 대상으로 저장되지 않는다.
   */
  private static final String MY_DEPARTMENTS_WITH_ANCESTORS =
      """
      WITH RECURSIVE my_dept(id, parent_id) AS (
        SELECT g.id, g.parent_id FROM user_group g
        JOIN user_group_member m ON m.group_id = g.id
      """
          + ACTIVE_HUMAN_MEMBER
          + """
        WHERE m.target_type = 'MEMBER' AND m.target_id = {1} AND g.visibility = 'SHARED'
        UNION
        SELECT p.id, p.parent_id FROM user_group p JOIN my_dept d ON p.id = d.parent_id
      )
      SELECT id FROM my_dept""";

  /**
   * 공유(shareId)가 이 사용자(userId)에게 열리는 대상인지 — 지정한 사람이거나 지정한 조직도 부서(하위 부서 포함)의 구성원(WP-1023). 공유가
   * PEOPLE 인지·범위·만료는 보지 않는다(호출자가 본다). 두 인자는 값(DSL.val)이나 바깥 질의의 열이다 — 사용자 값은 바인드로만 들어간다.
   */
  public static Condition listedOn(Field<Long> shareId, Field<Long> userId) {
    Condition person =
        DSL.exists(
            DSL.selectOne()
                .from(WIKI_PAGE_SHARE_MEMBER)
                .where(WIKI_PAGE_SHARE_MEMBER.SHARE_ID.eq(shareId))
                .and(WIKI_PAGE_SHARE_MEMBER.USER_ID.eq(userId)));
    Condition department =
        DSL.exists(
            DSL.selectOne()
                .from(WIKI_PAGE_SHARE_GROUP)
                .where(WIKI_PAGE_SHARE_GROUP.SHARE_ID.eq(shareId))
                .and(
                    DSL.condition(
                        "{0} IN (" + MY_DEPARTMENTS_WITH_ANCESTORS + ")",
                        WIKI_PAGE_SHARE_GROUP.GROUP_ID,
                        userId)));
    return person.or(department);
  }
}
