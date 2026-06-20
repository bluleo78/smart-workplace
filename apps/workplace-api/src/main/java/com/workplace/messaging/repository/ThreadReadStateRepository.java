package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.THREAD_READ_STATE;
import static com.workplace.jooq.Tables.USER;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** 스레드별 읽음 watermark + 팔로우 레지스트리 접근. 행 존재 = 팔로우. */
@Repository
@RequiredArgsConstructor
public class ThreadReadStateRepository {

  private final DSLContext dsl;

  /** 루트 작성자·멘션 대상 팔로우 보장: 행 없으면 watermark NULL 로 생성, 있으면 보존(읽음 되돌리지 않음). */
  public void followIfAbsent(long rootId, long userId) {
    dsl.insertInto(THREAD_READ_STATE)
        .set(THREAD_READ_STATE.THREAD_ROOT_ID, rootId)
        .set(THREAD_READ_STATE.USER_ID, userId)
        .onConflict(THREAD_READ_STATE.THREAD_ROOT_ID, THREAD_READ_STATE.USER_ID)
        .doNothing()
        .execute();
  }

  /** 본인 답글/패널 열기: 팔로우 + watermark 를 lastReadReplyId 로 설정(upsert). */
  public void markRead(long rootId, long userId, long lastReadReplyId) {
    dsl.insertInto(THREAD_READ_STATE)
        .set(THREAD_READ_STATE.THREAD_ROOT_ID, rootId)
        .set(THREAD_READ_STATE.USER_ID, userId)
        .set(THREAD_READ_STATE.LAST_READ_REPLY_ID, lastReadReplyId)
        .onConflict(THREAD_READ_STATE.THREAD_ROOT_ID, THREAD_READ_STATE.USER_ID)
        .doUpdate()
        .set(THREAD_READ_STATE.LAST_READ_REPLY_ID, lastReadReplyId)
        .execute();
  }

  /** rootIds 중 userId 가 팔로우하는 것. */
  public Set<Long> followedRoots(List<Long> rootIds, long userId) {
    if (rootIds.isEmpty()) return Set.of();
    return new HashSet<>(
        dsl.select(THREAD_READ_STATE.THREAD_ROOT_ID)
            .from(THREAD_READ_STATE)
            .where(
                THREAD_READ_STATE
                    .USER_ID
                    .eq(userId)
                    .and(THREAD_READ_STATE.THREAD_ROOT_ID.in(rootIds)))
            .fetch(THREAD_READ_STATE.THREAD_ROOT_ID));
  }

  /** 인박스 한 행: 루트 메시지 카드 데이터 + 미읽음 수 + 최근 답글 시각. */
  public record InboxRow(
      long rootId,
      long channelId,
      String channelName,
      long authorId,
      String authorName,
      String authorKind,
      String body,
      Instant createdAt,
      int unreadReplyCount,
      Instant lastReplyAt) {}

  /** 인박스 페이지(keyset). */
  public record InboxPage(List<InboxRow> rows, String nextCursor, boolean hasMore) {}

  /** 미읽음 답글 집계(작성자≠me·삭제 제외·watermark 초과)용 reply 별칭 + 공통 조인 조건. */
  private Condition unreadReplyJoinCond(com.workplace.jooq.tables.Message reply, long me) {
    return reply
        .PARENT_MESSAGE_ID
        .eq(THREAD_READ_STATE.THREAD_ROOT_ID)
        .and(reply.DELETED_AT.isNull())
        .and(reply.AUTHOR_ID.ne(me))
        .and(reply.ID.gt(DSL.coalesce(THREAD_READ_STATE.LAST_READ_REPLY_ID, DSL.inline(0L))));
  }

  /** 내가 팔로우 + 미읽음 답글이 있는 스레드를 채널 가로질러 집계. last_reply_at DESC, root.id DESC keyset. */
  public InboxPage inboxPage(long userId, String cursor, int limit) {
    int safeLimit = Math.min(Math.max(limit, 1), 50);
    com.workplace.jooq.tables.Message root = MESSAGE.as("root");
    com.workplace.jooq.tables.Message reply = MESSAGE.as("reply");
    Field<OffsetDateTime> lastReplyAt = DSL.max(reply.CREATED_AT).as("last_reply_at");
    Field<Integer> unreadCount = DSL.count(reply.ID).as("unread_reply_count");

    // keyset 커서: last_reply_at < cTs OR (= cTs AND root.id < cId)
    var having = DSL.noCondition();
    if (cursor != null && !cursor.isEmpty()) {
      MessageRepository.Cursor c = MessageRepository.Cursor.decode(cursor);
      OffsetDateTime cTs = OffsetDateTime.ofInstant(c.createdAt(), ZoneOffset.UTC);
      having =
          DSL.max(reply.CREATED_AT)
              .lessThan(cTs)
              .or(DSL.max(reply.CREATED_AT).eq(cTs).and(root.ID.lessThan(c.id())));
    }

    var rows =
        dsl.select(
                root.ID,
                root.CHANNEL_ID,
                CHANNEL.NAME,
                root.AUTHOR_ID,
                USER.NAME,
                USER.KIND,
                root.BODY,
                root.CREATED_AT,
                unreadCount,
                lastReplyAt)
            .from(THREAD_READ_STATE)
            .join(root)
            .on(root.ID.eq(THREAD_READ_STATE.THREAD_ROOT_ID).and(root.DELETED_AT.isNull()))
            .join(CHANNEL)
            .on(CHANNEL.ID.eq(root.CHANNEL_ID))
            // 멤버십 스코프: 탈퇴/추방 후 잔존 thread_read_state 로 인한 비멤버 노출 차단.
            // 인채널 점(findMyChannels)과 동일 스코프 — INNER JOIN 으로 비멤버 채널 행 제거.
            .join(CHANNEL_MEMBER)
            .on(
                CHANNEL_MEMBER
                    .CHANNEL_ID
                    .eq(root.CHANNEL_ID)
                    .and(CHANNEL_MEMBER.USER_ID.eq(userId)))
            .join(USER)
            .on(USER.ID.eq(root.AUTHOR_ID))
            .join(reply)
            .on(unreadReplyJoinCond(reply, userId))
            .where(THREAD_READ_STATE.USER_ID.eq(userId))
            .groupBy(
                root.ID,
                root.CHANNEL_ID,
                CHANNEL.NAME,
                root.AUTHOR_ID,
                USER.NAME,
                USER.KIND,
                root.BODY,
                root.CREATED_AT)
            .having(having)
            .orderBy(lastReplyAt.desc(), root.ID.desc())
            .limit(safeLimit + 1)
            .fetch();

    List<InboxRow> items = new ArrayList<>();
    for (Record r : rows) {
      OffsetDateTime created = r.get(root.CREATED_AT);
      OffsetDateTime last = r.get(lastReplyAt);
      items.add(
          new InboxRow(
              r.get(root.ID),
              r.get(root.CHANNEL_ID),
              r.get(CHANNEL.NAME),
              r.get(root.AUTHOR_ID),
              r.get(USER.NAME),
              r.get(USER.KIND),
              r.get(root.BODY),
              created == null ? null : created.toInstant(),
              r.get(unreadCount),
              last == null ? null : last.toInstant()));
    }
    boolean hasMore = items.size() > safeLimit;
    if (hasMore) items = items.subList(0, safeLimit);
    String nextCursor = null;
    if (hasMore && !items.isEmpty()) {
      InboxRow lastRow = items.get(items.size() - 1);
      nextCursor =
          MessageRepository.Cursor.encode(
              new MessageRepository.Cursor(lastRow.lastReplyAt(), lastRow.rootId()));
    }
    return new InboxPage(items, nextCursor, hasMore);
  }

  /** 미읽음 답글이 있는, 내가 팔로우하는 스레드 개수(앱레일/사이드바 뱃지). */
  public int inboxUnreadThreadCount(long userId) {
    com.workplace.jooq.tables.Message root = MESSAGE.as("root");
    com.workplace.jooq.tables.Message reply = MESSAGE.as("reply");
    Integer n =
        dsl.select(DSL.countDistinct(root.ID))
            .from(THREAD_READ_STATE)
            .join(root)
            .on(root.ID.eq(THREAD_READ_STATE.THREAD_ROOT_ID).and(root.DELETED_AT.isNull()))
            // 멤버십 스코프: 탈퇴/추방 후 잔존 thread_read_state 로 인한 비멤버 노출 차단.
            // 인채널 점(findMyChannels)과 동일 스코프 — INNER JOIN 으로 비멤버 채널 행 제거.
            .join(CHANNEL_MEMBER)
            .on(
                CHANNEL_MEMBER
                    .CHANNEL_ID
                    .eq(root.CHANNEL_ID)
                    .and(CHANNEL_MEMBER.USER_ID.eq(userId)))
            .join(reply)
            .on(unreadReplyJoinCond(reply, userId))
            .where(THREAD_READ_STATE.USER_ID.eq(userId))
            .fetchOne(0, Integer.class);
    return n == null ? 0 : n;
  }

  /** rootIds 별 미읽음 답글 수(팔로우 + 미읽음>0 인 root 만 키로 존재). */
  public Map<Long, Integer> countUnreadForRoots(List<Long> rootIds, long userId) {
    if (rootIds.isEmpty()) return Map.of();
    com.workplace.jooq.tables.Message reply = MESSAGE.as("reply");
    Map<Long, Integer> out = new HashMap<>();
    dsl.select(THREAD_READ_STATE.THREAD_ROOT_ID, DSL.count(reply.ID))
        .from(THREAD_READ_STATE)
        .join(reply)
        .on(
            reply
                .PARENT_MESSAGE_ID
                .eq(THREAD_READ_STATE.THREAD_ROOT_ID)
                .and(reply.DELETED_AT.isNull())
                .and(reply.AUTHOR_ID.ne(userId))
                .and(
                    reply.ID.gt(
                        DSL.coalesce(THREAD_READ_STATE.LAST_READ_REPLY_ID, DSL.inline(0L)))))
        .where(
            THREAD_READ_STATE.USER_ID.eq(userId).and(THREAD_READ_STATE.THREAD_ROOT_ID.in(rootIds)))
        .groupBy(THREAD_READ_STATE.THREAD_ROOT_ID)
        .fetch()
        .forEach(r -> out.put(r.value1(), r.value2()));
    return out;
  }
}
