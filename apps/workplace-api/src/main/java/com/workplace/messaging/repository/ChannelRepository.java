package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.USER;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.dto.DmParticipant;
import com.workplace.messaging.dto.DmResponse;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
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
            CHANNEL_MEMBER.ROLE.as("my_role"),
            unreadCountField(callerId))
        .from(CHANNEL)
        .join(CHANNEL_MEMBER)
        .on(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID).and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
        .where(CHANNEL.ARCHIVED_AT.isNull().and(CHANNEL.KIND.eq("CHANNEL")))
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

  /** 채널 kind('CHANNEL'|'DM'). 트리거 판단용. 채널이 없으면 빈 문자열. */
  public String findKind(long channelId) {
    return dsl.select(CHANNEL.KIND)
        .from(CHANNEL)
        .where(CHANNEL.ID.eq(channelId))
        .fetchOptional(CHANNEL.KIND)
        .orElse("");
  }

  /** 하드 삭제 — channel_member/message 는 FK ON DELETE CASCADE 로 함께 삭제. */
  public void hardDelete(long channelId) {
    dsl.deleteFrom(CHANNEL).where(CHANNEL.ID.eq(channelId)).execute();
  }

  /** kind='DM' AND member_key=? 인 DM 채널 id. */
  public Optional<Long> findDmIdByMemberKey(String memberKey) {
    return dsl.select(CHANNEL.ID)
        .from(CHANNEL)
        .where(CHANNEL.KIND.eq("DM").and(CHANNEL.MEMBER_KEY.eq(memberKey)))
        .fetchOptional(CHANNEL.ID);
  }

  /** DM 채널 생성(name=null, visibility=PRIVATE). id 반환. 테스트 시딩 등 충돌 없음이 보장된 경로용. */
  public long insertDm(String memberKey, long createdBy) {
    return dsl.insertInto(CHANNEL)
        .set(CHANNEL.KIND, "DM")
        .set(CHANNEL.VISIBILITY, "PRIVATE")
        .set(CHANNEL.MEMBER_KEY, memberKey)
        .set(CHANNEL.CREATED_BY, createdBy)
        .returning(CHANNEL.ID)
        .fetchOne()
        .getId();
  }

  /**
   * DM 채널 생성. 동일 (tenant_id, member_key) 가 이미 있으면(동시 생성 레이스) 아무 것도 하지 않고 empty 반환.
   * uq_channel_dm_member_key 부분 유니크 인덱스(V51 이후 tenant_id 포함)를 충돌 타깃으로 사용 → 예외 없이 트랜잭션
   * 유지(@Transactional abort 방지). tenant_id 는 DEFAULT(GUC 에서 자동 채워짐)이므로 set 불필요; 충돌 타깃에는 명시.
   */
  public Optional<Long> insertDmIfAbsent(String memberKey, long createdBy) {
    return dsl.insertInto(CHANNEL)
        .set(CHANNEL.KIND, "DM")
        .set(CHANNEL.VISIBILITY, "PRIVATE")
        .set(CHANNEL.MEMBER_KEY, memberKey)
        .set(CHANNEL.CREATED_BY, createdBy)
        .onConflict(CHANNEL.TENANT_ID, CHANNEL.MEMBER_KEY)
        .where(CHANNEL.KIND.eq("DM"))
        .doNothing()
        .returning(CHANNEL.ID)
        .fetchOptional(CHANNEL.ID);
  }

  /** caller 가 멤버인 단일 DM 상세(참여자 동봉). 비멤버/비DM 이면 empty. */
  public Optional<DmResponse> findDmDetail(long channelId, long callerId) {
    boolean isMember =
        dsl.fetchExists(
            dsl.selectOne()
                .from(CHANNEL_MEMBER)
                .where(
                    CHANNEL_MEMBER
                        .CHANNEL_ID
                        .eq(channelId)
                        .and(CHANNEL_MEMBER.USER_ID.eq(callerId))));
    if (!isMember) return Optional.empty();
    var ch =
        dsl.select(
                CHANNEL.ID,
                CHANNEL.CREATED_AT,
                dsl.select(DSL.max(MESSAGE.CREATED_AT))
                    .from(MESSAGE)
                    .where(MESSAGE.CHANNEL_ID.eq(CHANNEL.ID))
                    .asField("last_message_at"))
            .from(CHANNEL)
            .where(CHANNEL.ID.eq(channelId).and(CHANNEL.KIND.eq("DM")))
            .fetchOne();
    if (ch == null) return Optional.empty();
    List<DmParticipant> parts = participantsOf(channelId);
    OffsetDateTime last = ch.get("last_message_at", OffsetDateTime.class);
    OffsetDateTime created = ch.get(CHANNEL.CREATED_AT);
    // 단건 상세는 사이드바 unread 집계(findMyDms) 와 별개 경로 — caller 멤버 row 를 조인하지 않으므로 0 으로 둔다.
    return Optional.of(
        new DmResponse(
            ch.get(CHANNEL.ID),
            parts,
            last == null ? null : last.toInstant(),
            created == null ? null : created.toInstant(),
            0L));
  }

  /** caller 가 멤버인 DM 목록(참여자 동봉). 최근 메시지 → 생성 시각 내림차순. */
  public List<DmResponse> findMyDms(long callerId) {
    var rows =
        dsl.select(
                CHANNEL.ID,
                CHANNEL.CREATED_AT,
                dsl.select(DSL.max(MESSAGE.CREATED_AT))
                    .from(MESSAGE)
                    .where(MESSAGE.CHANNEL_ID.eq(CHANNEL.ID))
                    .asField("last_message_at"),
                unreadCountField(callerId))
            .from(CHANNEL)
            .join(CHANNEL_MEMBER)
            .on(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID).and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
            .where(CHANNEL.KIND.eq("DM"))
            .fetch();
    List<Long> ids = rows.map(r -> r.get(CHANNEL.ID));
    if (ids.isEmpty()) return List.of();
    // 참여자 일괄 조회(N+1 회피).
    Map<Long, List<DmParticipant>> byChannel =
        dsl.select(CHANNEL_MEMBER.CHANNEL_ID, USER.ID, USER.NAME, USER.KIND)
            .from(CHANNEL_MEMBER)
            .join(USER)
            .on(USER.ID.eq(CHANNEL_MEMBER.USER_ID))
            .where(CHANNEL_MEMBER.CHANNEL_ID.in(ids))
            .fetchGroups(
                r -> r.get(CHANNEL_MEMBER.CHANNEL_ID),
                r -> new DmParticipant(r.get(USER.ID), r.get(USER.NAME), r.get(USER.KIND)));
    return rows.stream()
        .map(
            r -> {
              OffsetDateTime last = r.get("last_message_at", OffsetDateTime.class);
              OffsetDateTime created = r.get(CHANNEL.CREATED_AT);
              Integer unread = r.get("unread_count", Integer.class);
              return new DmResponse(
                  r.get(CHANNEL.ID),
                  byChannel.getOrDefault(r.get(CHANNEL.ID), List.of()),
                  last == null ? null : last.toInstant(),
                  created == null ? null : created.toInstant(),
                  unread == null ? 0 : unread);
            })
        .sorted(
            Comparator.comparing(
                    (DmResponse d) -> d.lastMessageAt() != null ? d.lastMessageAt() : d.createdAt(),
                    Comparator.nullsLast(Comparator.naturalOrder()))
                .reversed())
        .toList();
  }

  /** 채널 참여자(user 조인) — DM 표시명 파생용. */
  private List<DmParticipant> participantsOf(long channelId) {
    return dsl.select(USER.ID, USER.NAME, USER.KIND)
        .from(CHANNEL_MEMBER)
        .join(USER)
        .on(USER.ID.eq(CHANNEL_MEMBER.USER_ID))
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId))
        .fetch(r -> new DmParticipant(r.get(USER.ID), r.get(USER.NAME), r.get(USER.KIND)));
  }

  /**
   * caller 의 채널별 미읽음 메시지 수 상관 서브쿼리. caller 의 CHANNEL_MEMBER row 가 조인된 쿼리에서만 사용. 본인 작성·삭제된 메시지는
   * 제외하고, last_read_message_id(없으면 0) 초과 메시지를 센다.
   */
  private static org.jooq.Field<Integer> unreadCountField(long callerId) {
    return DSL.selectCount()
        .from(MESSAGE)
        .where(
            MESSAGE
                .CHANNEL_ID
                .eq(CHANNEL.ID)
                .and(MESSAGE.DELETED_AT.isNull())
                .and(MESSAGE.PARENT_MESSAGE_ID.isNull()) // 스레드 답글은 채널 뱃지에서 제외
                .and(MESSAGE.AUTHOR_ID.ne(callerId))
                .and(
                    MESSAGE.ID.gt(
                        DSL.coalesce(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID, DSL.inline(0L)))))
        .asField("unread_count");
  }

  /** Record → ChannelResponse 공용 매퍼. select 절에 is_member/member_count/my_role 별칭이 있어야 한다. */
  static ChannelResponse mapChannel(org.jooq.Record r) {
    OffsetDateTime created = r.get(CHANNEL.CREATED_AT);
    Integer mc = r.get("is_member", Integer.class);
    Integer total = r.get("member_count", Integer.class);
    // unread_count 는 일부 쿼리에만 존재 — 없으면 0 으로 방어적 처리.
    Integer unread = r.field("unread_count") != null ? r.get("unread_count", Integer.class) : 0;
    return new ChannelResponse(
        r.get(CHANNEL.ID),
        r.get(CHANNEL.KIND),
        r.get(CHANNEL.NAME),
        r.get(CHANNEL.VISIBILITY),
        mc != null && mc > 0,
        r.get("my_role", String.class),
        r.get(CHANNEL.ARCHIVED_AT) != null,
        total == null ? 0 : total,
        unread == null ? 0 : unread,
        created == null ? null : created.toInstant());
  }
}
