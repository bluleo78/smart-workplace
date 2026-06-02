package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.MESSAGE_REACTION;

import com.workplace.messaging.dto.ReactionResponse;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
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
}
