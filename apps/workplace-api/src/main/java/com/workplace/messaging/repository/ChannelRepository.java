package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;

import com.workplace.messaging.dto.ChannelResponse;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** channel 리포지토리. Phase 1 은 공개(PUBLIC) 채널만. */
@Repository
@RequiredArgsConstructor
public class ChannelRepository {

  private final DSLContext dsl;

  /** 채널 생성 후 id 반환. kind 는 DB default('CHANNEL'). */
  public long insert(String name, String visibility, long createdBy) {
    return dsl.insertInto(CHANNEL)
        .set(CHANNEL.NAME, name)
        .set(CHANNEL.VISIBILITY, visibility)
        .set(CHANNEL.CREATED_BY, createdBy)
        .returning(CHANNEL.ID)
        .fetchOne()
        .getId();
  }

  /** 공개 채널 생성(하위호환 래퍼) — visibility=PUBLIC 으로 insert 위임. */
  public long insertPublic(String name, long createdBy) {
    return insert(name, "PUBLIC", createdBy);
  }

  /** 채널 존재 여부 확인. */
  public boolean exists(long channelId) {
    return dsl.fetchExists(dsl.selectOne().from(CHANNEL).where(CHANNEL.ID.eq(channelId)));
  }

  /**
   * 전체 공개 채널 + caller 멤버 여부. created_at 오름차순. (Phase 1 호환 — 사이드바는 Task B7 에서 findMyChannels 로 대체)
   */
  public List<ChannelResponse> findAllWithMembership(long callerId) {
    return dsl.select(
            CHANNEL.ID,
            CHANNEL.KIND,
            CHANNEL.NAME,
            CHANNEL.VISIBILITY,
            CHANNEL.ARCHIVED_AT,
            CHANNEL.CREATED_AT,
            dsl.selectCount()
                .from(CHANNEL_MEMBER)
                .where(
                    CHANNEL_MEMBER
                        .CHANNEL_ID
                        .eq(CHANNEL.ID)
                        .and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
                .asField("is_member"),
            dsl.selectCount()
                .from(CHANNEL_MEMBER)
                .where(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID))
                .asField("member_count"),
            dsl.select(CHANNEL_MEMBER.ROLE)
                .from(CHANNEL_MEMBER)
                .where(
                    CHANNEL_MEMBER
                        .CHANNEL_ID
                        .eq(CHANNEL.ID)
                        .and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
                .asField("my_role"))
        .from(CHANNEL)
        .where(CHANNEL.VISIBILITY.eq("PUBLIC").and(CHANNEL.ARCHIVED_AT.isNull()))
        .orderBy(CHANNEL.CREATED_AT.asc(), CHANNEL.ID.asc())
        .fetch(ChannelRepository::mapChannel);
  }

  /** channelId 로 단건 조회. caller 멤버 여부 포함. */
  public Optional<ChannelResponse> findOne(long channelId, long callerId) {
    return findAllWithMembership(callerId).stream().filter(c -> c.id() == channelId).findFirst();
  }

  /** caller 가 멤버이고 아카이브되지 않은 채널 — 사이드바용. role/memberCount 포함, 이름 오름차순. */
  public List<ChannelResponse> findMyChannels(long callerId) {
    return dsl.select(
            CHANNEL.ID,
            CHANNEL.KIND,
            CHANNEL.NAME,
            CHANNEL.VISIBILITY,
            CHANNEL.ARCHIVED_AT,
            CHANNEL.CREATED_AT,
            DSL.inline(1).as("is_member"),
            dsl.selectCount()
                .from(CHANNEL_MEMBER)
                .where(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID))
                .asField("member_count"),
            CHANNEL_MEMBER.ROLE.as("my_role"))
        .from(CHANNEL)
        .join(CHANNEL_MEMBER)
        .on(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID).and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
        .where(CHANNEL.ARCHIVED_AT.isNull())
        .orderBy(CHANNEL.NAME.asc(), CHANNEL.ID.asc())
        .fetch(ChannelRepository::mapChannel);
  }

  /** 공개·비아카이브 채널 탐색 — 이름 ILIKE. q 가 비면 전체 공개 채널. */
  public List<ChannelResponse> searchDiscoverable(long callerId, String q) {
    Condition base = CHANNEL.VISIBILITY.eq("PUBLIC").and(CHANNEL.ARCHIVED_AT.isNull());
    Condition filtered =
        (q == null || q.isBlank())
            ? base
            : base.and(CHANNEL.NAME.likeIgnoreCase("%" + q.trim() + "%"));
    return dsl.select(
            CHANNEL.ID,
            CHANNEL.KIND,
            CHANNEL.NAME,
            CHANNEL.VISIBILITY,
            CHANNEL.ARCHIVED_AT,
            CHANNEL.CREATED_AT,
            dsl.selectCount()
                .from(CHANNEL_MEMBER)
                .where(
                    CHANNEL_MEMBER
                        .CHANNEL_ID
                        .eq(CHANNEL.ID)
                        .and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
                .asField("is_member"),
            dsl.selectCount()
                .from(CHANNEL_MEMBER)
                .where(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID))
                .asField("member_count"),
            dsl.select(CHANNEL_MEMBER.ROLE)
                .from(CHANNEL_MEMBER)
                .where(
                    CHANNEL_MEMBER
                        .CHANNEL_ID
                        .eq(CHANNEL.ID)
                        .and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
                .asField("my_role"))
        .from(CHANNEL)
        .where(filtered)
        .orderBy(CHANNEL.NAME.asc(), CHANNEL.ID.asc())
        .fetch(ChannelRepository::mapChannel);
  }

  /** 단건 상세 — visibility 무관 조회(접근제어는 서비스). caller 역할/멤버수 포함. */
  public Optional<ChannelResponse> findDetail(long channelId, long callerId) {
    return dsl.select(
            CHANNEL.ID,
            CHANNEL.KIND,
            CHANNEL.NAME,
            CHANNEL.VISIBILITY,
            CHANNEL.ARCHIVED_AT,
            CHANNEL.CREATED_AT,
            dsl.selectCount()
                .from(CHANNEL_MEMBER)
                .where(
                    CHANNEL_MEMBER
                        .CHANNEL_ID
                        .eq(CHANNEL.ID)
                        .and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
                .asField("is_member"),
            dsl.selectCount()
                .from(CHANNEL_MEMBER)
                .where(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID))
                .asField("member_count"),
            dsl.select(CHANNEL_MEMBER.ROLE)
                .from(CHANNEL_MEMBER)
                .where(
                    CHANNEL_MEMBER
                        .CHANNEL_ID
                        .eq(CHANNEL.ID)
                        .and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
                .asField("my_role"))
        .from(CHANNEL)
        .where(CHANNEL.ID.eq(channelId))
        .fetchOptional(ChannelRepository::mapChannel);
  }

  /** 채널 이름 변경. */
  public void rename(long channelId, String name) {
    dsl.update(CHANNEL).set(CHANNEL.NAME, name).where(CHANNEL.ID.eq(channelId)).execute();
  }

  /** 아카이브 토글 — true 면 archived_at=NOW(), false 면 NULL. */
  public void setArchived(long channelId, boolean archived) {
    dsl.update(CHANNEL)
        .set(CHANNEL.ARCHIVED_AT, archived ? OffsetDateTime.now() : (OffsetDateTime) null)
        .where(CHANNEL.ID.eq(channelId))
        .execute();
  }

  /** 아카이브 여부. */
  public boolean isArchived(long channelId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(CHANNEL)
            .where(CHANNEL.ID.eq(channelId).and(CHANNEL.ARCHIVED_AT.isNotNull())));
  }

  /** 하드 삭제 — channel_member/message 는 FK ON DELETE CASCADE 로 함께 삭제. */
  public void hardDelete(long channelId) {
    dsl.deleteFrom(CHANNEL).where(CHANNEL.ID.eq(channelId)).execute();
  }

  /** Record → ChannelResponse 공용 매퍼. select 절에 is_member/member_count/my_role 별칭이 있어야 한다. */
  static ChannelResponse mapChannel(org.jooq.Record r) {
    OffsetDateTime created = r.get(CHANNEL.CREATED_AT);
    Integer mc = r.get("is_member", Integer.class);
    Integer total = r.get("member_count", Integer.class);
    return new ChannelResponse(
        r.get(CHANNEL.ID),
        r.get(CHANNEL.KIND),
        r.get(CHANNEL.NAME),
        r.get(CHANNEL.VISIBILITY),
        mc != null && mc > 0,
        r.get("my_role", String.class),
        r.get(CHANNEL.ARCHIVED_AT) != null,
        total == null ? 0 : total,
        created == null ? null : created.toInstant());
  }
}
