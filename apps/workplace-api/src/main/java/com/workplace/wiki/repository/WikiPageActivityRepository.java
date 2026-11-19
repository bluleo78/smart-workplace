package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_ACTIVITY;

import com.workplace.wiki.service.WikiPageAction;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 「최근」 기록(wiki_page_activity, WP-1764) 접근. 한 사람이 어떤 페이지를 열거나 고친 기록을 한 사람·한 페이지 한 행으로 남기고, 내 목록을
 * 최근 순으로 읽는다. 모든 메서드는 워크스페이스 RLS 컨텍스트(TenantContext) 안에서 부른다(FORCE RLS).
 * 드라이브(DriveFileActivityRepository)와 같은 모양이다.
 */
@Repository
@RequiredArgsConstructor
public class WikiPageActivityRepository {

  /** 사람마다 남기는 기록 수 상한 — 새 행을 넣을 때만 오래된 것부터 이만큼 넘는 줄을 지운다. */
  public static final int PER_USER_CAP = 500;

  /** 같은 페이지 다시 열기·다시 고치기를 쓰지 않는 창(초) — 화면 재조회·포커스 복귀·잦은 자동 저장이 행을 계속 건드리지 않게 한다. */
  public static final int OPEN_DEDUPE_SECONDS = 60;

  /**
   * upsert 한 문장. 새 행이거나 갱신이면 행을 돌려주고, 1분 안 OPEN 이라 건너뛰면(WHERE 불일치) 아무 행도 돌려주지 않는다. {@code xmax = 0}
   * 은 이번 문장이 INSERT 했음을 뜻한다 — 새 행일 때만 상한 정리를 한다. 기존 행의 last_at 이 60초 안일 때 (1) 새 행동이 OPEN 이면 기존 행동이
   * 무엇이든(EDIT 를 OPEN 으로 내리지 않는다) (2) 새 행동이 EDIT 이고 기존도 EDIT 면 건너뛴다. OPEN 뒤의 EDIT 는 늘 EDIT 로 갱신한다.
   */
  private static final String UPSERT_SQL =
      "INSERT INTO wiki_page_activity (user_id, wiki_page_id, last_action) VALUES (?, ?, ?) "
          + "ON CONFLICT (user_id, wiki_page_id) DO UPDATE "
          + "  SET last_action = EXCLUDED.last_action, last_at = now() "
          + "  WHERE NOT (wiki_page_activity.last_at > now() - make_interval(secs => ?) "
          + "             AND (EXCLUDED.last_action = 'OPEN' "
          + "                  OR wiki_page_activity.last_action = 'EDIT')) "
          + "RETURNING (xmax = 0) AS inserted";

  /** 사람 한 명의 기록 중 최근 PER_USER_CAP 개 밖(초과분)만 골라 지운다. */
  private static final String TRIM_SQL =
      "DELETE FROM wiki_page_activity WHERE id IN ("
          + "  SELECT id FROM wiki_page_activity WHERE user_id = ? "
          + "  ORDER BY last_at DESC, id DESC OFFSET ?)";

  private final DSLContext dsl;

  /**
   * 행동을 기록한다(upsert). 호출한 트랜잭션과 따로 커밋한다(REQUIRES_NEW). 이 메서드의 예외(FK 위반 등)는 그대로 전파되므로 호출하는 쪽
   * (WikiPageActivityRecorder)이 잡아 로그만 남겨야 한다. 새 트랜잭션에도 테넌트 GUC 가 주입돼 RLS 가 유지된다.
   */
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void upsert(long userId, long wikiPageId, WikiPageAction action) {
    var row = dsl.fetchOptional(UPSERT_SQL, userId, wikiPageId, action.name(), OPEN_DEDUPE_SECONDS);
    boolean inserted = row.map(r -> Boolean.TRUE.equals(r.get(0, Boolean.class))).orElse(false);
    // 갱신만으로는 행이 늘지 않으니 새 행일 때만 정리한다.
    if (inserted) {
      dsl.execute(TRIM_SQL, userId, PER_USER_CAP);
    }
  }

  /** 목록 다음 쪽의 시작점 — 직전에 읽은 마지막 줄의 (last_at, id). 같은 시각 줄들도 id 로 갈라 빠지거나 겹치지 않는다. */
  public record Cursor(OffsetDateTime lastAt, long id) {}

  /** 목록 한 줄(권한 거르기 전). pageId 로 서비스가 읽기 권한·조상 제목을 채운다. */
  public record ActivityRow(
      long id, long pageId, WikiPageAction lastAction, OffsetDateTime lastAt) {}

  /**
   * 내 기록을 최근 순((last_at, id) 내림차순)으로 limit 줄. wiki_page 를 join 해 지워진 페이지 행을 SQL 에서 뺀다(페이지 삭제는
   * CASCADE 라 보통 남지 않지만 방어). 읽기 권한은 서비스가 WikiPageReadAccess 로 거른다. after 가 있으면 그 뒤부터.
   */
  public List<ActivityRow> listForUser(long userId, Cursor after, int limit) {
    Condition where = WIKI_PAGE_ACTIVITY.USER_ID.eq(userId);
    if (after != null) {
      where =
          where.and(
              DSL.row(WIKI_PAGE_ACTIVITY.LAST_AT, WIKI_PAGE_ACTIVITY.ID)
                  .lt(DSL.row(after.lastAt(), after.id())));
    }
    return dsl.select(
            WIKI_PAGE_ACTIVITY.ID, WIKI_PAGE_ACTIVITY.WIKI_PAGE_ID,
            WIKI_PAGE_ACTIVITY.LAST_ACTION, WIKI_PAGE_ACTIVITY.LAST_AT)
        .from(WIKI_PAGE_ACTIVITY)
        .join(WIKI_PAGE)
        .on(WIKI_PAGE.ID.eq(WIKI_PAGE_ACTIVITY.WIKI_PAGE_ID))
        .where(where)
        .orderBy(WIKI_PAGE_ACTIVITY.LAST_AT.desc(), WIKI_PAGE_ACTIVITY.ID.desc())
        .limit(limit)
        .fetch(
            r ->
                new ActivityRow(
                    r.get(WIKI_PAGE_ACTIVITY.ID),
                    r.get(WIKI_PAGE_ACTIVITY.WIKI_PAGE_ID),
                    WikiPageAction.valueOf(r.get(WIKI_PAGE_ACTIVITY.LAST_ACTION)),
                    r.get(WIKI_PAGE_ACTIVITY.LAST_AT)));
  }
}
