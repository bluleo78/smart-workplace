package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.CHANNEL_MEMBER;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** channel_member 리포지토리. */
@Repository
@RequiredArgsConstructor
public class ChannelMemberRepository {

  private final DSLContext dsl;

  /** 멤버 추가 (PK 중복 무시 — idempotent join). */
  public void join(long channelId, long userId) {
    dsl.execute(
        "INSERT INTO channel_member (channel_id, user_id) VALUES (?, ?)"
            + " ON CONFLICT (channel_id, user_id) DO NOTHING",
        channelId,
        userId);
  }

  /** 채널 멤버 여부 확인. */
  public boolean isMember(long channelId, long userId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(CHANNEL_MEMBER)
            .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId))));
  }

  /** 채널 전 멤버 user_id (SSE fan-out 용 경량 쿼리). */
  public List<Long> findMemberIds(long channelId) {
    return dsl.select(CHANNEL_MEMBER.USER_ID)
        .from(CHANNEL_MEMBER)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId))
        .fetch(CHANNEL_MEMBER.USER_ID);
  }
}
