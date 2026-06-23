package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.CONVERSATION_ATTENTION;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** 메시징 AI 발굴(암묵적 채널 관련성) 마크 영속. per-(채널,사용자). RLS 로 tenant 격리. */
@Repository
@RequiredArgsConstructor
public class ConversationAttentionRepository {

  private final DSLContext dsl;

  /**
   * AI 분류 마크 기록. 동일 (채널,사용자) 충돌 시 사유·watermark·시각 갱신(transition 재분류 시 덮어씀).
   *
   * @param channelId 채널 ID
   * @param userId 대상 사용자 ID
   * @param reason AI가 판단한 관련 사유 요약
   * @param classifiedMessageId 분류 기준이 된 메시지 ID
   */
  public void upsert(long channelId, long userId, String reason, long classifiedMessageId) {
    dsl.insertInto(CONVERSATION_ATTENTION)
        .set(CONVERSATION_ATTENTION.CHANNEL_ID, channelId)
        .set(CONVERSATION_ATTENTION.USER_ID, userId)
        .set(CONVERSATION_ATTENTION.REASON, reason)
        .set(CONVERSATION_ATTENTION.CLASSIFIED_MESSAGE_ID, classifiedMessageId)
        .onConflict(CONVERSATION_ATTENTION.CHANNEL_ID, CONVERSATION_ATTENTION.USER_ID)
        .doUpdate()
        .set(CONVERSATION_ATTENTION.REASON, reason)
        .set(CONVERSATION_ATTENTION.CLASSIFIED_MESSAGE_ID, classifiedMessageId)
        .set(
            CONVERSATION_ATTENTION.CLASSIFIED_AT,
            DSL.field("now()", java.time.OffsetDateTime.class))
        .execute();
  }

  /**
   * transition 게이트용 — 이미 마크가 켜져 있나.
   *
   * @param channelId 채널 ID
   * @param userId 사용자 ID
   * @return 마크 존재 시 true
   */
  public boolean isFlagged(long channelId, long userId) {
    return dsl.fetchExists(
        dsl.selectFrom(CONVERSATION_ATTENTION)
            .where(CONVERSATION_ATTENTION.CHANNEL_ID.eq(channelId))
            .and(CONVERSATION_ATTENTION.USER_ID.eq(userId)));
  }

  /**
   * 요약용 — 사용자의 모든 AI 발굴 마크 목록.
   *
   * @param userId 사용자 ID
   * @return AttentionMark 리스트
   */
  public List<AttentionMark> listForUser(long userId) {
    return dsl.select(
            CONVERSATION_ATTENTION.CHANNEL_ID,
            CONVERSATION_ATTENTION.REASON,
            CONVERSATION_ATTENTION.CLASSIFIED_MESSAGE_ID)
        .from(CONVERSATION_ATTENTION)
        .where(CONVERSATION_ATTENTION.USER_ID.eq(userId))
        .fetch(r -> new AttentionMark(r.value1(), r.value2(), r.value3()));
  }

  /**
   * 읽음 등으로 무의미해진 마크 제거(선택적 정리).
   *
   * @param channelId 채널 ID
   * @param userId 사용자 ID
   */
  public void deleteByChannelUser(long channelId, long userId) {
    dsl.deleteFrom(CONVERSATION_ATTENTION)
        .where(CONVERSATION_ATTENTION.CHANNEL_ID.eq(channelId))
        .and(CONVERSATION_ATTENTION.USER_ID.eq(userId))
        .execute();
  }

  /** AI 발굴 마크 1건. */
  public record AttentionMark(long channelId, String reason, long classifiedMessageId) {}
}
