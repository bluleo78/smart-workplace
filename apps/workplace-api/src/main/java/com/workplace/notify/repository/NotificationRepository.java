package com.workplace.notify.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;

import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.dto.NotificationType;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Query;
import org.springframework.stereotype.Repository;

/** notification jOOQ 리포지토리. 모든 조회/변경은 recipientId 스코프로 격리한다. */
@Repository
@RequiredArgsConstructor
public class NotificationRepository {

  private final DSLContext dsl;

  /** 수신자별 1행씩 batch insert. created_at 은 DB default, read_at 은 null(안읽음). */
  public void insertBatch(
      List<Long> recipientIds, NotificationType type, Long actorId, long issueId, Long commentId) {
    List<Query> rows =
        recipientIds.stream()
            .map(
                rid ->
                    (Query)
                        dsl.insertInto(NOTIFICATION)
                            .set(NOTIFICATION.RECIPIENT_ID, rid)
                            .set(NOTIFICATION.ACTOR_ID, actorId)
                            .set(NOTIFICATION.TYPE, type.name())
                            .set(NOTIFICATION.ISSUE_ID, issueId)
                            .set(NOTIFICATION.COMMENT_ID, commentId))
            .toList();
    dsl.batch(rows).execute();
  }

  /** 최신순 알림 — issue·project·user(actor, LEFT) 조인으로 표시 필드 합성. */
  public List<NotificationResponse> listRecent(long recipientId, int limit) {
    return dsl.select(
            NOTIFICATION.ID,
            NOTIFICATION.TYPE,
            NOTIFICATION.ACTOR_ID,
            USER.NAME,
            USER.KIND,
            NOTIFICATION.ISSUE_ID,
            PROJECT.KEY,
            ISSUE.NUMBER,
            ISSUE.TITLE,
            NOTIFICATION.COMMENT_ID,
            NOTIFICATION.READ_AT,
            NOTIFICATION.CREATED_AT)
        .from(NOTIFICATION)
        .join(ISSUE)
        .on(ISSUE.ID.eq(NOTIFICATION.ISSUE_ID))
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .leftJoin(USER)
        .on(USER.ID.eq(NOTIFICATION.ACTOR_ID))
        .where(NOTIFICATION.RECIPIENT_ID.eq(recipientId))
        .orderBy(NOTIFICATION.CREATED_AT.desc(), NOTIFICATION.ID.desc())
        .limit(limit)
        .fetch(
            r -> {
              OffsetDateTime created = r.get(NOTIFICATION.CREATED_AT);
              return new NotificationResponse(
                  r.get(NOTIFICATION.ID),
                  r.get(NOTIFICATION.TYPE),
                  r.get(NOTIFICATION.ACTOR_ID),
                  r.get(USER.NAME),
                  r.get(USER.KIND),
                  r.get(NOTIFICATION.ISSUE_ID),
                  r.get(PROJECT.KEY),
                  r.get(ISSUE.NUMBER),
                  r.get(ISSUE.TITLE),
                  r.get(NOTIFICATION.COMMENT_ID),
                  r.get(NOTIFICATION.READ_AT) != null,
                  created == null ? null : created.toInstant());
            });
  }

  /** 안읽음 수. */
  public long countUnread(long recipientId) {
    return dsl.fetchCount(
        dsl.selectOne()
            .from(NOTIFICATION)
            .where(NOTIFICATION.RECIPIENT_ID.eq(recipientId).and(NOTIFICATION.READ_AT.isNull())));
  }

  /** 단건 읽음 — recipient 스코프 + 이미 읽은 건 제외. 영향 행 수 반환(타인 id 면 0). */
  public int markRead(long recipientId, long id) {
    return dsl.update(NOTIFICATION)
        .set(NOTIFICATION.READ_AT, OffsetDateTime.now())
        .where(
            NOTIFICATION
                .ID
                .eq(id)
                .and(NOTIFICATION.RECIPIENT_ID.eq(recipientId))
                .and(NOTIFICATION.READ_AT.isNull()))
        .execute();
  }

  /** 본인 안읽음 전체 읽음. 영향 행 수 반환. */
  public int markAllRead(long recipientId) {
    return dsl.update(NOTIFICATION)
        .set(NOTIFICATION.READ_AT, OffsetDateTime.now())
        .where(NOTIFICATION.RECIPIENT_ID.eq(recipientId).and(NOTIFICATION.READ_AT.isNull()))
        .execute();
  }
}
