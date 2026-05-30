package com.workplace.home.repository;

import static com.workplace.jooq.Tables.HOME_SESSION;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** home_session 접근. */
@Repository
@RequiredArgsConstructor
public class HomeSessionRepository {
  private final DSLContext dsl;

  /** 새 세션 생성 후 생성된 UUID 반환. */
  public UUID insert(long userId) {
    return dsl.insertInto(HOME_SESSION)
        .set(HOME_SESSION.USER_ID, userId)
        .returning(HOME_SESSION.ID)
        .fetchOne()
        .getId();
  }

  /** 세션 단건 조회. */
  public Optional<Row> findById(UUID id) {
    return dsl.select(
            HOME_SESSION.ID,
            HOME_SESSION.USER_ID,
            HOME_SESSION.TITLE,
            HOME_SESSION.CREATED_AT,
            HOME_SESSION.LAST_MESSAGE_AT)
        .from(HOME_SESSION)
        .where(HOME_SESSION.ID.eq(id))
        .fetchOptional(
            r ->
                new Row(
                    r.get(HOME_SESSION.ID),
                    r.get(HOME_SESSION.USER_ID),
                    r.get(HOME_SESSION.TITLE),
                    r.get(HOME_SESSION.CREATED_AT).toInstant(),
                    r.get(HOME_SESSION.LAST_MESSAGE_AT).toInstant()));
  }

  /** 사용자의 세션 목록을 last_message_at 최신순으로 반환. cursor 키셋 페이지네이션. widgetCount = 세션 내 위젯 총합. */
  public List<Summary> listByUser(long userId, CursorCodec.Decoded cursor, int limit) {
    var widgetCount =
        DSL.field(
            "(select coalesce(sum(jsonb_array_length(widgets)),0) from home_message"
                + " where session_id = home_session.id and widgets is not null)",
            Integer.class);

    Condition where = HOME_SESSION.USER_ID.eq(userId);
    if (cursor != null) {
      where =
          where.and(
              DSL.row(HOME_SESSION.LAST_MESSAGE_AT, HOME_SESSION.ID)
                  .lessThan(
                      OffsetDateTime.ofInstant(cursor.createdAt(), ZoneOffset.UTC),
                      UUID.fromString(cursor.id())));
    }
    return dsl.select(
            HOME_SESSION.ID, HOME_SESSION.TITLE, HOME_SESSION.LAST_MESSAGE_AT, widgetCount)
        .from(HOME_SESSION)
        .where(where)
        .orderBy(HOME_SESSION.LAST_MESSAGE_AT.desc(), HOME_SESSION.ID.desc())
        .limit(limit)
        .fetch(
            r ->
                new Summary(
                    r.get(HOME_SESSION.ID),
                    r.get(HOME_SESSION.TITLE),
                    r.get(HOME_SESSION.LAST_MESSAGE_AT).toInstant(),
                    r.get(widgetCount)));
  }

  /** 메시지 추가 시 호출 — last_message_at/updated_at 갱신, title 이 비어 있으면 설정. */
  public void touch(UUID id, String titleIfNull) {
    var step =
        dsl.update(HOME_SESSION)
            .set(HOME_SESSION.LAST_MESSAGE_AT, OffsetDateTime.now())
            .set(HOME_SESSION.UPDATED_AT, OffsetDateTime.now());
    if (titleIfNull != null) {
      step = step.set(HOME_SESSION.TITLE, DSL.coalesce(HOME_SESSION.TITLE, DSL.val(titleIfNull)));
    }
    step.where(HOME_SESSION.ID.eq(id)).execute();
  }

  /** 세션 삭제 (cascade 로 메시지도 삭제됨). 삭제된 row 수 반환. */
  public int delete(UUID id) {
    return dsl.deleteFrom(HOME_SESSION).where(HOME_SESSION.ID.eq(id)).execute();
  }

  /** 세션 단건 row. */
  public record Row(
      UUID id,
      long userId,
      String title,
      java.time.Instant createdAt,
      java.time.Instant lastMessageAt) {}

  /** 목록 조회용 요약 row. */
  public record Summary(UUID id, String title, java.time.Instant lastMessageAt, int widgetCount) {}
}
