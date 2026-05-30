package com.workplace.chat.repository;

import static com.workplace.jooq.Tables.CHAT_THREAD_MEMBER;
import static com.workplace.jooq.Tables.USER;
import static org.jooq.impl.DSL.greatest;
import static org.jooq.impl.DSL.val;

import com.workplace.chat.dto.ChatMemberResponse;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** chat_thread_member 리포지토리. */
@Repository
@RequiredArgsConstructor
public class ChatThreadMemberRepository {

  private final DSLContext dsl;

  /** 동시 INSERT 안전 (PK 중복 무시). 신규로 추가된 row 개수와 무관하게 idempotent. */
  public void insertIgnoreConflict(long threadId, Collection<Long> userIds) {
    if (userIds.isEmpty()) return;
    for (Long userId : userIds) {
      dsl.execute(
          "INSERT INTO chat_thread_member (thread_id, user_id) VALUES (?, ?)"
              + " ON CONFLICT (thread_id, user_id) DO NOTHING",
          threadId,
          userId);
    }
  }

  public boolean isMember(long threadId, long userId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(CHAT_THREAD_MEMBER)
            .where(
                CHAT_THREAD_MEMBER
                    .THREAD_ID
                    .eq(threadId)
                    .and(CHAT_THREAD_MEMBER.USER_ID.eq(userId))));
  }

  /** caller 본인 leave. row 자체 제거. */
  public boolean delete(long threadId, long userId) {
    return dsl.deleteFrom(CHAT_THREAD_MEMBER)
            .where(
                CHAT_THREAD_MEMBER
                    .THREAD_ID
                    .eq(threadId)
                    .and(CHAT_THREAD_MEMBER.USER_ID.eq(userId)))
            .execute()
        > 0;
  }

  /** 본인 last_read_message_id 를 max(기존, upto) 로 갱신. */
  public void markRead(long threadId, long userId, long uptoMessageId) {
    dsl.update(CHAT_THREAD_MEMBER)
        .set(
            CHAT_THREAD_MEMBER.LAST_READ_MESSAGE_ID,
            org.jooq.impl.DSL.coalesce(
                greatest(CHAT_THREAD_MEMBER.LAST_READ_MESSAGE_ID, val(uptoMessageId)),
                val(uptoMessageId)))
        .where(CHAT_THREAD_MEMBER.THREAD_ID.eq(threadId).and(CHAT_THREAD_MEMBER.USER_ID.eq(userId)))
        .execute();
  }

  /** Thread 의 모든 멤버 user_id 만 조회 (SSE fan-out 용 경량 쿼리). */
  public List<Long> findMemberIds(long threadId) {
    return dsl.select(CHAT_THREAD_MEMBER.USER_ID)
        .from(CHAT_THREAD_MEMBER)
        .where(CHAT_THREAD_MEMBER.THREAD_ID.eq(threadId))
        .fetch(CHAT_THREAD_MEMBER.USER_ID);
  }

  /** Thread 의 모든 멤버 + USER.username/name/kind JOIN. joined_at 빠른 순. */
  public List<ChatMemberResponse> findMembers(long threadId) {
    return dsl.select(
            CHAT_THREAD_MEMBER.USER_ID,
            USER.USERNAME,
            USER.NAME,
            USER.KIND,
            CHAT_THREAD_MEMBER.LAST_READ_MESSAGE_ID,
            CHAT_THREAD_MEMBER.JOINED_AT)
        .from(CHAT_THREAD_MEMBER)
        .join(USER)
        .on(USER.ID.eq(CHAT_THREAD_MEMBER.USER_ID))
        .where(CHAT_THREAD_MEMBER.THREAD_ID.eq(threadId))
        .orderBy(CHAT_THREAD_MEMBER.JOINED_AT.asc())
        .fetch(
            r -> {
              OffsetDateTime joined = r.get(CHAT_THREAD_MEMBER.JOINED_AT);
              return new ChatMemberResponse(
                  r.get(CHAT_THREAD_MEMBER.USER_ID),
                  r.get(USER.USERNAME),
                  r.get(USER.NAME),
                  r.get(USER.KIND),
                  r.get(CHAT_THREAD_MEMBER.LAST_READ_MESSAGE_ID),
                  joined == null ? null : joined.toInstant());
            });
  }
}
