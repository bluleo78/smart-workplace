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
        r.get(DRIVE_SPACE.CREATED_AT));
  }
}
