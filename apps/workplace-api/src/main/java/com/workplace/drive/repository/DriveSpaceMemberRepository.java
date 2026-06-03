package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.USER;

import com.workplace.drive.dto.DriveMemberResponse;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** drive_space_member 접근. */
@Repository
@RequiredArgsConstructor
public class DriveSpaceMemberRepository {
  private final DSLContext dsl;

  /** 멤버 추가(이미 있으면 역할 갱신). */
  public void add(long spaceId, long userId, String role) {
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
        .set(DRIVE_SPACE_MEMBER.USER_ID, userId)
        .set(DRIVE_SPACE_MEMBER.ROLE, role)
        .onConflict(DRIVE_SPACE_MEMBER.SPACE_ID, DRIVE_SPACE_MEMBER.USER_ID)
        .doUpdate()
        .set(DRIVE_SPACE_MEMBER.ROLE, role)
        .execute();
  }

  public Optional<String> findRole(long spaceId, long userId) {
    return dsl.select(DRIVE_SPACE_MEMBER.ROLE)
        .from(DRIVE_SPACE_MEMBER)
        .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .and(DRIVE_SPACE_MEMBER.USER_ID.eq(userId))
        .fetchOptional(DRIVE_SPACE_MEMBER.ROLE);
  }

  public void changeRole(long spaceId, long userId, String role) {
    dsl.update(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.ROLE, role)
        .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .and(DRIVE_SPACE_MEMBER.USER_ID.eq(userId))
        .execute();
  }

  public void remove(long spaceId, long userId) {
    dsl.deleteFrom(DRIVE_SPACE_MEMBER)
        .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .and(DRIVE_SPACE_MEMBER.USER_ID.eq(userId))
        .execute();
  }

  public List<DriveMemberResponse> listMembers(long spaceId) {
    return dsl.select(DRIVE_SPACE_MEMBER.USER_ID, USER.NAME, DRIVE_SPACE_MEMBER.ROLE)
        .from(DRIVE_SPACE_MEMBER)
        .join(USER)
        .on(USER.ID.eq(DRIVE_SPACE_MEMBER.USER_ID))
        .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .orderBy(USER.NAME.asc())
        .fetch(
            r ->
                new DriveMemberResponse(
                    r.get(DRIVE_SPACE_MEMBER.USER_ID),
                    r.get(USER.NAME),
                    r.get(DRIVE_SPACE_MEMBER.ROLE)));
  }
}
