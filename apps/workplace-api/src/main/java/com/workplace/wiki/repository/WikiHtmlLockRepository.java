package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_HTML_DRAFT;
import static com.workplace.jooq.Tables.WIKI_HTML_EDIT_LOCK;
import static com.workplace.jooq.Tables.WIKI_PAGE;

import com.workplace.wiki.dto.WikiPageKind;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 「HTML 문서」 편집 잠금(wiki_html_edit_lock)과 임시 저장본(wiki_html_draft) 접근(WP-1308).
 *
 * <p>잠금은 페이지당 한 줄이고, 편집 세션 표지(token)를 함께 둔다 — 편집 중 신호·취소·저장은 token 이 맞아야 그 세션의 잠금으로 본다. 입력이 없어
 * 풀린(만료) 잠금도 줄은 남는다 — 판정은 읽는 쪽이 cutoff(지금 − 10분)와 비교해 한다. 다음 잠금은 같은 줄을 조건부로 덮어쓴다({@link
 * #tryAcquire}).
 */
@Repository
@RequiredArgsConstructor
public class WikiHtmlLockRepository {
  private final DSLContext dsl;

  /** 잠금 줄(만료 여부는 호출자가 판정). token 은 편집 세션 표지 — 응답·알림에 싣지 않는다. */
  public record LockRow(
      UUID token,
      long userId,
      String userName,
      OffsetDateTime acquiredAt,
      OffsetDateTime lastActiveAt) {}

  /** 임시 저장본 줄. */
  public record DraftRow(String html, int baseVersion, OffsetDateTime updatedAt) {}

  /** 잠금 판정에 필요한 페이지 정보 — 원본(최대 5MB)은 읽지 않는다. */
  public record PageBasis(long spaceId, WikiPageKind kind, int version) {}

  /** 페이지의 스페이스·종류·version. 없거나 RLS 로 안 보이면 empty. */
  public Optional<PageBasis> findPageBasis(long pageId) {
    return dsl.select(WIKI_PAGE.SPACE_ID, WIKI_PAGE.KIND, WIKI_PAGE.VERSION)
        .from(WIKI_PAGE)
        .where(WIKI_PAGE.ID.eq(pageId))
        .fetchOptional(r -> new PageBasis(r.value1(), WikiPageKind.of(r.value2()), r.value3()));
  }

  /** 페이지의 잠금 줄(쥔 사람 이름 포함). 만료됐어도 돌려준다. */
  public Optional<LockRow> find(long pageId) {
    return dsl.select(
            WIKI_HTML_EDIT_LOCK.TOKEN,
            WIKI_HTML_EDIT_LOCK.USER_ID,
            USER.NAME,
            WIKI_HTML_EDIT_LOCK.ACQUIRED_AT,
            WIKI_HTML_EDIT_LOCK.LAST_ACTIVE_AT)
        .from(WIKI_HTML_EDIT_LOCK)
        .join(USER)
        .on(USER.ID.eq(WIKI_HTML_EDIT_LOCK.USER_ID))
        .where(WIKI_HTML_EDIT_LOCK.PAGE_ID.eq(pageId))
        .fetchOptional(
            r -> new LockRow(r.value1(), r.value2(), r.value3(), r.value4(), r.value5()));
  }

  /**
   * 새 편집 세션(token)으로 잠금을 얻는다 — 잠금이 없거나 만료됐거나 같은 사람의 잠금이면(다른 창에서 다시 「편집」) 덮어쓴다. 한 문장의 조건부 upsert 라
   * 동시에 둘이 얻으려 해도 하나만 이긴다(PostgreSQL 이 충돌 줄을 잠그고 최신 값으로 WHERE 를 다시 본다). 남이 살아 있는 잠금을 쥐고 있으면 아무것도
   * 바꾸지 않는다.
   *
   * <p>같은 사람이 다시 얻어도 token 이 바뀌므로 먼저 연 창의 편집 중 신호·저장은 더는 그 세션의 것이 아니다(그 창은 편집을 끝낸다).
   *
   * @param cutoff 이보다 오래전에 마지막으로 입력한 잠금은 풀린 것으로 본다
   * @return 잠금을 쥐게 됐으면 true
   */
  public boolean tryAcquire(
      long pageId, long userId, UUID token, OffsetDateTime now, OffsetDateTime cutoff) {
    var lock = WIKI_HTML_EDIT_LOCK;
    return dsl.insertInto(lock)
            .set(lock.PAGE_ID, pageId)
            .set(lock.USER_ID, userId)
            .set(lock.TOKEN, token)
            .set(lock.ACQUIRED_AT, now)
            .set(lock.LAST_ACTIVE_AT, now)
            .onConflict(lock.PAGE_ID)
            .doUpdate()
            .set(lock.USER_ID, userId)
            .set(lock.TOKEN, token)
            .set(lock.ACQUIRED_AT, now)
            .set(lock.LAST_ACTIVE_AT, now)
            .where(lock.USER_ID.eq(userId).or(lock.LAST_ACTIVE_AT.lt(cutoff)))
            .execute()
        > 0;
  }

  /**
   * 편집 중 신호 — 그 세션(token)의 살아 있는 잠금이면 마지막 입력 시각을 새로 한다. 세션이 다르거나(남·다른 창이 가져감) 줄이 없거나 만료됐으면 아무것도 바꾸지
   * 않는다(잠금을 다시 쥐는 것은 「편집」뿐이다).
   *
   * @return 이어 갔으면 true
   */
  public boolean touch(long pageId, UUID token, OffsetDateTime now, OffsetDateTime cutoff) {
    return dsl.update(WIKI_HTML_EDIT_LOCK)
            .set(WIKI_HTML_EDIT_LOCK.LAST_ACTIVE_AT, now)
            .where(WIKI_HTML_EDIT_LOCK.PAGE_ID.eq(pageId))
            .and(WIKI_HTML_EDIT_LOCK.TOKEN.eq(token))
            .and(WIKI_HTML_EDIT_LOCK.LAST_ACTIVE_AT.ge(cutoff))
            .execute()
        > 0;
  }

  /** 그 세션(token)의 잠금을 푼다(저장·취소·편집 끝내기). 지운 줄이 있으면 true. */
  public boolean release(long pageId, UUID token) {
    return dsl.deleteFrom(WIKI_HTML_EDIT_LOCK)
            .where(WIKI_HTML_EDIT_LOCK.PAGE_ID.eq(pageId))
            .and(WIKI_HTML_EDIT_LOCK.TOKEN.eq(token))
            .execute()
        > 0;
  }

  /** 누구의 잠금이든 푼다(강제 풀기). 지운 줄이 있으면 true. */
  public boolean releaseAny(long pageId) {
    return dsl.deleteFrom(WIKI_HTML_EDIT_LOCK)
            .where(WIKI_HTML_EDIT_LOCK.PAGE_ID.eq(pageId))
            .execute()
        > 0;
  }

  /**
   * 원본을 써도 되는지의 조건(원본 UPDATE 의 WHERE 에 넣는다) — 이 페이지에 token 과 다른 세션의 살아 있는 잠금이 없다. token 이 null
   * 이면(MCP·AI·되돌리기· 편집을 거치지 않은 다시 올리기) 살아 있는 잠금이 하나라도 있으면 거짓이다. 확인과 쓰기가 한 문장이라 그 사이에 끼어든 잠금을 놓치지
   * 않는다.
   */
  public static Condition noOtherLiveLock(Field<Long> pageId, UUID token, OffsetDateTime cutoff) {
    var lock = WIKI_HTML_EDIT_LOCK;
    Condition other = lock.LAST_ACTIVE_AT.ge(cutoff);
    if (token != null) {
      other = other.and(lock.TOKEN.ne(token));
    }
    return DSL.notExists(DSL.selectOne().from(lock).where(lock.PAGE_ID.eq(pageId)).and(other));
  }

  /** 임시 저장본을 남긴다(페이지×사람 한 줄 — 있으면 바꾼다). */
  public void upsertDraft(
      long pageId, long userId, String html, int baseVersion, OffsetDateTime now) {
    var d = WIKI_HTML_DRAFT;
    dsl.insertInto(d)
        .set(d.PAGE_ID, pageId)
        .set(d.USER_ID, userId)
        .set(d.HTML_SOURCE, html)
        .set(d.BASE_VERSION, baseVersion)
        .set(d.UPDATED_AT, now)
        .onConflict(d.PAGE_ID, d.USER_ID)
        .doUpdate()
        .set(d.HTML_SOURCE, html)
        .set(d.BASE_VERSION, baseVersion)
        .set(d.UPDATED_AT, now)
        .execute();
  }

  /** 내 임시 저장본. */
  public Optional<DraftRow> findDraft(long pageId, long userId) {
    return dsl.select(
            WIKI_HTML_DRAFT.HTML_SOURCE, WIKI_HTML_DRAFT.BASE_VERSION, WIKI_HTML_DRAFT.UPDATED_AT)
        .from(WIKI_HTML_DRAFT)
        .where(WIKI_HTML_DRAFT.PAGE_ID.eq(pageId))
        .and(WIKI_HTML_DRAFT.USER_ID.eq(userId))
        .fetchOptional(r -> new DraftRow(r.value1(), r.value2(), r.value3()));
  }

  /** 내 임시 저장본을 지운다(저장·취소). */
  public void deleteDraft(long pageId, long userId) {
    dsl.deleteFrom(WIKI_HTML_DRAFT)
        .where(WIKI_HTML_DRAFT.PAGE_ID.eq(pageId))
        .and(WIKI_HTML_DRAFT.USER_ID.eq(userId))
        .execute();
  }
}
