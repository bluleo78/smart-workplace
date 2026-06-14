package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static com.workplace.jooq.Tables.WIKI_SPACE_MEMBER;

import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiPageSummary;
import com.workplace.wiki.dto.WikiSearchResult;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** wiki_page 접근. 트리는 (space_id, parent_id, position) 기준. */
@Repository
@RequiredArgsConstructor
public class WikiPageRepository {
  private final DSLContext dsl;

  /** 형제 중 최대 position+1 (말단 추가용). */
  public int nextPosition(long spaceId, Long parentId) {
    Integer max =
        dsl.select(org.jooq.impl.DSL.max(WIKI_PAGE.POSITION))
            .from(WIKI_PAGE)
            .where(WIKI_PAGE.SPACE_ID.eq(spaceId))
            .and(parentId == null ? WIKI_PAGE.PARENT_ID.isNull() : WIKI_PAGE.PARENT_ID.eq(parentId))
            .fetchOne(0, Integer.class);
    return max == null ? 0 : max + 1;
  }

  public long insert(long spaceId, Long parentId, String title, int position) {
    return dsl.insertInto(WIKI_PAGE)
        .set(WIKI_PAGE.SPACE_ID, spaceId)
        .set(WIKI_PAGE.PARENT_ID, parentId)
        .set(WIKI_PAGE.TITLE, title)
        .set(WIKI_PAGE.POSITION, position)
        .returning(WIKI_PAGE.ID)
        .fetchOne()
        .getId();
  }

  /** 공간의 전체 페이지(경량, 본문 제외) — 클라이언트 트리 구성용. */
  public List<WikiPageSummary> listBySpace(long spaceId) {
    return dsl.select(WIKI_PAGE.ID, WIKI_PAGE.PARENT_ID, WIKI_PAGE.TITLE, WIKI_PAGE.POSITION)
        .from(WIKI_PAGE)
        .where(WIKI_PAGE.SPACE_ID.eq(spaceId))
        .orderBy(WIKI_PAGE.PARENT_ID.asc().nullsFirst(), WIKI_PAGE.POSITION.asc())
        .fetch(
            r ->
                new WikiPageSummary(
                    r.get(WIKI_PAGE.ID),
                    r.get(WIKI_PAGE.PARENT_ID),
                    r.get(WIKI_PAGE.TITLE),
                    r.get(WIKI_PAGE.POSITION)));
  }

  public Optional<WikiPageDetail> findDetail(long pageId) {
    return dsl.select(
            WIKI_PAGE.ID,
            WIKI_PAGE.SPACE_ID,
            WIKI_PAGE.PARENT_ID,
            WIKI_PAGE.TITLE,
            WIKI_PAGE.BODY,
            WIKI_PAGE.VERSION,
            WIKI_PAGE.UPDATED_BY,
            WIKI_PAGE.UPDATED_AT)
        .from(WIKI_PAGE)
        .where(WIKI_PAGE.ID.eq(pageId))
        .fetchOptional(
            r ->
                new WikiPageDetail(
                    r.get(WIKI_PAGE.ID),
                    r.get(WIKI_PAGE.SPACE_ID),
                    r.get(WIKI_PAGE.PARENT_ID),
                    r.get(WIKI_PAGE.TITLE),
                    r.get(WIKI_PAGE.BODY),
                    r.get(WIKI_PAGE.VERSION),
                    r.get(WIKI_PAGE.UPDATED_BY),
                    r.get(WIKI_PAGE.UPDATED_AT)));
  }

  /** 공간 id 만 빠르게(인가 해석용). */
  public Optional<Long> findSpaceId(long pageId) {
    return dsl.select(WIKI_PAGE.SPACE_ID)
        .from(WIKI_PAGE)
        .where(WIKI_PAGE.ID.eq(pageId))
        .fetchOptional(WIKI_PAGE.SPACE_ID);
  }

  /** 낙관적 동시성 저장: version 일치할 때만 갱신하고 version+1. 영향 행수 반환(0 이면 충돌). */
  public int saveIfVersion(
      long pageId, String title, String body, int expectedVersion, long editorId) {
    return dsl.update(WIKI_PAGE)
        .set(WIKI_PAGE.TITLE, title)
        .set(WIKI_PAGE.BODY, body)
        .set(WIKI_PAGE.VERSION, WIKI_PAGE.VERSION.plus(1))
        .set(WIKI_PAGE.UPDATED_BY, editorId)
        .set(WIKI_PAGE.UPDATED_AT, org.jooq.impl.DSL.currentOffsetDateTime())
        .where(WIKI_PAGE.ID.eq(pageId))
        .and(WIKI_PAGE.VERSION.eq(expectedVersion))
        .execute();
  }

  public void move(long pageId, Long parentId, int position) {
    dsl.update(WIKI_PAGE)
        .set(WIKI_PAGE.PARENT_ID, parentId)
        .set(WIKI_PAGE.POSITION, position)
        .where(WIKI_PAGE.ID.eq(pageId))
        .execute();
  }

  /** 같은 부모(공간 스코프)의 자식 id 들을 position,id 순으로 — 재배열 기준 순서. */
  public java.util.List<Long> childIdsOrdered(long spaceId, Long parentId) {
    return dsl.select(WIKI_PAGE.ID)
        .from(WIKI_PAGE)
        .where(WIKI_PAGE.SPACE_ID.eq(spaceId))
        .and(parentId == null ? WIKI_PAGE.PARENT_ID.isNull() : WIKI_PAGE.PARENT_ID.eq(parentId))
        .orderBy(WIKI_PAGE.POSITION.asc(), WIKI_PAGE.ID.asc())
        .fetch(WIKI_PAGE.ID);
  }

  /** 단건 position 갱신(타이 제거 재부여용). */
  public void setPosition(long pageId, int position) {
    dsl.update(WIKI_PAGE)
        .set(WIKI_PAGE.POSITION, position)
        .where(WIKI_PAGE.ID.eq(pageId))
        .execute();
  }

  public void delete(long pageId) {
    dsl.deleteFrom(WIKI_PAGE).where(WIKI_PAGE.ID.eq(pageId)).execute();
  }

  /**
   * 호출자가 멤버인 스페이스의 위키 페이지를 제목·본문 ILIKE 로 검색한다. spaceId 가 null 이면 호출자가 멤버인 전체 스페이스 대상, 지정되면 해당 스페이스
   * 한정. 멤버십 조인으로 접근 불가 스페이스는 결과에서 자연 배제(RLS+멤버십 이중 스코핑).
   */
  public List<WikiSearchResult> search(long callerId, Long spaceId, String pattern, int limit) {
    Condition cond =
        WIKI_SPACE_MEMBER
            .USER_ID
            .eq(callerId)
            .and(
                WIKI_PAGE
                    .TITLE
                    .likeIgnoreCase(pattern, '\\')
                    .or(WIKI_PAGE.BODY.likeIgnoreCase(pattern, '\\')));
    if (spaceId != null) {
      cond = cond.and(WIKI_PAGE.SPACE_ID.eq(spaceId));
    }
    return dsl.select(
            WIKI_PAGE.ID,
            WIKI_PAGE.SPACE_ID,
            WIKI_SPACE.NAME,
            WIKI_PAGE.TITLE,
            WIKI_PAGE.BODY,
            WIKI_PAGE.UPDATED_AT)
        .from(WIKI_PAGE)
        .join(WIKI_SPACE)
        .on(WIKI_SPACE.ID.eq(WIKI_PAGE.SPACE_ID))
        .join(WIKI_SPACE_MEMBER)
        .on(WIKI_SPACE_MEMBER.SPACE_ID.eq(WIKI_PAGE.SPACE_ID))
        .where(cond)
        .orderBy(WIKI_PAGE.UPDATED_AT.desc())
        .limit(limit)
        .fetch(
            r -> {
              String body = r.get(WIKI_PAGE.BODY);
              String snippet =
                  body == null ? "" : (body.length() > 300 ? body.substring(0, 300) : body);
              return new WikiSearchResult(
                  r.get(WIKI_PAGE.ID),
                  r.get(WIKI_PAGE.SPACE_ID),
                  r.get(WIKI_SPACE.NAME),
                  r.get(WIKI_PAGE.TITLE),
                  snippet,
                  r.get(WIKI_PAGE.UPDATED_AT));
            });
  }
}
