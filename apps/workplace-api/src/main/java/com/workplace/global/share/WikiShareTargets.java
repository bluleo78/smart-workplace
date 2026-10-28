package com.workplace.global.share;

import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE_GROUP;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE_MEMBER;

import com.workplace.global.org.Departments;
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
   * 공유(shareId)가 이 사용자(userId)에게 열리는 대상인지 — 지정한 사람이거나 지정한 조직도 부서(하위 부서 포함)의 구성원(WP-1023). 부서 판정은 공통
   * 규칙 {@link Departments#withAncestorsOf} 그대로다(WP-1055 — 내 부서와 그 상위 부서에 대상 부서가 있으면 열린다). 공유가
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
                .and(WIKI_PAGE_SHARE_GROUP.GROUP_ID.in(Departments.withAncestorsOf(userId))));
    return person.or(department);
  }
}
