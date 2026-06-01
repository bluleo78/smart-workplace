package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;

import com.workplace.messaging.dto.ChannelResponse;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** channel 리포지토리. Phase 1 은 공개(PUBLIC) 채널만. */
@Repository
@RequiredArgsConstructor
public class ChannelRepository {

  private final DSLContext dsl;

  /** 공개 채널 생성 후 id 반환. kind/visibility 는 DB default('CHANNEL'/'PUBLIC') 사용. */
  public long insertPublic(String name, long createdBy) {
    return dsl.insertInto(CHANNEL)
        .set(CHANNEL.NAME, name)
        .set(CHANNEL.CREATED_BY, createdBy)
        .returning(CHANNEL.ID)
        .fetchOne()
        .getId();
  }

  /** 채널 존재 여부 확인. */
  public boolean exists(long channelId) {
    return dsl.fetchExists(dsl.selectOne().from(CHANNEL).where(CHANNEL.ID.eq(channelId)));
  }

  /** 전체 공개 채널 + caller 멤버 여부. created_at 오름차순. */
  public List<ChannelResponse> findAllWithMembership(long callerId) {
    return dsl.select(
            CHANNEL.ID,
            CHANNEL.KIND,
            CHANNEL.NAME,
            CHANNEL.VISIBILITY,
            CHANNEL.CREATED_AT,
            dsl.selectCount()
                .from(CHANNEL_MEMBER)
                .where(
                    CHANNEL_MEMBER
                        .CHANNEL_ID
                        .eq(CHANNEL.ID)
                        .and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
                .asField("is_member"))
        .from(CHANNEL)
        .where(CHANNEL.VISIBILITY.eq("PUBLIC").and(CHANNEL.ARCHIVED_AT.isNull()))
        .orderBy(CHANNEL.CREATED_AT.asc(), CHANNEL.ID.asc())
        .fetch(
            r -> {
              OffsetDateTime created = r.get(CHANNEL.CREATED_AT);
              Integer mc = r.get("is_member", Integer.class);
              return new ChannelResponse(
                  r.get(CHANNEL.ID),
                  r.get(CHANNEL.KIND),
                  r.get(CHANNEL.NAME),
                  r.get(CHANNEL.VISIBILITY),
                  mc != null && mc > 0,
                  created == null ? null : created.toInstant());
            });
  }

  /** channelId 로 단건 조회. caller 멤버 여부 포함. */
  public Optional<ChannelResponse> findOne(long channelId, long callerId) {
    return findAllWithMembership(callerId).stream().filter(c -> c.id() == channelId).findFirst();
  }
}
