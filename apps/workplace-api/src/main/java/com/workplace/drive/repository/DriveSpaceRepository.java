package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;

import com.workplace.drive.dto.DriveSpaceResponse;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
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
   * callerId 가 볼 수 있는(멤버인) TEAM 공간 중 같은 이름이 있는지(대소문자 무시, #696). 볼 수 없는 공간까지 견주면 거절 여부로 남의 비공개 공간
   * 존재·이름이 드러난다(WP-693 — 채널 WP-590 과 같은 범위). excludeId 는 이름변경 시 자기 자신 제외용.
   */
  public boolean existsVisibleTeamSpaceName(String name, long callerId, Long excludeId) {
    var cond =
        DRIVE_SPACE
            .TYPE
            .eq("TEAM")
            .and(DSL.lower(DRIVE_SPACE.NAME).eq(name.toLowerCase()))
            .and(
                DSL.exists(
                    DSL.selectOne()
                        .from(DRIVE_SPACE_MEMBER)
                        .where(
                            DRIVE_SPACE_MEMBER
                                .SPACE_ID
                                .eq(DRIVE_SPACE.ID)
                                .and(DRIVE_SPACE_MEMBER.USER_ID.eq(callerId)))));
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

  /** 호출자 역할을 동봉해 단건 조회(멤버 아니면 empty). */
  public Optional<DriveSpaceResponse> findForUser(long spaceId, long userId) {
    return dsl.select(
            DRIVE_SPACE.ID,
            DRIVE_SPACE.TYPE,
            DRIVE_SPACE.NAME,
            DRIVE_SPACE.OWNER_ID,
            DRIVE_SPACE_MEMBER.ROLE,
            DRIVE_SPACE.ARCHIVED_AT,
            DRIVE_SPACE.CREATED_AT)
        .from(DRIVE_SPACE)
        .join(DRIVE_SPACE_MEMBER)
        .on(
            DRIVE_SPACE_MEMBER
                .SPACE_ID
                .eq(DRIVE_SPACE.ID)
                .and(DRIVE_SPACE_MEMBER.USER_ID.eq(userId)))
        .where(DRIVE_SPACE.ID.eq(spaceId))
        .fetchOptional(DriveSpaceRepository::map);
  }

  /** 호출자가 멤버인 모든 공간(개인 + 팀). 개인 공간 먼저, 그다음 이름순. */
  public List<DriveSpaceResponse> findMySpaces(long userId) {
    return dsl.select(
            DRIVE_SPACE.ID,
            DRIVE_SPACE.TYPE,
            DRIVE_SPACE.NAME,
            DRIVE_SPACE.OWNER_ID,
            DRIVE_SPACE_MEMBER.ROLE,
            DRIVE_SPACE.ARCHIVED_AT,
            DRIVE_SPACE.CREATED_AT)
        .from(DRIVE_SPACE)
        .join(DRIVE_SPACE_MEMBER)
        .on(
            DRIVE_SPACE_MEMBER
                .SPACE_ID
                .eq(DRIVE_SPACE.ID)
                .and(DRIVE_SPACE_MEMBER.USER_ID.eq(userId)))
        // 개인 공간(내 드라이브) 먼저, 그다음 팀 공간 이름순
        .orderBy(
            DSL.when(DRIVE_SPACE.TYPE.eq("PERSONAL"), DSL.inline(0)).otherwise(DSL.inline(1)),
            DRIVE_SPACE.NAME.asc())
        .fetch(DriveSpaceRepository::map);
  }

  static DriveSpaceResponse map(org.jooq.Record r) {
    return new DriveSpaceResponse(
        r.get(DRIVE_SPACE.ID),
        r.get(DRIVE_SPACE.TYPE),
        r.get(DRIVE_SPACE.NAME),
        r.get(DRIVE_SPACE.OWNER_ID),
        r.get(DRIVE_SPACE_MEMBER.ROLE),
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

  /** 공간 행 하드삭제 — drive_space_member/folder/file/version 이 FK CASCADE 로 자동 제거된다. */
  public void deleteSpace(long spaceId) {
    dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
  }
}
