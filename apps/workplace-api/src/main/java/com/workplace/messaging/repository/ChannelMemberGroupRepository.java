package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER_GROUP;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER_GROUP_EXCLUSION;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.USER_GROUP;

import com.workplace.global.org.Departments;
import com.workplace.global.org.Departments.MemberStatus;
import com.workplace.global.org.Departments.SubtreeMembers;
import com.workplace.messaging.dto.ChannelMemberGroupResponse;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record1;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * channel_member_group·channel_member_group_exclusion 접근(WP-1058) — 비공개 채널 멤버로 둔 조직도 부서 행과 개인 제외 행,
 * 그리고 부서로 들어오는 사람을 channel_member 에 펼쳐 맞추는(materialize) 쿼리.
 *
 * <p>노트·드라이브·프로젝트는 부서 행만 두고 판정 때마다 소속을 다시 보지만, 채널은 channel_member 를 직접 읽는 쿼리가 많아(안 읽은 수·내 채널·멘션·SSE
 * 수신자·연동 드라이브 명단) 사람 행을 펼쳐 둔다. 「부서로 들어오는 사람」은 공통 규칙({@link Departments#subtreeMembers} — 부서와 하위 부서의
 * 활성 사람 구성원)에서 개인 제외를 뺀 집합이다.
 */
@Repository
@RequiredArgsConstructor
public class ChannelMemberGroupRepository {
  /** 부서로 들어온 사람의 채널 역할 — 멤버 관리 권한(OWNER/ADMIN)을 부서 전체에 주지 않는다. */
  public static final String GROUP_ROLE = "MEMBER";

  private final DSLContext dsl;

  // --- 부서 행 ---

  /**
   * 채널 멤버 부서(이름순)와 부서마다 지금 들어오는 사람 수 — 그 부서와 하위 부서의 부서 구성원(중복 제외)에서 개인 제외를 뺀 수. 맞추기와 같은 기준이라 보이는 수와
   * 실제로 채널에 들어온 부서 사람이 같다. 모든 부서를 한 번의 조회로 센다.
   */
  public List<ChannelMemberGroupResponse> list(long channelId) {
    SubtreeMembers members = Departments.subtreeMembers("cmgl", groupIdsOf(channelId));
    // 부서별 인원을 한 번에 센다(출발 부서별로 이미 중복을 뺐다). 개인 제외는 부서로 들어오지 않으므로 뺀다.
    var counts =
        DSL.select(members.rootId().as("root_id"), DSL.count().as("member_count"))
            .from(members.table())
            .where(members.userId().notIn(excludedUserIds(channelId)))
            .groupBy(members.rootId())
            .asTable("cmglc");
    Field<Long> countRoot = counts.field("root_id", Long.class);
    Field<Integer> memberCount =
        DSL.coalesce(counts.field("member_count", Integer.class), DSL.inline(0));
    return dsl.select(USER_GROUP.ID, USER_GROUP.NAME, memberCount, CHANNEL_MEMBER_GROUP.ADDED_AT)
        .from(CHANNEL_MEMBER_GROUP)
        .join(USER_GROUP)
        .on(USER_GROUP.ID.eq(CHANNEL_MEMBER_GROUP.GROUP_ID))
        .leftJoin(counts)
        .on(countRoot.eq(USER_GROUP.ID))
        .where(CHANNEL_MEMBER_GROUP.CHANNEL_ID.eq(channelId))
        .orderBy(USER_GROUP.NAME.asc(), USER_GROUP.ID.asc())
        .fetch(
            r ->
                new ChannelMemberGroupResponse(
                    r.value1(), r.value2(), r.value3(), r.value4().toInstant()));
  }

  /** 이 채널에 멤버 부서가 하나라도 있는가 — 없으면(공개 채널·DM 포함) 부서 판정의 재귀 조회를 건너뛴다. */
  public boolean hasGroups(long channelId) {
    return dsl.fetchExists(groupIdsOf(channelId));
  }

  /**
   * groupId 가 이 워크스페이스의 조직도 부서(visibility=SHARED)면 그 이름 — 채널 멤버로 받을 수 있는지 검증한다. 다른 테넌트 그룹은 RLS 로,
   * 개인 그룹은 조건으로 빠진다(노트·드라이브·프로젝트 멤버 부서 검증과 같은 규칙).
   */
  public Optional<String> findDepartmentName(long groupId) {
    return dsl.select(USER_GROUP.NAME)
        .from(USER_GROUP)
        .where(USER_GROUP.ID.eq(groupId))
        .and(USER_GROUP.VISIBILITY.eq(Departments.SHARED))
        .fetchOptional(USER_GROUP.NAME);
  }

  /** 부서 행을 더하고 더한 시각을 돌려준다. 이미 있으면(동시 추가 포함) 그대로 두고 empty — 호출자가 중복으로 답한다. */
  public Optional<Instant> insert(long channelId, long groupId, long addedBy) {
    return dsl.insertInto(CHANNEL_MEMBER_GROUP)
        .set(CHANNEL_MEMBER_GROUP.CHANNEL_ID, channelId)
        .set(CHANNEL_MEMBER_GROUP.GROUP_ID, groupId)
        .set(CHANNEL_MEMBER_GROUP.ADDED_BY, addedBy)
        .onConflictDoNothing()
        .returning(CHANNEL_MEMBER_GROUP.ADDED_AT)
        .fetchOptional(r -> r.getAddedAt().toInstant());
  }

  /** 부서 행을 지운다. 지운 행 수를 돌려준다(동시 제거면 0). */
  public int delete(long channelId, long groupId) {
    return dsl.deleteFrom(CHANNEL_MEMBER_GROUP)
        .where(CHANNEL_MEMBER_GROUP.CHANNEL_ID.eq(channelId))
        .and(CHANNEL_MEMBER_GROUP.GROUP_ID.eq(groupId))
        .execute();
  }

  /**
   * groupIds 중 하나를 멤버로 둔 채널 id(오름차순, 중복 없음) — 부서 구성원 증감({@code DepartmentMembersReduced}·{@code
   * DepartmentMembersGrown})의 영향을 받는 채널을 찾는다. 이벤트의 부서 목록에는 상위 부서도 들어 있어 상위 부서를 둔 채널도 함께 잡힌다.
   */
  public List<Long> findChannelIdsByGroups(Collection<Long> groupIds) {
    if (groupIds.isEmpty()) {
      return List.of();
    }
    return dsl.selectDistinct(CHANNEL_MEMBER_GROUP.CHANNEL_ID)
        .from(CHANNEL_MEMBER_GROUP)
        .where(CHANNEL_MEMBER_GROUP.GROUP_ID.in(groupIds))
        .orderBy(CHANNEL_MEMBER_GROUP.CHANNEL_ID.asc())
        .fetch(CHANNEL_MEMBER_GROUP.CHANNEL_ID);
  }

  // --- 부서 판정 ---

  /**
   * 사람이 이 채널의 멤버 부서(와 그 하위 부서)에 걸리는가 — 정지된 구성원도 걸린다(정지는 소속을 끊지 않는다), 개인 제외는 보지 않는다. 내보내기·나가기가 개인
   * 제외를 남길지 정한다(부서로 걸리면 맞추기가 다시 넣으므로 — 정지된 사람도 정지가 풀리면 다시 넣는다). 구성원 행을 그 사람으로 먼저 거른다. 멤버 부서가 없는
   * 채널이면 재귀 조회 없이 false.
   */
  public boolean isCovered(long channelId, long userId) {
    if (!hasGroups(channelId)) {
      return false;
    }
    SubtreeMembers m =
        Departments.subtreeMembers(
            "cmgc", groupIdsOf(channelId), List.of(userId), MemberStatus.INCLUDING_INACTIVE);
    return dsl.fetchExists(DSL.selectOne().from(m.table()));
  }

  /**
   * 사람 id → 그 사람이 걸리는 이 채널의 멤버 부서 id 목록(오름차순) — 멤버 목록의 viaGroupIds. 부서로 걸리지 않는 사람은 맵에 없다. 정지된 구성원도
   * 걸린다 — 정지돼도 남아 있는 부서 사람 행이 어느 부서로 들어왔는지 보이게. 멤버 목록마다 한 번의 조회로 모은다. 멤버 부서가 없는 채널(공개 채널·DM 포함)이면
   * 재귀 조회 없이 빈 맵.
   */
  public Map<Long, List<Long>> coveringGroupsByUser(long channelId) {
    if (!hasGroups(channelId)) {
      return Map.of();
    }
    SubtreeMembers m =
        Departments.subtreeMembers(
            "cmgv", groupIdsOf(channelId), null, MemberStatus.INCLUDING_INACTIVE);
    return dsl.select(m.userId(), m.rootId())
        .from(m.table())
        .orderBy(m.rootId().asc())
        .fetchGroups(m.userId(), m.rootId());
  }

  // --- 개인 제외 ---

  /** 개인 제외를 남긴다(이미 있으면 그대로). */
  public void insertExclusion(long channelId, long userId) {
    dsl.insertInto(CHANNEL_MEMBER_GROUP_EXCLUSION)
        .set(CHANNEL_MEMBER_GROUP_EXCLUSION.CHANNEL_ID, channelId)
        .set(CHANNEL_MEMBER_GROUP_EXCLUSION.USER_ID, userId)
        .onConflictDoNothing()
        .execute();
  }

  /** 개인 제외를 지운다 — 다시 초대(직접 멤버)하면 부서 판정에서 다시 들어올 수 있게. */
  public void deleteExclusion(long channelId, long userId) {
    dsl.deleteFrom(CHANNEL_MEMBER_GROUP_EXCLUSION)
        .where(CHANNEL_MEMBER_GROUP_EXCLUSION.CHANNEL_ID.eq(channelId))
        .and(CHANNEL_MEMBER_GROUP_EXCLUSION.USER_ID.eq(userId))
        .execute();
  }

  /**
   * 이제 이 채널의 어느 멤버 부서에도 걸리지 않는 사람의 개인 제외를 지운다 — 멤버 부서를 뺀 뒤. 개인 제외는 「부서로 걸리지만 들이지 않는다」는 뜻이라, 걸리지 않게
   * 된 사람의 제외를 남겨 두면 나중에 그 사람이 걸리는 다른 부서를 더해도 들어오지 못한다. 남은 부서로 여전히 걸리는 사람(정지 포함)의 제외는 그대로 둔다. 지운 행
   * 수를 돌려준다.
   */
  public int deleteUncoveredExclusions(long channelId) {
    return dsl.deleteFrom(CHANNEL_MEMBER_GROUP_EXCLUSION)
        .where(CHANNEL_MEMBER_GROUP_EXCLUSION.CHANNEL_ID.eq(channelId))
        .and(CHANNEL_MEMBER_GROUP_EXCLUSION.USER_ID.notIn(coveredUserIds(channelId)))
        .execute();
  }

  // --- 맞추기(materialize) ---

  /**
   * 부서로 들어와야 하는데 채널 멤버 행이 없는 사람을 넣고 넣은 사람 id 를 돌려준다. onlyUserIds 가 있으면 그 사람들만 본다 — 부서에 사람을 넣었거나 정지를
   * 풀었을 때 부서 트리 구성원 전원을 펼치지 않게(null 이면 전원).
   */
  public List<Long> insertMissing(long channelId, Collection<Long> onlyUserIds) {
    SubtreeMembers m = Departments.subtreeMembers("cmgs", groupIdsOf(channelId), onlyUserIds);
    Select<Record1<Long>> desired =
        DSL.selectDistinct(m.userId())
            .from(m.table())
            .where(m.userId().notIn(excludedUserIds(channelId)));
    return insertGroupMembers(channelId, desired);
  }

  /**
   * 부서 하나(groupId)와 하위 부서로 이 채널에 들어올 사람 — 활성 사람 구성원(중복 제외)에서 개인 제외를 뺀 것. 정지된 사람은 들어오지 않는다(정지를 풀면
   * user 모듈의 구성원 증가 이벤트로 들어온다). 부서 행을 더할 때 넣을 사람이자 그 부서의 인원 수({@link #list} 와 같은 기준)다.
   */
  public List<Long> findIncomingUserIds(long channelId, long groupId) {
    SubtreeMembers m = Departments.subtreeMembers("cmgi", DSL.select(DSL.val(groupId)));
    return dsl.selectDistinct(m.userId())
        .from(m.table())
        .where(m.userId().notIn(excludedUserIds(channelId)))
        .fetch(m.userId());
  }

  /** 주어진 사람(userIds — 이미 부서로 들어올 사람으로 고른 것)을 부서 사람 행으로 넣는다. 넣은 사람 id 를 돌려준다. */
  public List<Long> insertGroupMembers(long channelId, Collection<Long> userIds) {
    if (userIds.isEmpty()) {
      return List.of();
    }
    Field<Long> userId = DSL.field(DSL.name("cmgu", "user_id"), Long.class);
    return insertGroupMembers(
        channelId,
        DSL.select(userId)
            .from(DSL.unnest(DSL.val(userIds.toArray(Long[]::new))).as("cmgu", "user_id")));
  }

  /**
   * 부서 사람 행 삽입의 본체 — direct=false, 역할 MEMBER, 읽은 위치는 지금 최신 메시지(초대와 같이 들어오기 전 이력은 안 읽음으로 세지 않는다). 이미
   * 행이 있는 사람(직접 멤버·동시 맞추기·초대)은 PK 충돌로 건너뛰어 역할·direct·읽은 위치를 건드리지 않고, 돌려주는 목록에도 없다.
   */
  private List<Long> insertGroupMembers(long channelId, Select<Record1<Long>> userIds) {
    Field<Long> lastRead =
        DSL.field(
            DSL.select(DSL.max(MESSAGE.ID)).from(MESSAGE).where(MESSAGE.CHANNEL_ID.eq(channelId)));
    Field<Long> userId = DSL.field(DSL.name("cmgn", "user_id"), Long.class);
    return dsl.insertInto(
            CHANNEL_MEMBER,
            CHANNEL_MEMBER.CHANNEL_ID,
            CHANNEL_MEMBER.USER_ID,
            CHANNEL_MEMBER.ROLE,
            CHANNEL_MEMBER.DIRECT,
            CHANNEL_MEMBER.LAST_READ_MESSAGE_ID)
        .select(
            DSL.select(DSL.val(channelId), userId, DSL.val(GROUP_ROLE), DSL.val(false), lastRead)
                .from(userIds.asTable("cmgn", "user_id")))
        .onConflictDoNothing()
        .returning(CHANNEL_MEMBER.USER_ID)
        .fetch(CHANNEL_MEMBER.USER_ID);
  }

  /**
   * 부서로만 들어와 있던(direct=false·MEMBER) 사람 중 이제 부서로 걸리지 않거나 개인 제외된 사람의 행을 지운다 — 부서 행 제거·부서에서 빠짐·부서
   * 삭제/이동. 구성원 정지는 빼지 않는다 — 정지가 이미 접근을 막고, 행을 지우면 정지를 풀었을 때 읽은 위치·가입 시각이 처음으로 돌아간다(그래서 「걸리는 사람」은
   * 정지된 구성원까지 센다). 직접 멤버(direct=true)와 ADMIN/OWNER 행은 건드리지 않는다. 지운 사람 id 를 돌려준다. 채널에 부서 행이 하나도 없어도
   * 돈다 — 마지막 부서를 뺐을 때 남은 부서 사람 행을 정리해야 한다.
   */
  public List<Long> deleteUncovered(long channelId) {
    return dsl.deleteFrom(CHANNEL_MEMBER)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId))
        .and(CHANNEL_MEMBER.DIRECT.isFalse())
        .and(CHANNEL_MEMBER.ROLE.eq(GROUP_ROLE))
        .and(
            CHANNEL_MEMBER
                .USER_ID
                .notIn(coveredUserIds(channelId))
                .or(CHANNEL_MEMBER.USER_ID.in(excludedUserIds(channelId))))
        .returning(CHANNEL_MEMBER.USER_ID)
        .fetch(CHANNEL_MEMBER.USER_ID);
  }

  /**
   * 이 채널의 멤버 부서(와 하위 부서)에 걸리는 사람 — 정지·비활성 구성원도 걸린다(정지는 소속을 끊지 않는다), 개인 제외는 빼지 않는다. 남길 부서 사람 행·남길 개인
   * 제외의 기준.
   */
  private Select<Record1<Long>> coveredUserIds(long channelId) {
    SubtreeMembers m =
        Departments.subtreeMembers(
            "cmgk", groupIdsOf(channelId), null, MemberStatus.INCLUDING_INACTIVE);
    return DSL.selectDistinct(m.userId()).from(m.table());
  }

  /** 이 채널의 멤버 부서 id 부분 질의 — 공통 규칙의 출발 부서. */
  private static Select<Record1<Long>> groupIdsOf(long channelId) {
    return DSL.select(CHANNEL_MEMBER_GROUP.GROUP_ID)
        .from(CHANNEL_MEMBER_GROUP)
        .where(CHANNEL_MEMBER_GROUP.CHANNEL_ID.eq(channelId));
  }

  /** 이 채널의 개인 제외 사람 id 부분 질의. */
  private static Select<Record1<Long>> excludedUserIds(long channelId) {
    return DSL.select(CHANNEL_MEMBER_GROUP_EXCLUSION.USER_ID)
        .from(CHANNEL_MEMBER_GROUP_EXCLUSION)
        .where(CHANNEL_MEMBER_GROUP_EXCLUSION.CHANNEL_ID.eq(channelId));
  }
}
