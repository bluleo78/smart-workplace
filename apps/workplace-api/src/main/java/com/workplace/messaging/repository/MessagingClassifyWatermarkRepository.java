package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.MESSAGING_CLASSIFY_WATERMARK;

import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** per-채널 분류 watermark — AI 호출 게이트(결과 무관 전진). 새 메시지 없으면 AI 호출 0. */
@Repository
@RequiredArgsConstructor
public class MessagingClassifyWatermarkRepository {

  private final DSLContext dsl;

  /**
   * 채널의 마지막 분류 메시지 id. 초기 기록 없으면 0 반환 — 호출 측에서 0이면 전체 미분류로 간주.
   *
   * @param channelId 채널 ID
   * @return 마지막 분류 메시지 ID, 없으면 0
   */
  public long get(long channelId) {
    Long v =
        dsl.select(MESSAGING_CLASSIFY_WATERMARK.LAST_CLASSIFIED_MESSAGE_ID)
            .from(MESSAGING_CLASSIFY_WATERMARK)
            .where(MESSAGING_CLASSIFY_WATERMARK.CHANNEL_ID.eq(channelId))
            .fetchOne(0, Long.class);
    return v == null ? 0L : v;
  }

  /**
   * watermark 를 messageId 로 전진. GREATEST 로 후퇴 방지 — 분류 1회마다 결과 유무와 무관하게 호출.
   *
   * @param channelId 채널 ID
   * @param messageId 이번 분류 기준 메시지 ID
   */
  public void advance(long channelId, long messageId) {
    dsl.insertInto(MESSAGING_CLASSIFY_WATERMARK)
        .set(MESSAGING_CLASSIFY_WATERMARK.CHANNEL_ID, channelId)
        .set(MESSAGING_CLASSIFY_WATERMARK.LAST_CLASSIFIED_MESSAGE_ID, messageId)
        .onConflict(MESSAGING_CLASSIFY_WATERMARK.CHANNEL_ID)
        .doUpdate()
        .set(
            MESSAGING_CLASSIFY_WATERMARK.LAST_CLASSIFIED_MESSAGE_ID,
            // GREATEST 로 후퇴 방지: 현재값보다 큰 경우에만 업데이트
            DSL.greatest(
                MESSAGING_CLASSIFY_WATERMARK.LAST_CLASSIFIED_MESSAGE_ID, DSL.val(messageId)))
        .set(
            MESSAGING_CLASSIFY_WATERMARK.CLASSIFIED_AT,
            DSL.field("now()", java.time.OffsetDateTime.class))
        .execute();
  }
}
