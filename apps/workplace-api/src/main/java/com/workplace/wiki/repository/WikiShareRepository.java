package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE_EVENT;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE_EXCLUSION;
import static com.workplace.jooq.Tables.WIKI_PAGE_SHARE_MEMBER;
import static com.workplace.jooq.Tables.WIKI_SHARE_ACCESS_REQUEST;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static com.workplace.jooq.Tables.WIKI_SPACE_MEMBER;

import com.workplace.wiki.dto.WikiMentionRef;
import com.workplace.wiki.dto.WikiPageShareStateResponse.AccessRequest;
import com.workplace.wiki.dto.WikiPageShareStateResponse.ExcludedPage;
import com.workplace.wiki.dto.WikiPageShareStateResponse.Inherited;
import com.workplace.wiki.dto.WikiPageSummary;
import com.workplace.wiki.dto.WikiShareEventResponse;
import com.workplace.wiki.dto.WikiShareListItemResponse;
import com.workplace.wiki.dto.WikiSharePerson;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.JSONB;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 노트 페이지 공유(wiki_page_share 와 지정한 사람·접근 요청) 조회(WP-579). 모든 조회는 RLS(테넌트) 아래에서 돈다 — 다른 테넌트의 토큰은 행이
 * 보이지 않아 "없는 공유"가 된다.
 */
@Repository
@RequiredArgsConstructor
public class WikiShareRepository {
  private final DSLContext dsl;

  /**
   * 판정에 필요한 공유 행 한 건.
   *
   * @param externalShareEnabled 공유가 속한 테넌트의 「외부 공유 허용」 — PUBLIC 공유는 이 값이 꺼져 있으면 없는 공유로 본다
   * @param expiresAt 만료 시각(null = 무기한) — 동기화 서버가 공유로 붙은 연결을 이 시각에 다시 판정한다
   */
  public record ShareRow(
      long id,
      long pageId,
      long spaceId,
      String audience,
      String permission,
      boolean includeChildren,
      long createdBy,
      boolean externalShareEnabled,
      OffsetDateTime expiresAt) {}

  /**
   * 토큰으로 만료 전 공유 한 건. 만료는 DB 시계로 판정한다({@code wiki_page_share_resolve_public} 과 같은 규칙) — 앱·DB 시계가
   * 어긋나도 두 경로의 결론이 같게. 캐시하지 않는다: 해제·재발급이 다음 요청부터 바로 막혀야 한다.
   */
  public Optional<ShareRow> findActiveByToken(String token) {
    return selectActiveByToken(token).fetchOptional(WikiShareRepository::toShareRow);
  }

  /**
   * {@link #findActiveByToken} 와 같은 조회를 공유 행을 잠그고 한다 — 잠근 행이 곧 판단 대상이라 요청 생성 같은 쓰기가 해제·재발급·재공유와
   * 엇갈리지 않는다. 잠금을 기다린 사이 해제·재발급(토큰 변경)·만료됐으면 그 행은 조건에서 빠져 빈 값이다. 테넌트 행은 잠그지 않는다.
   */
  public Optional<ShareRow> findActiveByTokenForUpdate(String token) {
    return selectActiveByToken(token)
        .forUpdate()
        .of(WIKI_PAGE_SHARE)
        .fetchOptional(WikiShareRepository::toShareRow);
  }

  private org.jooq.SelectConditionStep<?> selectActiveByToken(String token) {
    return dsl.select(
            WIKI_PAGE_SHARE.ID,
            WIKI_PAGE_SHARE.PAGE_ID,
            WIKI_PAGE_SHARE.SPACE_ID,
            WIKI_PAGE_SHARE.AUDIENCE,
            WIKI_PAGE_SHARE.PERMISSION,
            WIKI_PAGE_SHARE.INCLUDE_CHILDREN,
            WIKI_PAGE_SHARE.CREATED_BY,
            TENANT.WIKI_EXTERNAL_SHARE_ENABLED,
            WIKI_PAGE_SHARE.EXPIRES_AT)
        .from(WIKI_PAGE_SHARE)
        .join(TENANT)
        .on(TENANT.ID.eq(WIKI_PAGE_SHARE.TENANT_ID))
        .where(WIKI_PAGE_SHARE.TOKEN.eq(token))
        .and(notExpired());
  }

  private static ShareRow toShareRow(org.jooq.Record r) {
    return new ShareRow(
        r.get(WIKI_PAGE_SHARE.ID),
        r.get(WIKI_PAGE_SHARE.PAGE_ID),
        r.get(WIKI_PAGE_SHARE.SPACE_ID),
        r.get(WIKI_PAGE_SHARE.AUDIENCE),
        r.get(WIKI_PAGE_SHARE.PERMISSION),
        r.get(WIKI_PAGE_SHARE.INCLUDE_CHILDREN),
        r.get(WIKI_PAGE_SHARE.CREATED_BY),
        r.get(TENANT.WIKI_EXTERNAL_SHARE_ENABLED),
        r.get(WIKI_PAGE_SHARE.EXPIRES_AT));
  }

  /** 만료 전(무기한 포함) 공유 — 만료는 DB 시계로 판정한다. 토큰 판정·알림 진입 토큰 찾기가 함께 쓴다(같은 시계·같은 규칙). */
  private static Condition notExpired() {
    return WIKI_PAGE_SHARE
        .EXPIRES_AT
        .isNull()
        .or(WIKI_PAGE_SHARE.EXPIRES_AT.gt(DSL.currentOffsetDateTime()));
  }

  /** PEOPLE 공유의 지정한 사람인지. */
  public boolean isListed(long shareId, long userId) {
    return dsl.fetchExists(
        WIKI_PAGE_SHARE_MEMBER,
        WIKI_PAGE_SHARE_MEMBER.SHARE_ID.eq(shareId).and(WIKI_PAGE_SHARE_MEMBER.USER_ID.eq(userId)));
  }

  /**
   * 이 페이지를 덮을 수 있는(만료 전) 공유의 토큰 후보 — 이 사용자가 지정한 사람으로 들어 있는 공유, 그리고 withWorkspace 면 워크스페이스 전체 공유까지.
   * 페이지 자신의 공유와 하위 포함으로 조상이 건 공유이고, 가까운 쪽 먼저가 아니라 만든 순이다. 진입할 때 지금 토큰을 찾는 데 쓴다(재발급돼도 최신). 하위의 제외
   * 표시·따로 켠 공유로 상속이 멈췄는지는 보지 않는다 — 호출자가 토큰마다 {@code WikiShareAccess} 판정으로 다시 거른다. ancestorIds 는 자기
   * 포함 조상 체인이다.
   *
   * <p>알림 목록의 가시성 SQL({@code NotificationRepository#wikiReadableByRecipient})은 withWorkspace=false
   * 의 규칙(+상속 멈춤)을 그대로 따른다 — 하나를 바꾸면 다른 쪽도 함께 바꾼다(보이는 알림 ⇔ 누르면 열림).
   */
  public List<String> findCoveringTokens(
      long pageId, long userId, Collection<Long> ancestorIds, boolean withWorkspace) {
    Condition listed =
        DSL.exists(
            DSL.selectOne()
                .from(WIKI_PAGE_SHARE_MEMBER)
                .where(WIKI_PAGE_SHARE_MEMBER.SHARE_ID.eq(WIKI_PAGE_SHARE.ID))
                .and(WIKI_PAGE_SHARE_MEMBER.USER_ID.eq(userId)));
    Condition audience =
        withWorkspace ? listed.or(WIKI_PAGE_SHARE.AUDIENCE.eq("WORKSPACE")) : listed;
    return dsl.select(WIKI_PAGE_SHARE.TOKEN)
        .from(WIKI_PAGE_SHARE)
        .where(WIKI_PAGE_SHARE.PAGE_ID.in(ancestorIds))
        .and(WIKI_PAGE_SHARE.PAGE_ID.eq(pageId).or(WIKI_PAGE_SHARE.INCLUDE_CHILDREN.isTrue()))
        .and(notExpired())
        .and(audience)
        .orderBy(WIKI_PAGE_SHARE.ID)
        .fetch(WIKI_PAGE_SHARE.TOKEN);
  }

  /**
   * 403 응답이 싣는 이 사람의 접근 요청 상태 — 대기 중 요청이 있는지({@code requested})와 지금 공유에 대한 최근 거절이 있는지({@code
   * denied} — 결정 시각이 deniedSince 뒤이고 요청이 지금 공유가 생긴 뒤에 온 거절, 기준은 {@link #hasDenialSince} 와 같다). 한 번의
   * 조회로 둘 다 읽는다.
   */
  public RequestFlags findRequestFlags(long pageId, long userId, OffsetDateTime deniedSince) {
    Field<Boolean> pending =
        DSL.field(
            DSL.exists(
                DSL.selectOne()
                    .from(WIKI_SHARE_ACCESS_REQUEST)
                    .where(WIKI_SHARE_ACCESS_REQUEST.PAGE_ID.eq(pageId))
                    .and(WIKI_SHARE_ACCESS_REQUEST.REQUESTER_ID.eq(userId))
                    .and(WIKI_SHARE_ACCESS_REQUEST.STATUS.eq("PENDING"))));
    Field<Boolean> denied = DSL.field(DSL.exists(denialSince(pageId, userId, deniedSince)));
    return dsl.select(pending, denied).fetchOne(r -> new RequestFlags(r.value1(), r.value2()));
  }

  /**
   * 접근 요청 상태 — 403 응답의 버튼 고르기용.
   *
   * @param pending 대기 중 요청이 있다
   * @param recentlyDenied 지금 공유에 대한 최근 거절이 있다 — 요청 생성 시각 ≥ 지금 공유 생성 시각(둘 다 DB 시계)인 요청이 재요청 대기 시간 안에
   *     거절됐다({@link #hasDenialSince})
   */
  public record RequestFlags(boolean pending, boolean recentlyDenied) {}

  /**
   * 페이지 id 들의 멘션 칩 메타(제목·스페이스). 스페이스 멤버십을 보지 않으므로(RLS 테넌트만) 공유 범위 판정을 통과한 페이지에만 쓴다 — 멤버용 가시성 조회는
   * {@link WikiPageRepository#findVisiblePageRefs}.
   */
  public List<WikiMentionRef> findPageRefs(Collection<Long> pageIds) {
    if (pageIds.isEmpty()) {
      return List.of();
    }
    return dsl.select(WIKI_PAGE.ID, WIKI_PAGE.TITLE, WIKI_PAGE.SPACE_ID)
        .from(WIKI_PAGE)
        .where(WIKI_PAGE.ID.in(pageIds))
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

  // ── 공유 설정(WP-579 Task 3) ──────────────────────────────────────────────

  /**
   * 공유 창에 보이는 공유 한 건(만료 무관 — 만료된 공유도 설정은 보이고 고칠 수 있어야 한다).
   *
   * @param createdByName 공유한 사람 표시 이름
   */
  public record ShareDetail(
      long id,
      long pageId,
      long spaceId,
      String token,
      String audience,
      String permission,
      boolean includeChildren,
      OffsetDateTime expiresAt,
      long createdBy,
      String createdByName,
      OffsetDateTime createdAt,
      OffsetDateTime updatedAt,
      OffsetDateTime lastAccessedAt,
      long viewCount) {}

  /** 페이지의 공유(없으면 빈 값). */
  public Optional<ShareDetail> findByPage(long pageId) {
    return selectDetail(WIKI_PAGE_SHARE.PAGE_ID.eq(pageId))
        .fetchOptional(WikiShareRepository::toDetail);
  }

  /**
   * 페이지의 공유를 잠그고 읽는다 — 같은 공유를 동시에 바꾸는 두 요청이 같은 이전 값으로 추가·제외를 계산해 기록이 엇갈리지 않게 한다. 사용자 행은 잠그지 않는다.
   */
  public Optional<ShareDetail> findByPageForUpdate(long pageId) {
    return selectDetail(WIKI_PAGE_SHARE.PAGE_ID.eq(pageId))
        .forUpdate()
        .of(WIKI_PAGE_SHARE)
        .fetchOptional(WikiShareRepository::toDetail);
  }

  private org.jooq.SelectConditionStep<?> selectDetail(Condition where) {
    return dsl.select(
            WIKI_PAGE_SHARE.ID,
            WIKI_PAGE_SHARE.PAGE_ID,
            WIKI_PAGE_SHARE.SPACE_ID,
            WIKI_PAGE_SHARE.TOKEN,
            WIKI_PAGE_SHARE.AUDIENCE,
            WIKI_PAGE_SHARE.PERMISSION,
            WIKI_PAGE_SHARE.INCLUDE_CHILDREN,
            WIKI_PAGE_SHARE.EXPIRES_AT,
            WIKI_PAGE_SHARE.CREATED_BY,
            USER.NAME,
            WIKI_PAGE_SHARE.CREATED_AT,
            WIKI_PAGE_SHARE.UPDATED_AT,
            WIKI_PAGE_SHARE.LAST_ACCESSED_AT,
            WIKI_PAGE_SHARE.VIEW_COUNT)
        .from(WIKI_PAGE_SHARE)
        .join(USER)
        .on(USER.ID.eq(WIKI_PAGE_SHARE.CREATED_BY))
        .where(where);
  }

  private static ShareDetail toDetail(org.jooq.Record r) {
    return new ShareDetail(
        r.get(WIKI_PAGE_SHARE.ID),
        r.get(WIKI_PAGE_SHARE.PAGE_ID),
        r.get(WIKI_PAGE_SHARE.SPACE_ID),
        r.get(WIKI_PAGE_SHARE.TOKEN),
        r.get(WIKI_PAGE_SHARE.AUDIENCE),
        r.get(WIKI_PAGE_SHARE.PERMISSION),
        r.get(WIKI_PAGE_SHARE.INCLUDE_CHILDREN),
        r.get(WIKI_PAGE_SHARE.EXPIRES_AT),
        r.get(WIKI_PAGE_SHARE.CREATED_BY),
        r.get(USER.NAME),
        r.get(WIKI_PAGE_SHARE.CREATED_AT),
        r.get(WIKI_PAGE_SHARE.UPDATED_AT),
        r.get(WIKI_PAGE_SHARE.LAST_ACCESSED_AT),
        r.get(WIKI_PAGE_SHARE.VIEW_COUNT));
  }

  /**
   * 공유를 만든다. 같은 페이지에 동시에 처음 켠 요청이 있으면(page_id UNIQUE) 아무것도 하지 않고 false — 호출자는 그 행을 잠가 읽고 바꾸기로 넘어간다.
   */
  public boolean insertIfAbsent(
      long pageId,
      long spaceId,
      String token,
      String audience,
      String permission,
      boolean includeChildren,
      OffsetDateTime expiresAt,
      long createdBy) {
    return dsl.insertInto(WIKI_PAGE_SHARE)
            .set(WIKI_PAGE_SHARE.PAGE_ID, pageId)
            .set(WIKI_PAGE_SHARE.SPACE_ID, spaceId)
            .set(WIKI_PAGE_SHARE.TOKEN, token)
            .set(WIKI_PAGE_SHARE.AUDIENCE, audience)
            .set(WIKI_PAGE_SHARE.PERMISSION, permission)
            .set(WIKI_PAGE_SHARE.INCLUDE_CHILDREN, includeChildren)
            .set(WIKI_PAGE_SHARE.EXPIRES_AT, expiresAt)
            .set(WIKI_PAGE_SHARE.CREATED_BY, createdBy)
            .onConflict(WIKI_PAGE_SHARE.PAGE_ID)
            .doNothing()
            .execute()
        == 1;
  }

  /** 설정(대상·권한·하위 포함·만료)을 바꾸고 수정 시각을 남긴다. 토큰·공유한 사람·조회 수는 그대로. */
  public void updateSettings(
      long shareId,
      String audience,
      String permission,
      boolean includeChildren,
      OffsetDateTime expiresAt) {
    dsl.update(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.AUDIENCE, audience)
        .set(WIKI_PAGE_SHARE.PERMISSION, permission)
        .set(WIKI_PAGE_SHARE.INCLUDE_CHILDREN, includeChildren)
        .set(WIKI_PAGE_SHARE.EXPIRES_AT, expiresAt)
        .set(WIKI_PAGE_SHARE.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(WIKI_PAGE_SHARE.ID.eq(shareId))
        .execute();
  }

  /** 링크 재발급 — 토큰만 바꾼다. 이전 토큰은 이 커밋부터 어떤 판정에서도 없는 공유다. */
  public void updateToken(long shareId, String token) {
    dsl.update(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.TOKEN, token)
        .set(WIKI_PAGE_SHARE.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(WIKI_PAGE_SHARE.ID.eq(shareId))
        .execute();
  }

  /** 공유 해제 — 지정한 사람은 CASCADE 로 함께 지워지고, 기록(page 에 매달림)은 남는다. */
  public void delete(long shareId) {
    dsl.deleteFrom(WIKI_PAGE_SHARE).where(WIKI_PAGE_SHARE.ID.eq(shareId)).execute();
  }

  /** 지정한 사람(이름순). */
  public List<WikiSharePerson> listPeople(long shareId) {
    return dsl.select(WIKI_PAGE_SHARE_MEMBER.USER_ID, USER.NAME)
        .from(WIKI_PAGE_SHARE_MEMBER)
        .join(USER)
        .on(USER.ID.eq(WIKI_PAGE_SHARE_MEMBER.USER_ID))
        .where(WIKI_PAGE_SHARE_MEMBER.SHARE_ID.eq(shareId))
        .orderBy(USER.NAME.asc(), WIKI_PAGE_SHARE_MEMBER.USER_ID.asc())
        .fetch(r -> new WikiSharePerson(r.value1(), r.value2()));
  }

  /**
   * 지정한 사람 id — 사람 차이 계산용. 순서는 {@link #listPeople} 과 같은 이름순이다(제외한 사람 기록 문구·감사 목록의 순서가 그대로 이어지게).
   */
  public List<Long> listPeopleIds(long shareId) {
    return dsl.select(WIKI_PAGE_SHARE_MEMBER.USER_ID)
        .from(WIKI_PAGE_SHARE_MEMBER)
        .join(USER)
        .on(USER.ID.eq(WIKI_PAGE_SHARE_MEMBER.USER_ID))
        .where(WIKI_PAGE_SHARE_MEMBER.SHARE_ID.eq(shareId))
        .orderBy(USER.NAME.asc(), WIKI_PAGE_SHARE_MEMBER.USER_ID.asc())
        .fetch(WIKI_PAGE_SHARE_MEMBER.USER_ID);
  }

  /** 지정한 사람 추가(이미 있으면 그대로) — 한 문장으로 넣는다. 비었으면 아무것도 하지 않는다. */
  public void addPeople(long shareId, Collection<Long> userIds, long addedBy) {
    if (userIds.isEmpty()) {
      return;
    }
    var insert =
        dsl.insertInto(
            WIKI_PAGE_SHARE_MEMBER,
            WIKI_PAGE_SHARE_MEMBER.SHARE_ID,
            WIKI_PAGE_SHARE_MEMBER.USER_ID,
            WIKI_PAGE_SHARE_MEMBER.ADDED_BY);
    for (Long userId : userIds) {
      insert = insert.values(shareId, userId, addedBy);
    }
    insert.onConflictDoNothing().execute();
  }

  /** 지정한 사람에서 뺀다. userIds 가 null 이면 모두. */
  public void removePeople(long shareId, Collection<Long> userIds) {
    Condition who =
        userIds == null ? DSL.noCondition() : WIKI_PAGE_SHARE_MEMBER.USER_ID.in(userIds);
    dsl.deleteFrom(WIKI_PAGE_SHARE_MEMBER)
        .where(WIKI_PAGE_SHARE_MEMBER.SHARE_ID.eq(shareId))
        .and(who)
        .execute();
  }

  /** 공유 기록 한 줄을 남긴다. detail 은 {@code {"text": 화면 문구}} — 문구는 서버가 만든다. actorId null = 시스템. */
  public void insertEvent(long pageId, Long actorId, String type, JSONB detail) {
    dsl.insertInto(WIKI_PAGE_SHARE_EVENT)
        .set(WIKI_PAGE_SHARE_EVENT.PAGE_ID, pageId)
        .set(WIKI_PAGE_SHARE_EVENT.ACTOR_ID, actorId)
        .set(WIKI_PAGE_SHARE_EVENT.TYPE, type)
        .set(WIKI_PAGE_SHARE_EVENT.DETAIL, detail)
        .execute();
  }

  /**
   * 페이지의 공유 기록(최신순, limit 건). 한 저장에서 남긴 여러 줄은 created_at(트랜잭션 시작 시각)이 같으므로 id 로 순서를 잇는다. 행위자가
   * 없으면(시스템) {@link WikiSharePerson#SYSTEM}.
   */
  public List<WikiShareEventResponse> listEvents(long pageId, int limit) {
    Field<String> text = DSL.field("{0} ->> 'text'", String.class, WIKI_PAGE_SHARE_EVENT.DETAIL);
    return dsl.select(
            WIKI_PAGE_SHARE_EVENT.ID,
            WIKI_PAGE_SHARE_EVENT.TYPE,
            WIKI_PAGE_SHARE_EVENT.ACTOR_ID,
            USER.NAME,
            text,
            WIKI_PAGE_SHARE_EVENT.CREATED_AT)
        .from(WIKI_PAGE_SHARE_EVENT)
        .leftJoin(USER)
        .on(USER.ID.eq(WIKI_PAGE_SHARE_EVENT.ACTOR_ID))
        .where(WIKI_PAGE_SHARE_EVENT.PAGE_ID.eq(pageId))
        .orderBy(WIKI_PAGE_SHARE_EVENT.CREATED_AT.desc(), WIKI_PAGE_SHARE_EVENT.ID.desc())
        .limit(limit)
        .fetch(
            r ->
                new WikiShareEventResponse(
                    r.get(WIKI_PAGE_SHARE_EVENT.ID),
                    r.get(WIKI_PAGE_SHARE_EVENT.TYPE),
                    r.get(WIKI_PAGE_SHARE_EVENT.ACTOR_ID) == null
                        ? WikiSharePerson.SYSTEM
                        : new WikiSharePerson(
                            r.get(WIKI_PAGE_SHARE_EVENT.ACTOR_ID), r.get(USER.NAME)),
                    r.get(text),
                    r.get(WIKI_PAGE_SHARE_EVENT.CREATED_AT)));
  }

  /**
   * 상속이 멈추는 페이지(WP-987) — 상위 공유에서 제외 표시가 있거나, 따로 켠 공유(만료 전)가 있는 페이지. 그 페이지와 서브트리는 그 위의 하위 포함 공유로
   * 열리지 않는다(따로 켠 공유는 그 공유대로 열린다 — 하위의 설정이 상위보다 우선). SQL 안에서 페이지 id 열 이름 하나({@code col})로 판정한다.
   */
  private static String stopsInheritance(String col) {
    return "(EXISTS (SELECT 1 FROM wiki_page_share_exclusion e WHERE e.page_id = "
        + col
        + ") OR EXISTS (SELECT 1 FROM wiki_page_share s2 WHERE s2.page_id = "
        + col
        + " AND (s2.expires_at IS NULL OR s2.expires_at > now())))";
  }

  /**
   * 공유 루트 rootPageId 의 하위 포함 공유가 pageId(루트 아래 페이지)를 지금 덮는지(WP-987) — pageId 의 조상 체인에 루트가 있고, pageId
   * 부터 루트 바로 아래까지 상속이 멈추는 페이지({@link #stopsInheritance})가 없다. 루트 자신은 묻지 않는다(호출자가 먼저 본다). 체인은 루트에서
   * 멈춘다 — 루트 위 조상은 판정과 상관없다. 재귀항은 {@link WikiPageRepository#ancestorIdsInclusive} 와 같은 이유로 UNION.
   */
  public boolean isCoveredBy(long rootPageId, long pageId) {
    return Boolean.TRUE.equals(
        dsl.fetchValue(
            """
            WITH RECURSIVE chain(id, parent_id) AS (
              SELECT id, parent_id FROM wiki_page WHERE id = ?
              UNION
              SELECT p.id, p.parent_id FROM wiki_page p JOIN chain c ON p.id = c.parent_id
              WHERE c.id <> ?
            )
            SELECT EXISTS (SELECT 1 FROM chain WHERE id = ?)
               AND NOT EXISTS (SELECT 1 FROM chain c WHERE c.id <> ? AND %s)
            """
                .formatted(stopsInheritance("c.id")),
            pageId,
            rootPageId,
            rootPageId,
            rootPageId));
  }

  /**
   * 하위 포함 공유가 덮는 페이지(WP-987) — 루트와, 상속이 멈추는 페이지({@link #stopsInheritance})에서 내려가지 않는 서브트리. 공유 화면의
   * 페이지 목록·멘션 가림이 쓴다({@link #isCoveredBy} 와 같은 규칙).
   */
  public List<Long> coveredSubtree(long rootPageId) {
    return dsl.fetch(
            """
            WITH RECURSIVE tree(id) AS (
              SELECT id FROM wiki_page WHERE id = ?
              UNION
              SELECT p.id FROM wiki_page p JOIN tree t ON p.parent_id = t.id
              WHERE NOT %s
            )
            SELECT id FROM tree
            """
                .formatted(stopsInheritance("p.id")),
            rootPageId)
        .map(r -> r.get(0, Long.class));
  }

  /**
   * 이 하위 포함 공유에서 제외된 페이지(WP-987) — 공유가 덮는 서브트리의 바로 아래에서 제외 표시로 멈춘 페이지(따로 켠 공유로 멈춘 페이지는 빼고). 상위 공유
   * 창의 「제외: 회의록 3 [제외 풀기]」 목록이다. 제목 순.
   */
  public List<ExcludedPage> listExcludedUnder(long rootPageId) {
    return dsl.fetch(
            """
            WITH RECURSIVE tree(id) AS (
              SELECT id FROM wiki_page WHERE id = ?
              UNION
              SELECT p.id FROM wiki_page p JOIN tree t ON p.parent_id = t.id
              WHERE NOT %s
            )
            SELECT p.id, p.title FROM wiki_page p
            JOIN tree t ON p.parent_id = t.id
            JOIN wiki_page_share_exclusion e ON e.page_id = p.id
            WHERE NOT EXISTS (SELECT 1 FROM wiki_page_share s2 WHERE s2.page_id = p.id
                              AND (s2.expires_at IS NULL OR s2.expires_at > now()))
            ORDER BY p.title, p.id
            """
                .formatted(stopsInheritance("p.id")),
            rootPageId)
        .map(r -> new ExcludedPage(r.get(0, Long.class), r.get(1, String.class)));
  }

  /** 이 페이지에 상위 공유 제외 표시가 있는지(WP-987). */
  public boolean isExcluded(long pageId) {
    return dsl.fetchExists(WIKI_PAGE_SHARE_EXCLUSION, WIKI_PAGE_SHARE_EXCLUSION.PAGE_ID.eq(pageId));
  }

  /** 상위 공유 제외 표시를 단다(멱등) — 새로 달았으면 true. */
  public boolean insertExclusion(long pageId, long userId) {
    return dsl.insertInto(WIKI_PAGE_SHARE_EXCLUSION)
            .set(WIKI_PAGE_SHARE_EXCLUSION.PAGE_ID, pageId)
            .set(WIKI_PAGE_SHARE_EXCLUSION.CREATED_BY, userId)
            .onConflictDoNothing()
            .execute()
        > 0;
  }

  /** 상위 공유 제외 표시를 뗀다(멱등) — 있던 것을 뗐으면 true. */
  public boolean deleteExclusion(long pageId) {
    return dsl.deleteFrom(WIKI_PAGE_SHARE_EXCLUSION)
            .where(WIKI_PAGE_SHARE_EXCLUSION.PAGE_ID.eq(pageId))
            .execute()
        > 0;
  }

  /**
   * 이 페이지가 상속받는 상위 공유(WP-987) — 부모부터 올라가며 처음 만나는 「상속이 멈추는 페이지」가 하위 포함 공유를 가진 조상이면 그 공유, 아니면 없음. 따로
   * 켠 공유가 하위를 포함하지 않으면 거기서 멈추고, 조상의 제외 표시도 거기서 멈춘다. 이 페이지 자신의 제외 표시·공유는 보지 않는다 — 공유 창이 「상위 공유에서 받은
   * 권한」 상자와 제외 체크(켜져 있어도)를 함께 보이게. 깊이를 매겨 가까운 쪽을 고른다 — 재귀 CTE 의 출력 순서에 기대지 않는다.
   */
  public Optional<Inherited> findNearestIncludingAncestor(long pageId) {
    return dsl.fetchOptional(
            """
            WITH RECURSIVE chain(id, parent_id, depth) AS (
              SELECT id, parent_id, 0 FROM wiki_page WHERE id = ?
              UNION
              SELECT p.id, p.parent_id, c.depth + 1 FROM wiki_page p JOIN chain c ON p.id = c.parent_id
              WHERE c.depth < 1000
            )
            SELECT s.page_id, p.title, s.audience, s.permission, s.token, s.include_children
            FROM chain c
            JOIN wiki_page p ON p.id = c.id
            LEFT JOIN wiki_page_share s ON s.page_id = c.id
              AND (s.expires_at IS NULL OR s.expires_at > now())
            WHERE c.depth > 0
              AND (s.id IS NOT NULL OR EXISTS (SELECT 1 FROM wiki_page_share_exclusion e WHERE e.page_id = c.id))
            ORDER BY c.depth
            LIMIT 1
            """,
            pageId)
        .filter(r -> r.get(0) != null && Boolean.TRUE.equals(r.get(5, Boolean.class)))
        .map(
            r ->
                new Inherited(
                    r.get(0, Long.class),
                    r.get(1, String.class),
                    r.get(2, String.class),
                    r.get(3, String.class),
                    r.get(4, String.class)));
  }

  /** 이 페이지에 대기 중인 접근 요청(오래된 순). 접근 요청은 공유 루트 page_id 로 만들어진다. */
  public List<AccessRequest> listPendingRequests(long pageId) {
    return dsl.select(
            WIKI_SHARE_ACCESS_REQUEST.ID,
            WIKI_SHARE_ACCESS_REQUEST.REQUESTER_ID,
            USER.NAME,
            WIKI_SHARE_ACCESS_REQUEST.CREATED_AT)
        .from(WIKI_SHARE_ACCESS_REQUEST)
        .join(USER)
        .on(USER.ID.eq(WIKI_SHARE_ACCESS_REQUEST.REQUESTER_ID))
        .where(WIKI_SHARE_ACCESS_REQUEST.PAGE_ID.eq(pageId))
        .and(WIKI_SHARE_ACCESS_REQUEST.STATUS.eq("PENDING"))
        .orderBy(WIKI_SHARE_ACCESS_REQUEST.CREATED_AT.asc(), WIKI_SHARE_ACCESS_REQUEST.ID.asc())
        .fetch(
            r ->
                new AccessRequest(
                    r.value1(), new WikiSharePerson(r.value2(), r.value3()), r.value4()));
  }

  // ── 링크 열기·접근 요청(WP-579 Task 4) ──────────────────────────────────────

  /**
   * 토큰이 속한 워크스페이스 — RLS 와 무관하게(SECURITY DEFINER {@code wiki_page_share_tenant}) 찾는다. 지금 워크스페이스의 행이
   * 보이는지와 별개로 "다른 워크스페이스의 링크인가" 를 판정하는 데 쓴다. 만료·대상과 무관하게 돌려준다. 없는 토큰이면 빈 값.
   */
  public Optional<Long> findTenantOfToken(String token) {
    return Optional.ofNullable(
        dsl.select(DSL.field("wiki_page_share_tenant({0})", Long.class, DSL.val(token)))
            .fetchOne(0, Long.class));
  }

  // ── 외부(비로그인) 보기(WP-579 Task 7) ─────────────────────────────────────

  /**
   * 외부로 열 수 있는 링크의 워크스페이스 — SECURITY DEFINER {@code wiki_page_share_resolve_public} 로 RLS 없이(테넌트
   * GUC 가 없는 비로그인 요청) 찾는다. 외부(PUBLIC)·정책 켜짐·만료 전일 때만 값이 있다.
   */
  public Optional<Long> findPublicTenantOfToken(String token) {
    return dsl.fetchOptional("SELECT tenant_id FROM wiki_page_share_resolve_public(?)", token)
        .map(r -> r.get(0, Long.class));
  }

  /** 워크스페이스 표시 이름(tenant 는 RLS 비대상 전역 테이블) — 외부 보기 머리에 쓴다. */
  public Optional<String> findTenantName(long tenantId) {
    return dsl.select(TENANT.NAME)
        .from(TENANT)
        .where(TENANT.ID.eq(tenantId))
        .fetchOptional(TENANT.NAME);
  }

  /** 링크를 열었다 — 조회 수 +1 과 마지막 열람 시각. 사람별 중복 제거는 없다(열기 요청마다 센다). */
  public void recordView(long shareId) {
    dsl.update(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.VIEW_COUNT, WIKI_PAGE_SHARE.VIEW_COUNT.plus(1))
        .set(WIKI_PAGE_SHARE.LAST_ACCESSED_AT, DSL.currentOffsetDateTime())
        .where(WIKI_PAGE_SHARE.ID.eq(shareId))
        .execute();
  }

  /**
   * 링크로 볼 수 있는 페이지의 목록용 요약 — pageIds 는 호출자가 지금 트리에서 모은 범위(루트 하나 또는 서브트리). 루트의 parentId 는 범위 밖 페이지
   * id 라 null 로 가린다. 형제 순서는 position.
   */
  public List<WikiPageSummary> listSharedPages(Collection<Long> pageIds, long rootPageId) {
    return dsl.select(
            WIKI_PAGE.ID,
            WIKI_PAGE.PARENT_ID,
            WIKI_PAGE.TITLE,
            WIKI_PAGE.POSITION,
            WIKI_PAGE.AI_LAST_USED_AT)
        .from(WIKI_PAGE)
        .where(WIKI_PAGE.ID.in(pageIds))
        .orderBy(WIKI_PAGE.PARENT_ID.asc().nullsFirst(), WIKI_PAGE.POSITION.asc())
        .fetch(
            r ->
                new WikiPageSummary(
                    r.get(WIKI_PAGE.ID),
                    r.get(WIKI_PAGE.ID).equals(rootPageId) ? null : r.get(WIKI_PAGE.PARENT_ID),
                    r.get(WIKI_PAGE.TITLE),
                    r.get(WIKI_PAGE.POSITION),
                    r.get(WIKI_PAGE.AI_LAST_USED_AT),
                    null,
                    false));
  }

  /**
   * 접근 요청을 대기로 만든다. 이미 이 사람의 대기 요청이 있으면(부분 UNIQUE page_id·requester_id WHERE PENDING) 아무것도 하지 않고
   * false — 부분 인덱스는 컬럼 지정 ON CONFLICT 로 추론되지 않아 대상 없는 DO NOTHING 을 쓴다. 이미 결정된(APPROVED·DENIED) 요청은
   * 충돌하지 않으므로 다시 요청할 수 있다.
   */
  public boolean insertPendingRequest(long pageId, long requesterId) {
    return dsl.insertInto(WIKI_SHARE_ACCESS_REQUEST)
            .set(WIKI_SHARE_ACCESS_REQUEST.PAGE_ID, pageId)
            .set(WIKI_SHARE_ACCESS_REQUEST.REQUESTER_ID, requesterId)
            // 요청 시각은 실제 DB 시각(clock_timestamp) — 기본값 now() 는 트랜잭션 시작 시각이라, 공유 생성 커밋보다 먼저 시작한 트랜잭션이
            // 그 새 공유에 만든
            // 요청이 공유 생성 시각보다 앞서 「지금 공유」의 거절 판정(hasDenialSince)에서 빠진다. 공유 행을 잠근 뒤 읽었으므로 항상 공유 생성 뒤다.
            .set(
                WIKI_SHARE_ACCESS_REQUEST.CREATED_AT,
                DSL.field("clock_timestamp()", OffsetDateTime.class))
            .onConflictDoNothing()
            .execute()
        == 1;
  }

  /**
   * 이 페이지의 대기 중 접근 요청을 잠그고 읽는다 — 같은 요청을 동시에 승인·거절하는 두 요청 중 하나만 결정하게 한다. 요청자 id 를 돌려준다. 없거나 다른 페이지의
   * 요청이거나 이미 결정됐으면 빈 값.
   */
  public Optional<Long> findPendingRequesterForUpdate(long requestId, long pageId) {
    return dsl.select(WIKI_SHARE_ACCESS_REQUEST.REQUESTER_ID)
        .from(WIKI_SHARE_ACCESS_REQUEST)
        .where(WIKI_SHARE_ACCESS_REQUEST.ID.eq(requestId))
        .and(WIKI_SHARE_ACCESS_REQUEST.PAGE_ID.eq(pageId))
        .and(WIKI_SHARE_ACCESS_REQUEST.STATUS.eq("PENDING"))
        .forUpdate()
        .fetchOptional(WIKI_SHARE_ACCESS_REQUEST.REQUESTER_ID);
  }

  /**
   * 접근 요청을 결정한다(APPROVED | DENIED) — 결정한 사람과 시각을 남긴다. 시각은 앱 시계({@code WikiShareClock})로 받는다 — 거절 뒤
   * 재요청 대기({@link #hasDenialSince})를 같은 시계로 재야 테스트가 시각을 옮겨 결정적으로 볼 수 있다.
   */
  public void decideRequest(
      long requestId, String status, long decidedBy, OffsetDateTime decidedAt) {
    dsl.update(WIKI_SHARE_ACCESS_REQUEST)
        .set(WIKI_SHARE_ACCESS_REQUEST.STATUS, status)
        .set(WIKI_SHARE_ACCESS_REQUEST.DECIDED_BY, decidedBy)
        .set(WIKI_SHARE_ACCESS_REQUEST.DECIDED_AT, decidedAt)
        .where(WIKI_SHARE_ACCESS_REQUEST.ID.eq(requestId))
        .execute();
  }

  /**
   * 이 사람의 이 페이지 접근 요청이 since 뒤에 거절됐는지(결정 시각 {@code decided_at > since}, 둘 다 앱 시계) — 그 거절이 <b>지금
   * 공유</b>에 대한 것일 때만. 「지금 공유에 대한 요청」은 요청 생성 시각이 지금 공유 생성 시각 이후({@code request.created_at >=
   * share.created_at})인 요청이다 — 공유 생성은 DB {@code now()}, 요청 생성은 DB {@code clock_timestamp()} 로 찍혀 같은
   * DB 시계라, 앱 시계로 찍은 결정 시각과 비교할 때처럼 API·DB 서버 시계 차이만큼 방금 한 거절이 빠지지 않는다. 요청은 공유 행을 잠근 뒤 실제 시각으로
   * 찍으므로, 공유 생성 커밋보다 먼저 시작한 트랜잭션의 요청도 그 공유 생성 시각 이후다. 요청은 그 요청이 생길 때 있던 공유에 속한다(해제는 대기 요청을 지우고, 요청
   * 생성은 공유 행을 잠근 뒤라 해제·재공유와 엇갈리지 않는다). 그래서 해제 뒤 다시 만든 공유에는 옛 공유의 거절이 걸리지 않는다(요청 행은 공유가 아니라 페이지에 매달려
   * 해제 뒤에도 기록으로 남는다).
   */
  public boolean hasDenialSince(long pageId, long requesterId, OffsetDateTime since) {
    return dsl.fetchExists(denialSince(pageId, requesterId, since));
  }

  /** {@link #hasDenialSince} 의 조회 본체 — 403 응답 상태({@link #findRequestFlags})도 같은 규칙으로 쓴다. */
  private org.jooq.Select<?> denialSince(long pageId, long requesterId, OffsetDateTime since) {
    // 부분 인덱스 idx_wiki_share_access_request_denied(page_id, requester_id WHERE DENIED)가 이 조회를 받는다.
    return DSL.selectOne()
        .from(WIKI_SHARE_ACCESS_REQUEST)
        .join(WIKI_PAGE_SHARE)
        .on(WIKI_PAGE_SHARE.PAGE_ID.eq(WIKI_SHARE_ACCESS_REQUEST.PAGE_ID))
        .where(WIKI_SHARE_ACCESS_REQUEST.PAGE_ID.eq(pageId))
        .and(WIKI_SHARE_ACCESS_REQUEST.REQUESTER_ID.eq(requesterId))
        .and(WIKI_SHARE_ACCESS_REQUEST.STATUS.eq("DENIED"))
        .and(WIKI_SHARE_ACCESS_REQUEST.DECIDED_AT.gt(since))
        // 「지금 공유」에 대한 거절만 — 요청이 지금 공유가 생긴 뒤에 왔는지로 가린다(해제 후 다시 공유하면 옛 거절은 막지 않는다).
        // 두 시각 모두 DB 시계(공유 now(), 요청 clock_timestamp())다. 앱 시계로 찍은 결정 시각(decided_at)과 비교하면 API·DB
        // 서버 시계 차이만큼
        // 방금 한 거절이 빠진다.
        .and(WIKI_SHARE_ACCESS_REQUEST.CREATED_AT.ge(WIKI_PAGE_SHARE.CREATED_AT));
  }

  /** 이 페이지의 대기 중 접근 요청을 모두 지운다 — 공유를 해제할 때, 다시 공유해도 옛 요청이 되살아나지 않게. 결정된 요청은 기록으로 남긴다. */
  public void deletePendingRequests(long pageId) {
    dsl.deleteFrom(WIKI_SHARE_ACCESS_REQUEST)
        .where(WIKI_SHARE_ACCESS_REQUEST.PAGE_ID.eq(pageId))
        .and(WIKI_SHARE_ACCESS_REQUEST.STATUS.eq("PENDING"))
        .execute();
  }

  // ── 공유 목록·관리자 정책(WP-579 Task 5) ───────────────────────────────────

  /** 지정한 사람 수 — PEOPLE 이 아니면 지정한 사람 행이 없어 0. */
  private static final Field<Integer> PEOPLE_COUNT =
      DSL.field(
              DSL.selectCount()
                  .from(WIKI_PAGE_SHARE_MEMBER)
                  .where(WIKI_PAGE_SHARE_MEMBER.SHARE_ID.eq(WIKI_PAGE_SHARE.ID)))
          .as("people_count");

  /** 공유 목록 공통 조회 — 페이지 제목·스페이스 이름·공유한 사람을 붙인다. 정렬·조건은 호출자가. */
  private org.jooq.SelectOnConditionStep<?> selectListItems() {
    return dsl.select(
            WIKI_PAGE_SHARE.PAGE_ID,
            WIKI_PAGE.TITLE,
            WIKI_PAGE_SHARE.AUDIENCE,
            WIKI_PAGE_SHARE.PERMISSION,
            WIKI_PAGE_SHARE.INCLUDE_CHILDREN,
            PEOPLE_COUNT,
            WIKI_PAGE_SHARE.CREATED_BY,
            USER.NAME,
            WIKI_PAGE_SHARE.UPDATED_AT,
            WIKI_PAGE_SHARE.EXPIRES_AT,
            WIKI_PAGE_SHARE.LAST_ACCESSED_AT,
            WIKI_PAGE_SHARE.VIEW_COUNT,
            WIKI_PAGE_SHARE.SPACE_ID,
            WIKI_SPACE.NAME,
            WIKI_PAGE_SHARE.TOKEN)
        .from(WIKI_PAGE_SHARE)
        .join(WIKI_PAGE)
        .on(WIKI_PAGE.ID.eq(WIKI_PAGE_SHARE.PAGE_ID))
        .join(WIKI_SPACE)
        .on(WIKI_SPACE.ID.eq(WIKI_PAGE_SHARE.SPACE_ID))
        .join(USER)
        .on(USER.ID.eq(WIKI_PAGE_SHARE.CREATED_BY));
  }

  private static WikiShareListItemResponse toListItem(org.jooq.Record r) {
    return new WikiShareListItemResponse(
        r.get(WIKI_PAGE_SHARE.PAGE_ID),
        r.get(WIKI_PAGE.TITLE),
        r.get(WIKI_PAGE_SHARE.AUDIENCE),
        r.get(WIKI_PAGE_SHARE.PERMISSION),
        r.get(WIKI_PAGE_SHARE.INCLUDE_CHILDREN),
        r.get(PEOPLE_COUNT),
        new WikiSharePerson(r.get(WIKI_PAGE_SHARE.CREATED_BY), r.get(USER.NAME)),
        r.get(WIKI_PAGE_SHARE.UPDATED_AT),
        r.get(WIKI_PAGE_SHARE.EXPIRES_AT),
        r.get(WIKI_PAGE_SHARE.LAST_ACCESSED_AT),
        r.get(WIKI_PAGE_SHARE.VIEW_COUNT),
        r.get(WIKI_PAGE_SHARE.SPACE_ID),
        r.get(WIKI_SPACE.NAME),
        r.get(WIKI_PAGE_SHARE.TOKEN));
  }

  /** 스페이스에서 공유 중인 페이지(최근 변경순) — 만료된 공유도 보인다(고치거나 해제할 수 있게). */
  public List<WikiShareListItemResponse> listBySpace(long spaceId) {
    return selectListItems()
        .where(WIKI_PAGE_SHARE.SPACE_ID.eq(spaceId))
        .orderBy(WIKI_PAGE_SHARE.UPDATED_AT.desc(), WIKI_PAGE_SHARE.ID.desc())
        .fetch(WikiShareRepository::toListItem);
  }

  /**
   * 내가 만든 공유(스페이스를 가로질러, 최근 변경순). 지금도 그 스페이스의 EDITOR 이상인 것만 — 멤버에서 빠진 스페이스의 페이지 제목·토큰이 계속 보이지 않게(공유
   * 변경 권한과 같은 기준).
   */
  public List<WikiShareListItemResponse> listByCreator(long userId) {
    return selectListItems()
        .join(WIKI_SPACE_MEMBER)
        .on(
            WIKI_SPACE_MEMBER
                .SPACE_ID
                .eq(WIKI_PAGE_SHARE.SPACE_ID)
                .and(WIKI_SPACE_MEMBER.USER_ID.eq(userId))
                .and(WIKI_SPACE_MEMBER.ROLE.in("EDITOR", "OWNER")))
        .where(WIKI_PAGE_SHARE.CREATED_BY.eq(userId))
        .orderBy(WIKI_PAGE_SHARE.UPDATED_AT.desc(), WIKI_PAGE_SHARE.ID.desc())
        .fetch(WikiShareRepository::toListItem);
  }

  /** 워크스페이스 전체 공유(관리자, 최근 변경순) — limit·offset 으로 끊어 읽는다. */
  public List<WikiShareListItemResponse> listAll(int limit, int offset) {
    return selectListItems()
        .orderBy(WIKI_PAGE_SHARE.UPDATED_AT.desc(), WIKI_PAGE_SHARE.ID.desc())
        .limit(limit)
        .offset(offset)
        .fetch(WikiShareRepository::toListItem);
  }

  /** 외부(PUBLIC) 공유를 모두 잠그고 읽는다 — 정책을 끌 때 지울 대상. 동시에 바뀌는 공유와 엇갈리지 않게 행을 잠근다. */
  public List<ShareDetail> findPublicForUpdate() {
    // page_id 순으로 잠근다 — 관리자 일괄 해제(페이지 id 오름차순으로 잠금)와 같은 순서라 겹쳐도 교착하지 않는다.
    return lockInPageOrder(WIKI_PAGE_SHARE.AUDIENCE.eq("PUBLIC"));
  }

  /**
   * 이 사람이 만든 공유를 잠그고 읽는다 — 공유한 사람이 편집 권한을 잃거나(spaceId 지정) 워크스페이스에서 정지될 때(spaceId null = 모든 스페이스) 지울
   * 대상. 정책 끔·관리자 일괄 해제와 같은 page_id 순으로 잠가 겹쳐도 교착하지 않는다.
   */
  public List<ShareDetail> findByCreatorForUpdate(long userId, Long spaceId) {
    Condition where = WIKI_PAGE_SHARE.CREATED_BY.eq(userId);
    if (spaceId != null) {
      where = where.and(WIKI_PAGE_SHARE.SPACE_ID.eq(spaceId));
    }
    return lockInPageOrder(where);
  }

  /** 이 페이지들의 공유를 잠그지 않고 읽는다 — 스페이스 이동 미리보기(WP-988). page_id 순. */
  public List<ShareDetail> findByPages(Collection<Long> pageIds) {
    if (pageIds.isEmpty()) {
      return List.of();
    }
    return selectDetail(WIKI_PAGE_SHARE.PAGE_ID.in(pageIds))
        .orderBy(WIKI_PAGE_SHARE.PAGE_ID.asc())
        .fetch(WikiShareRepository::toDetail);
  }

  /** 이 페이지들의 공유가 속한 스페이스를 바꾼다(WP-988 — 페이지가 다른 스페이스로 옮겨 갈 때 공유 행도 함께 따라간다). 토큰·지정 대상은 그대로다. */
  public void updateSpace(Collection<Long> pageIds, long spaceId) {
    if (pageIds.isEmpty()) {
      return;
    }
    dsl.update(WIKI_PAGE_SHARE)
        .set(WIKI_PAGE_SHARE.SPACE_ID, spaceId)
        .where(WIKI_PAGE_SHARE.PAGE_ID.in(pageIds))
        .execute();
  }

  /** 이 페이지들의 공유를 잠그고 읽는다 — 페이지 삭제로 함께 사라질 공유(감사 대상). 다른 해제 경로와 같은 page_id 순. */
  public List<ShareDetail> findByPagesForUpdate(Collection<Long> pageIds) {
    if (pageIds.isEmpty()) {
      return List.of();
    }
    return lockInPageOrder(WIKI_PAGE_SHARE.PAGE_ID.in(pageIds));
  }

  /** 스페이스의 공유를 모두 잠그고 읽는다 — 스페이스 삭제로 함께 사라질 공유(감사 대상). */
  public List<ShareDetail> findBySpaceForUpdate(long spaceId) {
    return lockInPageOrder(WIKI_PAGE_SHARE.SPACE_ID.eq(spaceId));
  }

  /** 조건에 맞는 공유를 page_id 순으로 잠가 읽는다 — 해제 경로가 모두 같은 순서로 잠가 겹쳐도 교착하지 않게. */
  private List<ShareDetail> lockInPageOrder(Condition where) {
    return selectDetail(where)
        .orderBy(WIKI_PAGE_SHARE.PAGE_ID.asc())
        .forUpdate()
        .of(WIKI_PAGE_SHARE)
        .fetch(WikiShareRepository::toDetail);
  }

  /**
   * 이 스페이스에 하위 포함 공유가 하나라도 있는지(만료 무관) — 페이지 이동이 공유 범위를 비교할 필요가 있는지 먼저 본다. 만료 여부를 보지 않는 것은 {@link
   * #findIncludingChildrenRoots} 와 같다.
   */
  public boolean existsIncludingChildren(long spaceId) {
    return dsl.fetchExists(
        WIKI_PAGE_SHARE,
        WIKI_PAGE_SHARE.SPACE_ID.eq(spaceId).and(WIKI_PAGE_SHARE.INCLUDE_CHILDREN.isTrue()));
  }

  /**
   * 이 페이지들 중 하위 포함 공유가 걸린 페이지(공유 루트) id — 페이지 이동 전후의 조상 체인에 넘겨, 옮긴 페이지를 덮던·덮게 될 공유를 찾는다. 만료 여부는 보지
   * 않는다(이동 기록은 공유 창의 이력이라 만료된 공유에도 남긴다).
   */
  public List<Long> findIncludingChildrenRoots(Collection<Long> pageIds) {
    if (pageIds.isEmpty()) {
      return List.of();
    }
    return dsl.select(WIKI_PAGE_SHARE.PAGE_ID)
        .from(WIKI_PAGE_SHARE)
        .where(WIKI_PAGE_SHARE.PAGE_ID.in(pageIds))
        .and(WIKI_PAGE_SHARE.INCLUDE_CHILDREN.isTrue())
        .orderBy(WIKI_PAGE_SHARE.PAGE_ID.asc())
        .fetch(WIKI_PAGE_SHARE.PAGE_ID);
  }

  /** 외부 공유 허용을 읽을 때 테넌트 행에 거는 잠금. */
  public enum PolicyLock {
    /** 잠그지 않는다 — 공유 창의 「외부」 선택지·관리자 화면 조회. */
    NONE,
    /**
     * 공유 잠금 — 외부 공개로 만들거나 바꾸는 저장. 관리자가 스위치를 끄는 트랜잭션은 같은 행을 배타 잠금하므로, 끄는 중이면 이 읽기는 그 커밋까지 기다렸다가 꺼진
     * 값을 보고 거절된다 — 정책을 끈 직후 PUBLIC 공유가 새로 남아 다시 켰을 때 되살아나는 틈을 막는다.
     */
    SHARE,
    /** 배타 잠금 — 관리자 스위치 저장(같은 스위치를 동시에 바꾸는 두 요청이 엇갈리지 않게, 읽기 잠금 후 승격으로 인한 교착도 피한다). */
    UPDATE
  }

  /** 테넌트(RLS 비대상 전역 tenant 행)가 외부 공유를 허용하는지 — lock 에 따라 행을 잠그고 읽는다. */
  public boolean isExternalShareEnabled(long tenantId, PolicyLock lock) {
    var select =
        dsl.select(TENANT.WIKI_EXTERNAL_SHARE_ENABLED).from(TENANT).where(TENANT.ID.eq(tenantId));
    var locked =
        switch (lock) {
          case NONE -> select;
          case SHARE -> select.forShare();
          case UPDATE -> select.forUpdate();
        };
    return Boolean.TRUE.equals(locked.fetchOne(TENANT.WIKI_EXTERNAL_SHARE_ENABLED));
  }

  /** 외부 공유 허용을 바꾼다(관리자 스위치). tenant 는 RLS 비대상 전역 테이블 — 호출자가 지금 테넌트 id 를 넘긴다. */
  public void setExternalShareEnabled(long tenantId, boolean enabled) {
    dsl.update(TENANT)
        .set(TENANT.WIKI_EXTERNAL_SHARE_ENABLED, enabled)
        .where(TENANT.ID.eq(tenantId))
        .execute();
  }
}
