package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.MESSAGE_REACTION;
import static com.workplace.jooq.Tables.USER;

import com.workplace.messaging.dto.ReactionResponse;
import com.workplace.messaging.repository.MessageRepository.Cursor;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** message_reaction 리포지토리. (message,user,emoji) 유니크 → add=ON CONFLICT DO NOTHING, remove=delete. */
@Repository
@RequiredArgsConstructor
public class ReactionRepository {

  private final DSLContext dsl;

  /** 리액션 추가. 이미 존재하면 DO NOTHING. 실제 삽입됐으면 true. */
  public boolean add(long messageId, long userId, String emoji) {
    return dsl.insertInto(MESSAGE_REACTION)
            .set(MESSAGE_REACTION.MESSAGE_ID, messageId)
            .set(MESSAGE_REACTION.USER_ID, userId)
            .set(MESSAGE_REACTION.EMOJI, emoji)
            .onConflictDoNothing()
            .execute()
        > 0;
  }

  /** 이 사람이 이 메시지에 이미 단 리액션인가(멱등 재요청은 상한 검사 없이 통과시킨다). */
  public boolean exists(long messageId, long userId, String emoji) {
    return dsl.fetchExists(
        MESSAGE_REACTION,
        MESSAGE_REACTION
            .MESSAGE_ID
            .eq(messageId)
            .and(MESSAGE_REACTION.USER_ID.eq(userId))
            .and(MESSAGE_REACTION.EMOJI.eq(emoji)));
  }

  /** 이 사람이 이 메시지에 단 리액션 수(WP-665 1인 상한). */
  public int countByUser(long messageId, long userId) {
    return dsl.fetchCount(
        MESSAGE_REACTION,
        MESSAGE_REACTION.MESSAGE_ID.eq(messageId).and(MESSAGE_REACTION.USER_ID.eq(userId)));
  }

  /** 이 메시지에 emoji 가 이미 달려 있는가(WP-665 종류 상한 — 이미 있는 이모지에 더하는 것은 종류를 늘리지 않는다). */
  public boolean hasEmoji(long messageId, String emoji) {
    return dsl.fetchExists(
        MESSAGE_REACTION,
        MESSAGE_REACTION.MESSAGE_ID.eq(messageId).and(MESSAGE_REACTION.EMOJI.eq(emoji)));
  }

  /** 이 메시지에 달린 서로 다른 이모지 수. */
  public int countDistinctEmojis(long messageId) {
    return dsl.fetchCount(
        dsl.selectDistinct(MESSAGE_REACTION.EMOJI)
            .from(MESSAGE_REACTION)
            .where(MESSAGE_REACTION.MESSAGE_ID.eq(messageId)));
  }

  /** 리액션 제거. 실제 삭제됐으면 true. */
  public boolean remove(long messageId, long userId, String emoji) {
    return dsl.deleteFrom(MESSAGE_REACTION)
            .where(
                MESSAGE_REACTION
                    .MESSAGE_ID
                    .eq(messageId)
                    .and(MESSAGE_REACTION.USER_ID.eq(userId))
                    .and(MESSAGE_REACTION.EMOJI.eq(emoji)))
            .execute()
        > 0;
  }

  /**
   * 여러 메시지의 이모지별 집계를 1쿼리로 조회. message_id → [ReactionResponse...]. emoji 정렬은 최초 등장 시각순. reacted =
   * callerId 가 누른 이모지인지.
   */
  public Map<Long, List<ReactionResponse>> summariesFor(
      Collection<Long> messageIds, long callerId) {
    Map<Long, List<ReactionResponse>> out = new HashMap<>();
    if (messageIds.isEmpty()) return out;
    dsl.select(
            MESSAGE_REACTION.MESSAGE_ID,
            MESSAGE_REACTION.EMOJI,
            DSL.count().as("cnt"),
            DSL.boolOr(MESSAGE_REACTION.USER_ID.eq(callerId)).as("reacted"))
        .from(MESSAGE_REACTION)
        .where(MESSAGE_REACTION.MESSAGE_ID.in(messageIds))
        .groupBy(MESSAGE_REACTION.MESSAGE_ID, MESSAGE_REACTION.EMOJI)
        .orderBy(MESSAGE_REACTION.MESSAGE_ID, DSL.min(MESSAGE_REACTION.CREATED_AT))
        .fetch()
        .forEach(
            r ->
                out.computeIfAbsent(r.get(MESSAGE_REACTION.MESSAGE_ID), k -> new ArrayList<>())
                    .add(
                        new ReactionResponse(
                            r.get(MESSAGE_REACTION.EMOJI),
                            r.get("cnt", Integer.class),
                            Boolean.TRUE.equals(r.get("reacted", Boolean.class)))));
    return out;
  }

  /**
   * 메시지의 특정 이모지 반응자를 먼저 누른 순(created_at, user_id)으로 limit+1 건 조회한다. 호출자는 limit+1 번째 존재로 hasMore 를
   * 판정한다. after 가 있으면 그 (created_at, user_id) 다음부터(키셋). user 를 조인해 이름·종류를 함께 준다.
   */
  public List<ReactorRow> findReactors(long messageId, String emoji, Cursor after, int limit) {
    Condition cond =
        MESSAGE_REACTION.MESSAGE_ID.eq(messageId).and(MESSAGE_REACTION.EMOJI.eq(emoji));
    if (after != null)
      cond =
          cond.and(
              DSL.row(MESSAGE_REACTION.CREATED_AT, MESSAGE_REACTION.USER_ID)
                  .gt(OffsetDateTime.ofInstant(after.createdAt(), ZoneOffset.UTC), after.id()));
    return dsl.select(MESSAGE_REACTION.USER_ID, MESSAGE_REACTION.CREATED_AT, USER.NAME, USER.KIND)
        .from(MESSAGE_REACTION)
        .join(USER)
        .on(USER.ID.eq(MESSAGE_REACTION.USER_ID))
        .where(cond)
        .orderBy(MESSAGE_REACTION.CREATED_AT, MESSAGE_REACTION.USER_ID)
        .limit(limit + 1)
        .fetch(
            r ->
                new ReactorRow(
                    r.get(MESSAGE_REACTION.USER_ID),
                    r.get(USER.NAME),
                    r.get(USER.KIND),
                    r.get(MESSAGE_REACTION.CREATED_AT).toInstant()));
  }

  /** 반응자 1행 + 키셋 커서용 반응 시각. */
  public record ReactorRow(long userId, String name, String kind, Instant reactedAt) {}
}
