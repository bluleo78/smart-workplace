package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.USER;
import static org.jooq.impl.DSL.greatest;
import static org.jooq.impl.DSL.val;

import com.workplace.messaging.dto.ChannelMemberResponse;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** channel_member 리포지토리. */
@Repository
@RequiredArgsConstructor
public class ChannelMemberRepository {

  private final DSLContext dsl;

  /** 멤버 추가 (PK 중복 무시 — idempotent join). 가입 시점 최신 메시지로 last_read 초기화(가입 전 히스토리는 unread 제외). */
  public void join(long channelId, long userId) {
    dsl.execute(
        "INSERT INTO channel_member (channel_id, user_id, last_read_message_id) "
            + "VALUES (?, ?, (SELECT MAX(id) FROM message WHERE channel_id = ?)) "
            + "ON CONFLICT (channel_id, user_id) DO NOTHING",
        channelId,
        userId,
        channelId);
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

  /**
   * 멤버 추가(역할 지정). 이미 멤버면 무시 — 기존 역할 보존(DO NOTHING). 가입 시점 최신 메시지로 last_read 초기화(가입 전 히스토리는 unread
   * 제외). DM 도 이 경로로 멤버를 추가하므로 동일하게 적용된다(생성 시점엔 메시지 0건 → NULL).
   */
  public void add(long channelId, long userId, String role) {
    dsl.execute(
        "INSERT INTO channel_member (channel_id, user_id, role, last_read_message_id) "
            + "VALUES (?, ?, ?, (SELECT MAX(id) FROM message WHERE channel_id = ?)) "
            + "ON CONFLICT (channel_id, user_id) DO NOTHING",
        channelId,
        userId,
        role,
        channelId);
  }

  /** 본인 last_read_message_id 를 max(기존, upto) 로 갱신(GREATEST — watermark 후퇴 방지). */
  public void markRead(long channelId, long userId, long uptoMessageId) {
    dsl.update(CHANNEL_MEMBER)
        .set(
            CHANNEL_MEMBER.LAST_READ_MESSAGE_ID,
            org.jooq.impl.DSL.coalesce(
                greatest(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID, val(uptoMessageId)),
                val(uptoMessageId)))
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId)))
        .execute();
  }

  /** caller 의 채널 역할. 비멤버면 empty. */
  public Optional<String> findRole(long channelId, long userId) {
    return dsl.select(CHANNEL_MEMBER.ROLE)
        .from(CHANNEL_MEMBER)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId)))
        .fetchOptional(CHANNEL_MEMBER.ROLE);
  }

  /** 역할 변경(승격/강등/소유권 이전). */
  public void updateRole(long channelId, long userId, String role) {
    dsl.update(CHANNEL_MEMBER)
        .set(CHANNEL_MEMBER.ROLE, role)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId)))
        .execute();
  }

  /** 현재 OWNER 를 ADMIN 으로 강등 — 소유권 이전 시 새 OWNER 승격 직전에 호출해 "OWNER 1명" 불변식을 유지한다. */
  public void demoteOwners(long channelId) {
    dsl.update(CHANNEL_MEMBER)
        .set(CHANNEL_MEMBER.ROLE, "ADMIN")
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.ROLE.eq("OWNER")))
        .execute();
  }

  /** 멤버 제거. */
  public void remove(long channelId, long userId) {
    dsl.deleteFrom(CHANNEL_MEMBER)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId)))
        .execute();
  }

  /** 멤버 수. */
  public int countMembers(long channelId) {
    return dsl.fetchCount(
        dsl.selectOne().from(CHANNEL_MEMBER).where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId)));
  }

  /** 멤버 목록 — user 조인(name, kind). joined_at 오름차순. */
  public List<ChannelMemberResponse> listMembers(long channelId) {
    return dsl.select(
            CHANNEL_MEMBER.USER_ID,
            USER.NAME,
            USER.KIND,
            CHANNEL_MEMBER.ROLE,
            CHANNEL_MEMBER.JOINED_AT)
        .from(CHANNEL_MEMBER)
        .join(USER)
        .on(USER.ID.eq(CHANNEL_MEMBER.USER_ID))
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId))
        .orderBy(CHANNEL_MEMBER.JOINED_AT.asc(), CHANNEL_MEMBER.USER_ID.asc())
        .fetch(
            r -> {
              OffsetDateTime joined = r.get(CHANNEL_MEMBER.JOINED_AT);
              return new ChannelMemberResponse(
                  r.get(CHANNEL_MEMBER.USER_ID),
                  r.get(USER.NAME),
                  r.get(USER.KIND),
                  r.get(CHANNEL_MEMBER.ROLE),
                  joined == null ? null : joined.toInstant());
            });
  }
}
