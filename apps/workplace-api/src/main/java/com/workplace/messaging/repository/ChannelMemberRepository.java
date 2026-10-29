package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.jooq.impl.DSL.greatest;
import static org.jooq.impl.DSL.val;

import com.workplace.global.tenant.WorkspaceActive;
import com.workplace.messaging.dto.ChannelMemberResponse;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.springframework.stereotype.Repository;

/** channel_member 리포지토리. */
@Repository
@RequiredArgsConstructor
public class ChannelMemberRepository {

  private final DSLContext dsl;

  /** 멤버 추가 (PK 중복 무시 — idempotent join). 가입 시점 최신 메시지로 last_read 초기화(가입 전 히스토리는 unread 제외). */
  public void join(long channelId, long userId) {
    insert(channelId, userId, "MEMBER", false);
  }

  /** 채널 멤버 여부 확인. */
  public boolean isMember(long channelId, long userId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(CHANNEL_MEMBER)
            .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId))));
  }

  /** 여러 채널의 멤버 user_id 를 한 번에(채널 id → 멤버 id, 멤버 없는 채널은 빠진다) — 조직도 변경 알림의 추가 수신자(WP-1058). */
  public Map<Long, List<Long>> findMemberIdsByChannels(Collection<Long> channelIds) {
    if (channelIds.isEmpty()) {
      return Map.of();
    }
    return dsl.select(CHANNEL_MEMBER.CHANNEL_ID, CHANNEL_MEMBER.USER_ID)
        .from(CHANNEL_MEMBER)
        .where(CHANNEL_MEMBER.CHANNEL_ID.in(channelIds))
        .fetchGroups(CHANNEL_MEMBER.CHANNEL_ID, CHANNEL_MEMBER.USER_ID);
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
    insert(channelId, userId, role, false);
  }

  /**
   * 직접 초대(WP-1058) — 직접 멤버(direct=true, MEMBER)로 넣는다. 부서로 이미 들어와 있으면 행을 새로 만들지 않고 direct 만 켠다(역할·읽은
   * 위치·가입 시각 보존) — 그 뒤 부서가 빠지거나 부서에서 빠져도 남는다. 새로 넣을 때 읽은 위치는 {@link #add} 와 같이 가입 시점 최신 메시지.
   */
  public void addDirect(long channelId, long userId) {
    insert(channelId, userId, "MEMBER", true);
  }

  /**
   * 직접 멤버 행 삽입의 본체 — 새 행은 direct=true(열 기본값)이고 읽은 위치는 가입 시점 최신 메시지다. 이미 있으면 pinDirect 일 때만 direct 를
   * 켜고(역할·읽은 위치·가입 시각은 그대로) 아니면 아무것도 하지 않는다.
   */
  private void insert(long channelId, long userId, String role, boolean pinDirect) {
    dsl.execute(
        "INSERT INTO channel_member (channel_id, user_id, role, last_read_message_id) "
            + "VALUES (?, ?, ?, (SELECT MAX(id) FROM message WHERE channel_id = ?)) "
            + "ON CONFLICT (channel_id, user_id) DO "
            + (pinDirect ? "UPDATE SET direct = TRUE" : "NOTHING"),
        channelId,
        userId,
        role,
        channelId);
  }

  /** 직접 멤버 행인가(WP-1058) — 비멤버면 empty, 부서로만 들어온 행이면 false. */
  public Optional<Boolean> findDirect(long channelId, long userId) {
    return dsl.select(CHANNEL_MEMBER.DIRECT)
        .from(CHANNEL_MEMBER)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId)))
        .fetchOptional(CHANNEL_MEMBER.DIRECT);
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

  /** 대상 사용자의 USER.KIND(HUMAN/AGENT) 조회 — OWNER 승격 등 사람 전용 권한 가드에 사용. 사용자 미존재면 empty. */
  public Optional<String> findUserKind(long userId) {
    return dsl.select(USER.KIND).from(USER).where(USER.ID.eq(userId)).fetchOptional(USER.KIND);
  }

  /**
   * 역할 변경(승격/강등/소유권 이전). ADMIN·OWNER 로 올리면 직접 멤버로 고정한다(direct=true, WP-1058) — 부서로 들어와 관리 권한을 받은
   * 사람이 부서 변화로 조용히 빠지지 않게. MEMBER 로 내려도 direct 는 그대로 둔다(한 번 고정한 사람을 부서 판정에 다시 맡기지 않는다).
   */
  public void updateRole(long channelId, long userId, String role) {
    var update = dsl.update(CHANNEL_MEMBER).set(CHANNEL_MEMBER.ROLE, role);
    if (!"MEMBER".equals(role)) {
      update = update.set(CHANNEL_MEMBER.DIRECT, true);
    }
    update
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId)))
        .execute();
  }

  /**
   * 현재 OWNER 를 ADMIN 으로 강등 — 소유권 이전 시 새 OWNER 승격 직전에 호출해 "OWNER 1명" 불변식을 유지한다. ADMIN 도 직접 멤버로
   * 고정한다(WP-1058).
   */
  public void demoteOwners(long channelId) {
    dsl.update(CHANNEL_MEMBER)
        .set(CHANNEL_MEMBER.ROLE, "ADMIN")
        .set(CHANNEL_MEMBER.DIRECT, true)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.ROLE.eq("OWNER")))
        .execute();
  }

  /** 멤버 제거. 지운 행 수를 돌려준다(비멤버면 0). */
  public int remove(long channelId, long userId) {
    return dsl.deleteFrom(CHANNEL_MEMBER)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId)))
        .execute();
  }

  /** 멤버 수. */
  public int countMembers(long channelId) {
    return dsl.fetchCount(
        dsl.selectOne().from(CHANNEL_MEMBER).where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId)));
  }

  /**
   * 멤버 목록 — user 조인(username, name, kind) + 이 워크스페이스 활성 여부(WP-723) + 직접 멤버 여부(WP-1058). joined_at
   * 오름차순. viaGroupIds 는 빈 목록으로 둔다 — 부서 판정은 재귀 조회라, 명단만 필요한 roster 발행이 매번 치르지 않게 멤버 목록 API 가 따로 채운다.
   */
  public List<ChannelMemberResponse> listMembers(long channelId) {
    Field<Boolean> active = WorkspaceActive.field();
    return dsl.select(
            CHANNEL_MEMBER.USER_ID,
            USER.USERNAME,
            USER.NAME,
            USER.KIND,
            CHANNEL_MEMBER.ROLE,
            CHANNEL_MEMBER.JOINED_AT,
            CHANNEL_MEMBER.DIRECT,
            active)
        .from(CHANNEL_MEMBER)
        .join(USER)
        .on(USER.ID.eq(CHANNEL_MEMBER.USER_ID))
        .leftJoin(MEMBERSHIP)
        .on(WorkspaceActive.join(CHANNEL_MEMBER.USER_ID, CHANNEL_MEMBER.TENANT_ID))
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId))
        .orderBy(CHANNEL_MEMBER.JOINED_AT.asc(), CHANNEL_MEMBER.USER_ID.asc())
        .fetch(
            r -> {
              OffsetDateTime joined = r.get(CHANNEL_MEMBER.JOINED_AT);
              return new ChannelMemberResponse(
                  r.get(CHANNEL_MEMBER.USER_ID),
                  r.get(USER.USERNAME),
                  r.get(USER.NAME),
                  r.get(USER.KIND),
                  r.get(CHANNEL_MEMBER.ROLE),
                  joined == null ? null : joined.toInstant(),
                  Boolean.TRUE.equals(r.get(active)),
                  Boolean.TRUE.equals(r.get(CHANNEL_MEMBER.DIRECT)),
                  List.of());
            });
  }
}
