package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_STAR;

import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 노트 페이지 「즐겨찾기」(wiki_page_star, WP-1765) 접근. 한 사람·한 페이지 한 행으로 넣고 빼고, 내 목록을 즐겨찾기한 순으로 읽는다. 모든 메서드는
 * 워크스페이스 RLS 컨텍스트(TenantContext) 안에서 부른다(FORCE RLS). 읽기 권한 거르기는 서비스가 한다.
 */
@Repository
@RequiredArgsConstructor
public class WikiPageStarRepository {
  private final DSLContext dsl;

  /** 즐겨찾기 넣기. 이미 있으면 아무것도 하지 않는다(ON CONFLICT DO NOTHING — 멱등). */
  public void star(long userId, long pageId) {
    dsl.insertInto(WIKI_PAGE_STAR)
        .set(WIKI_PAGE_STAR.USER_ID, userId)
        .set(WIKI_PAGE_STAR.WIKI_PAGE_ID, pageId)
        .onConflict(WIKI_PAGE_STAR.USER_ID, WIKI_PAGE_STAR.WIKI_PAGE_ID)
        .doNothing()
        .execute();
  }

  /** 즐겨찾기 빼기 — 내 행만 지운다. 없으면 0행이라 멱등. */
  public void unstar(long userId, long pageId) {
    dsl.deleteFrom(WIKI_PAGE_STAR)
        .where(WIKI_PAGE_STAR.USER_ID.eq(userId))
        .and(WIKI_PAGE_STAR.WIKI_PAGE_ID.eq(pageId))
        .execute();
  }

  /** 목록 다음 쪽의 시작점 — 직전에 읽은 마지막 줄의 (created_at, id). 같은 시각 줄들도 id 로 갈라 빠지거나 겹치지 않는다. */
  public record Cursor(OffsetDateTime createdAt, long id) {}

  /** 목록 한 줄(권한 거르기 전). pageId 로 서비스가 읽기 권한·조상 제목을 채운다. */
  public record StarRow(long id, long pageId, OffsetDateTime createdAt) {}

  /**
   * 내 즐겨찾기를 즐겨찾기한 순((created_at, id) 내림차순)으로 limit 줄. wiki_page 를 join 해 지워진 페이지 행을 SQL 에서 뺀다(삭제는
   * CASCADE 라 보통 남지 않지만 방어). after 가 있으면 그 뒤부터.
   */
  public List<StarRow> listForUser(long userId, Cursor after, int limit) {
    Condition where = WIKI_PAGE_STAR.USER_ID.eq(userId);
    if (after != null) {
      where =
          where.and(
              DSL.row(WIKI_PAGE_STAR.CREATED_AT, WIKI_PAGE_STAR.ID)
                  .lt(DSL.row(after.createdAt(), after.id())));
    }
    return dsl.select(WIKI_PAGE_STAR.ID, WIKI_PAGE_STAR.WIKI_PAGE_ID, WIKI_PAGE_STAR.CREATED_AT)
        .from(WIKI_PAGE_STAR)
        .join(WIKI_PAGE)
        .on(WIKI_PAGE.ID.eq(WIKI_PAGE_STAR.WIKI_PAGE_ID))
        .where(where)
        .orderBy(WIKI_PAGE_STAR.CREATED_AT.desc(), WIKI_PAGE_STAR.ID.desc())
        .limit(limit)
        .fetch(
            r ->
                new StarRow(
                    r.get(WIKI_PAGE_STAR.ID),
                    r.get(WIKI_PAGE_STAR.WIKI_PAGE_ID),
                    r.get(WIKI_PAGE_STAR.CREATED_AT)));
  }

  /** 내가 즐겨찾기한 페이지 id 전부(거르지 않음, 순서 무관) — 화면의 별 표시 판정용. */
  public List<Long> pageIdsForUser(long userId) {
    return dsl.select(WIKI_PAGE_STAR.WIKI_PAGE_ID)
        .from(WIKI_PAGE_STAR)
        .where(WIKI_PAGE_STAR.USER_ID.eq(userId))
        .fetch(WIKI_PAGE_STAR.WIKI_PAGE_ID);
  }
}
