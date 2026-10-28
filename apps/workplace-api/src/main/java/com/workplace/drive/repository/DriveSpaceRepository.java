package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_SPACE;

import com.workplace.drive.dto.DriveSpaceResponse;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** drive_space 접근. */
@Repository
@RequiredArgsConstructor
public class DriveSpaceRepository {
  private final DSLContext dsl;

  public long insert(String type, String name, long ownerId) {
    return dsl.insertInto(DRIVE_SPACE)
        .set(DRIVE_SPACE.TYPE, type)
        .set(DRIVE_SPACE.NAME, name)
        .set(DRIVE_SPACE.OWNER_ID, ownerId)
        .returning(DRIVE_SPACE.ID)
        .fetchOne()
        .getId();
  }

  private static final int TEAM_NAME_LOCK_CLASS = 772;

  /**
   * 같은 이름의 TEAM 공간 만들기·이름 바꾸기를 차례로 세우는 잠금(WP-772, 트랜잭션 종료 시 해제). WP-693 이 「볼 수 있는 공간끼리만」 이름을 견주려고
   * 유니크 인덱스를 내리고 서비스 검사만 남겨, 같은 이름의 동시 요청이 모두 검사를 통과했다. 이름 검사 전에 잡으면 늦은 쪽이 앞선 쪽 커밋 뒤의 공간을 보고 거절된다.
   * 키는 검사와 같은 대소문자 무시 이름 — 다른 이름끼리는 기다리지 않는다. classId 는 이슈 번호 관례.
   */
  public void lockTeamSpaceName(String name) {
    dsl.execute(
        "SELECT pg_advisory_xact_lock(?, hashtext(?))", TEAM_NAME_LOCK_CLASS, name.toLowerCase());
  }

  /**
   * callerId 가 볼 수 있는(실효 멤버인 — 직접 또는 조직도 부서, WP-1056) TEAM 공간 중 같은 이름이 있는지(대소문자 무시, #696). 볼 수 없는
   * 공간까지 견주면 거절 여부로 남의 비공개 공간 존재·이름이 드러난다(WP-693 — 채널 WP-590 과 같은 범위). 부서로만 들어온 공간도 내 목록에 보이므로 함께
   * 견준다 — 같은 이름 두 개가 내 목록에 나란히 서지 않게. excludeId 는 이름변경 시 자기 자신 제외용.
   */
  public boolean existsVisibleTeamSpaceName(String name, long callerId, Long excludeId) {
    var cond =
        DRIVE_SPACE
            .TYPE
            .eq("TEAM")
            .and(DSL.lower(DRIVE_SPACE.NAME).eq(name.toLowerCase()))
            .and(DriveSpaceMembership.isMember(DRIVE_SPACE.ID, DSL.val(callerId)));
    if (excludeId != null) {
      cond = cond.and(DRIVE_SPACE.ID.ne(excludeId));
    }
    return dsl.fetchExists(dsl.selectOne().from(DRIVE_SPACE).where(cond));
  }

  public Optional<Long> findPersonalSpaceId(long ownerId) {
    return dsl.select(DRIVE_SPACE.ID)
        .from(DRIVE_SPACE)
        .where(DRIVE_SPACE.TYPE.eq("PERSONAL"))
        .and(DRIVE_SPACE.OWNER_ID.eq(ownerId))
        .fetchOptional(DRIVE_SPACE.ID);
  }

  public boolean exists(long spaceId) {
    return dsl.fetchExists(dsl.selectOne().from(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)));
  }

  /** 실효 역할 열의 이름 — 목록·단건 조회가 같은 이름으로 읽는다. */
  private static final String ROLE = "role";

  /** 호출자 실효 역할(직접 + 조직도 부서 중 가장 높은 것, WP-1056)을 동봉해 단건 조회(멤버 아니면 empty). */
  public Optional<DriveSpaceResponse> findForUser(long spaceId, long userId) {
    Field<String> effective = DriveSpaceMembership.effectiveRole(DRIVE_SPACE.ID, DSL.val(userId));
    Field<String> role = effective.as(ROLE);
    return dsl.select(
            DRIVE_SPACE.ID,
            DRIVE_SPACE.TYPE,
            DRIVE_SPACE.NAME,
            DRIVE_SPACE.OWNER_ID,
            role,
            DRIVE_SPACE.ARCHIVED_AT,
            DRIVE_SPACE.CREATED_AT)
        .from(DRIVE_SPACE)
        .where(DRIVE_SPACE.ID.eq(spaceId))
        // 실효 역할이 없으면 멤버가 아니다 — 멤버십 판정을 한 번만 돈다.
        .and(effective.isNotNull())
        .fetchOptional(DriveSpaceRepository::map);
  }

  /**
   * 호출자가 (실효) 멤버인 모든 공간(개인 + 팀 + 채널). 개인 공간 먼저, 그다음 이름순. 직접 멤버이거나 멤버로 둔 조직도 부서에 걸린 공간(WP-1056) —
   * 양쪽에 걸려도 한 번만, 역할은 가장 높은 것. 조인 대신 조건으로 걸러 행이 겹치지 않는다.
   */
  public List<DriveSpaceResponse> findMySpaces(long userId) {
    Field<String> role =
        DriveSpaceMembership.effectiveRole(DRIVE_SPACE.ID, DSL.val(userId)).as(ROLE);
    return dsl.select(
            DRIVE_SPACE.ID,
            DRIVE_SPACE.TYPE,
            DRIVE_SPACE.NAME,
            DRIVE_SPACE.OWNER_ID,
            role,
            DRIVE_SPACE.ARCHIVED_AT,
            DRIVE_SPACE.CREATED_AT)
        .from(DRIVE_SPACE)
        // 내가 들어 있는 공간 id 집합(직접·부서)으로 거른다 — 행마다 EXISTS 를 두 번 도는 대신 한 번 만든 집합을 쓴다(사이드바가 자주 부른다).
        .where(DRIVE_SPACE.ID.in(DriveSpaceMembership.spaceIdsOf(DSL.val(userId))))
        // 개인 공간(내 드라이브) 먼저, 그다음 팀 공간 이름순
        .orderBy(
            DSL.when(DRIVE_SPACE.TYPE.eq("PERSONAL"), DSL.inline(0)).otherwise(DSL.inline(1)),
            DRIVE_SPACE.NAME.asc())
        .fetch(DriveSpaceRepository::map);
  }

  /** 공간 행 + 실효 역할 열({@link #ROLE}) → 응답. */
  static DriveSpaceResponse map(org.jooq.Record r) {
    return new DriveSpaceResponse(
        r.get(DRIVE_SPACE.ID),
        r.get(DRIVE_SPACE.TYPE),
        r.get(DRIVE_SPACE.NAME),
        r.get(DRIVE_SPACE.OWNER_ID),
        r.get(ROLE, String.class),
        r.get(DRIVE_SPACE.ARCHIVED_AT) != null,
        r.get(DRIVE_SPACE.CREATED_AT));
  }

  /** 채널 링크로 연동 공간 id 조회. */
  public Optional<Long> findIdByLinkedChannel(long channelId) {
    return dsl.select(DRIVE_SPACE.ID)
        .from(DRIVE_SPACE)
        .where(DRIVE_SPACE.LINKED_CHANNEL_ID.eq(channelId))
        .and(DRIVE_SPACE.TYPE.eq("CHANNEL"))
        .fetchOptional(DRIVE_SPACE.ID);
  }

  /**
   * 채널 연동 공간 생성(type=CHANNEL). 동시 첫 진입 경쟁 시 ON CONFLICT DO NOTHING 으로 unique 위반 대신 빈 Optional
   * 반환(트랜잭션 비오염) — 충돌이면 호출측이 findIdByLinkedChannel 로 기존 공간 재조회.
   */
  public java.util.Optional<Long> insertChannelSpace(String name, long ownerId, long channelId) {
    return dsl.insertInto(DRIVE_SPACE)
        .set(DRIVE_SPACE.TYPE, "CHANNEL")
        .set(DRIVE_SPACE.NAME, name)
        .set(DRIVE_SPACE.OWNER_ID, ownerId)
        .set(DRIVE_SPACE.LINKED_CHANNEL_ID, channelId)
        .onConflict(DRIVE_SPACE.LINKED_CHANNEL_ID)
        .where(DRIVE_SPACE.TYPE.eq("CHANNEL"))
        .doNothing()
        .returning(DRIVE_SPACE.ID)
        .fetchOptional()
        .map(r -> r.get(DRIVE_SPACE.ID));
  }

  /** 공간 보관 여부(archived_at != null). */
  public boolean isArchived(long spaceId) {
    return dsl.select(DRIVE_SPACE.ARCHIVED_AT)
        .from(DRIVE_SPACE)
        .where(DRIVE_SPACE.ID.eq(spaceId))
        .fetchOptional(DRIVE_SPACE.ARCHIVED_AT)
        .map(java.util.Objects::nonNull)
        .orElse(false);
  }

  /** 공간 보관 토글 — true 면 archived_at=NOW(), false 면 NULL. */
  public void setArchived(long spaceId, boolean archived) {
    dsl.update(DRIVE_SPACE)
        .set(
            DRIVE_SPACE.ARCHIVED_AT,
            archived ? java.time.OffsetDateTime.now() : (java.time.OffsetDateTime) null)
        .where(DRIVE_SPACE.ID.eq(spaceId))
        .execute();
  }

  /** 공간 타입(PERSONAL/TEAM/CHANNEL) 조회 — rename/delete 타입 가드용. */
  public java.util.Optional<String> findType(long spaceId) {
    return dsl.select(DRIVE_SPACE.TYPE)
        .from(DRIVE_SPACE)
        .where(DRIVE_SPACE.ID.eq(spaceId))
        .fetchOptional(DRIVE_SPACE.TYPE);
  }

  /** 공간 이름 변경. */
  public void rename(long spaceId, String name) {
    dsl.update(DRIVE_SPACE).set(DRIVE_SPACE.NAME, name).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
  }

  /** 공간 행 하드삭제 — drive_space_member(_group)/folder/file/version 이 FK CASCADE 로 자동 제거된다. */
  public void deleteSpace(long spaceId) {
    dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
  }
}
