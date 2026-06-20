package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.THREAD_READ_STATE;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
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
