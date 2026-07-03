package com.workplace.home.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_WATCHER;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;

import com.workplace.home.dto.ActivityEntryResponse;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** 내 담당/워치 이슈의 issue_history 교차 조회(읽기 전용). */
@Repository
@RequiredArgsConstructor
public class HomeActivityRepository {
  private final DSLContext dsl;

  private ActivityEntryResponse map(Record r) {
    OffsetDateTime created = r.get(ISSUE_HISTORY.CREATED_AT);
    return new ActivityEntryResponse(
        r.get(ISSUE_HISTORY.ID),
        r.get(ISSUE_HISTORY.ISSUE_ID),
        r.get(PROJECT.KEY),
        r.get(ISSUE.NUMBER),
        r.get(ISSUE.TITLE),
        r.get(ISSUE_HISTORY.ACTOR_ID),
        r.get(USER.NAME),
        r.get(USER.KIND),
        r.get(ISSUE_HISTORY.EVENT_TYPE),
        created != null ? created.toInstant() : null);
  }

  /**
   * userId 가 배정자이거나 워처인 이슈들의 history 를 최신순으로. actorKind 가 있으면 행위자 kind 필터. cursor 가 있으면
   * (created_at, id) 키셋으로 그 이전 페이지.
   */
  public List<ActivityEntryResponse> findRecent(
      Long userId, String actorKind, CursorCodec.Decoded cursor, int limit) {
    var myIssues =
        DSL.selectDistinct(ISSUE_ASSIGNEE.ISSUE_ID)
            .from(ISSUE_ASSIGNEE)
            .where(ISSUE_ASSIGNEE.USER_ID.eq(userId))
            .union(
                DSL.select(ISSUE_WATCHER.ISSUE_ID)
                    .from(ISSUE_WATCHER)
                    .where(ISSUE_WATCHER.USER_ID.eq(userId)));

    // 이슈가 소프트삭제되면(#622, #618 알림·#621 채팅과 동일 패턴) history 행은 남지만 죽은 참조이므로 제외한다.
    Condition where = ISSUE_HISTORY.ISSUE_ID.in(myIssues).and(ISSUE.DELETED_AT.isNull());
    if (actorKind != null && !actorKind.isBlank()) {
      where = where.and(USER.KIND.eq(actorKind));
    }
    // 커서 id 는 세션(UUID)과 공용 String 이라 비숫자일 수 있다. 파싱 실패 시 커서를 무시(첫 페이지)하여 500 방어.
    Long cursorId = null;
    if (cursor != null) {
      try {
        cursorId = Long.parseLong(cursor.id());
      } catch (NumberFormatException e) {
        cursorId = null;
      }
    }
    if (cursor != null && cursorId != null) {
      where =
          where.and(
              DSL.row(ISSUE_HISTORY.CREATED_AT, ISSUE_HISTORY.ID)
                  .lessThan(
                      OffsetDateTime.ofInstant(cursor.createdAt(), ZoneOffset.UTC), cursorId));
    }

    return dsl.select(
            ISSUE_HISTORY.ID,
            ISSUE_HISTORY.ISSUE_ID,
            PROJECT.KEY,
            ISSUE.NUMBER,
            ISSUE.TITLE,
            ISSUE_HISTORY.ACTOR_ID,
            USER.NAME,
            USER.KIND,
            ISSUE_HISTORY.EVENT_TYPE,
            ISSUE_HISTORY.CREATED_AT)
        .from(ISSUE_HISTORY)
        .join(ISSUE)
        .on(ISSUE.ID.eq(ISSUE_HISTORY.ISSUE_ID))
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .join(USER)
        .on(USER.ID.eq(ISSUE_HISTORY.ACTOR_ID))
        .where(where)
        .orderBy(ISSUE_HISTORY.CREATED_AT.desc(), ISSUE_HISTORY.ID.desc())
        .limit(limit)
        .fetch(this::map);
  }
}
