package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static com.workplace.jooq.Tables.WIKI_SPACE_MEMBER;

import com.workplace.wiki.dto.WikiBacklink;
import com.workplace.wiki.dto.WikiMentionRef;
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
    return dsl.select(
            WIKI_PAGE.ID,
            WIKI_PAGE.PARENT_ID,
            WIKI_PAGE.TITLE,
            WIKI_PAGE.POSITION,
            WIKI_PAGE.AI_LAST_USED_AT)
        .from(WIKI_PAGE)
        .where(WIKI_PAGE.SPACE_ID.eq(spaceId))
        .orderBy(WIKI_PAGE.PARENT_ID.asc().nullsFirst(), WIKI_PAGE.POSITION.asc())
        .fetch(
            r ->
                new WikiPageSummary(
                    r.get(WIKI_PAGE.ID),
                    r.get(WIKI_PAGE.PARENT_ID),
                    r.get(WIKI_PAGE.TITLE),
                    r.get(WIKI_PAGE.POSITION),
                    r.get(WIKI_PAGE.AI_LAST_USED_AT)));
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
            WIKI_PAGE.UPDATED_AT,
            WIKI_PAGE.AI_LAST_USED_AT,
            WIKI_PAGE.AI_LAST_ACTION)
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
                    r.get(WIKI_PAGE.UPDATED_AT),
                    r.get(WIKI_PAGE.AI_LAST_USED_AT),
                    r.get(WIKI_PAGE.AI_LAST_ACTION)));
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

  /**
   * #736 AI 생성 attribution 기록 — {@code ai_last_used_at}/{@code ai_last_action} 두 컬럼만 갱신한다.
   *
   * <p><b>{@code version}/{@code updated_at}/{@code updated_by} 는 절대 건드리지 않는다.</b> {@link
   * #saveIfVersion} 처럼 version 을 올리면, 스트림 도중/직후 진행 중이던 에디터가 들고 있던 낙관적 동시성 버전이 서버 기준으로 낡아져 뒤이은 자동저장
   * PUT 이 매번 {@code affected == 0} → 충돌 처리되는 회귀가 생긴다(AI 생성 = 사람 편집 아님).
   */
  public void recordAiUsage(long pageId, String action, java.time.OffsetDateTime at) {
    dsl.update(WIKI_PAGE)
        .set(WIKI_PAGE.AI_LAST_USED_AT, at)
        .set(WIKI_PAGE.AI_LAST_ACTION, action)
        .where(WIKI_PAGE.ID.eq(pageId))
        .execute();
  }

  /**
   * #758 pageId 에서 parent_id 를 따라 루트까지 올라가며 만나는 모든 조상 id — <b>자기 자신을 포함</b>한다. 이동 가드에서 "새 부모의 조상
   * 체인에 이동 대상이 들어 있는가" 를 묻는 데 쓴다(자기 자신을 부모로 지정하는 경우도 체인 첫 행이라 같은 검사로 걸린다).
   *
   * <p>재귀항은 UNION ALL 이 아니라 UNION 이어야 한다 — 이 가드가 생기기 전에 만들어진 사이클 데이터가 남아 있으면 UNION ALL 은 같은 id 를 무한
   * 재생산해 working table 이 비지 않아 쿼리가 끝나지 않는다(statement_timeout 미설정). UNION 은 이미 나온 행을 걸러 정상 종료한다.
   */
  public java.util.List<Long> ancestorIdsInclusive(long pageId) {
    return dsl.fetch(
            """
            WITH RECURSIVE chain(id, parent_id) AS (
              SELECT id, parent_id FROM wiki_page WHERE id = ?
              UNION
              SELECT p.id, p.parent_id FROM wiki_page p JOIN chain c ON p.id = c.parent_id
            )
            SELECT id FROM chain
            """,
            pageId)
        .map(r -> r.get(0, Long.class));
  }

  /** 위키 트리 이동 잠금 전용 classId — 2-인자 pg_advisory_xact_lock(classId, spaceId) 형태에서 사용. */
  private static final int WIKI_TREE_LOCK_CLASS = 758;

  /**
   * #758 같은 공간의 트리 이동을 직렬화한다. 사이클 검사({@link #ancestorIdsInclusive})와 실제 {@link #move} 사이에는
   * check-then-act 간극이 있고, READ COMMITTED 에서 "X 를 Y 밑으로" 와 "Y 를 X 밑으로" 는 서로 다른 행을 UPDATE 하므로 행 잠금이
   * 충돌하지 않아 둘 다 통과해 사이클이 만들어진다. 행 단위 FOR UPDATE 로는 3자 사이클(A→B, B→C, C→A)이 서로 겹치지 않는 행 쌍을 건드려
   * 빠져나가므로, 공간 단위 어드바이저리 락이 올바른 입도다. 트랜잭션 종료 시 자동 해제.
   */
  public void lockSpaceTree(long spaceId) {
    dsl.execute("SELECT pg_advisory_xact_lock(?, ?)", WIKI_TREE_LOCK_CLASS, (int) spaceId);
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

  /**
   * pageIds 중 호출자가 멤버인 스페이스의 페이지만 백링크 형태로 반환한다. search() 와 동일한 멤버십
   * 조인(WIKI_PAGE⨝WIKI_SPACE⨝WIKI_SPACE_MEMBER user=caller)으로 접근 불가 스페이스의 페이지를 자연 배제. 빈 ids 면 빈 리스트.
   */
  public List<WikiBacklink> findVisibleBacklinks(long callerId, List<Long> pageIds) {
    if (pageIds == null || pageIds.isEmpty()) return List.of();
    return visiblePagesQuery(callerId, pageIds)
        .orderBy(WIKI_PAGE.UPDATED_AT.desc())
        .fetch(
            r ->
                new WikiBacklink(
                    r.get(WIKI_PAGE.ID),
                    r.get(WIKI_PAGE.SPACE_ID),
                    r.get(WIKI_SPACE.NAME),
                    r.get(WIKI_PAGE.TITLE),
                    r.get(WIKI_PAGE.UPDATED_AT)));
  }

  /**
   * 페이지 멘션 하이드레이션용 — pageIds 중 호출자가 멤버인 스페이스의 페이지를 칩 메타(type=PAGE, label=title, spaceId)로 반환한다. 가시성
   * 스코핑은 {@link #findVisibleBacklinks} 와 동일. projectKey/number 는 PAGE 에 무의미하므로 null. 빈 ids 면 빈 리스트.
   */
  public List<WikiMentionRef> findVisiblePageRefs(long callerId, List<Long> pageIds) {
    if (pageIds == null || pageIds.isEmpty()) return List.of();
    return visiblePagesQuery(callerId, pageIds)
        .fetch(
            r ->
                new WikiMentionRef(
                    "PAGE",
                    r.get(WIKI_PAGE.ID),
                    r.get(WIKI_PAGE.TITLE),
                    r.get(WIKI_PAGE.SPACE_ID),
                    null,
                    null));
  }

  /**
   * pageIds 중 호출자가 멤버인 스페이스의 페이지 행을 고르는 공통 가시성 쿼리(id/spaceId/spaceName/title/updatedAt 컬럼). 백링크·페이지
   * 멘션 하이드레이션이 같은 멤버십 조인을 재사용한다.
   */
  private org.jooq.SelectConditionStep<
          org.jooq.Record5<Long, Long, String, String, java.time.OffsetDateTime>>
      visiblePagesQuery(long callerId, List<Long> pageIds) {
    return dsl.select(
            WIKI_PAGE.ID,
            WIKI_PAGE.SPACE_ID,
            WIKI_SPACE.NAME,
            WIKI_PAGE.TITLE,
            WIKI_PAGE.UPDATED_AT)
        .from(WIKI_PAGE)
        .join(WIKI_SPACE)
        .on(WIKI_SPACE.ID.eq(WIKI_PAGE.SPACE_ID))
        .join(WIKI_SPACE_MEMBER)
        .on(WIKI_SPACE_MEMBER.SPACE_ID.eq(WIKI_PAGE.SPACE_ID))
        .where(WIKI_SPACE_MEMBER.USER_ID.eq(callerId))
        .and(WIKI_PAGE.ID.in(pageIds));
  }
}
