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

  /** 스페이스 멤버 userId — DRIVE_SPACE SSE 수신자. PERSONAL 스페이스도 소유자 OWNER 행이 있어 한 쿼리로 모든 유형을 커버한다. */
  public List<Long> memberUserIds(long spaceId) {
    return dsl.select(DRIVE_SPACE_MEMBER.USER_ID)
        .from(DRIVE_SPACE_MEMBER)
        .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .fetch(DRIVE_SPACE_MEMBER.USER_ID);
  }

  public Optional<String> findRole(long spaceId, long userId) {
    return dsl.select(DRIVE_SPACE_MEMBER.ROLE)
        .from(DRIVE_SPACE_MEMBER)
        .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .and(DRIVE_SPACE_MEMBER.USER_ID.eq(userId))
        .fetchOptional(DRIVE_SPACE_MEMBER.ROLE);
  }

  /**
   * 공간의 OWNER 멤버 행을 잠그고 그 사용자 id 를 돌려준다(WP-788). 「마지막 소유자」 판정을 이 잠근 집합으로 해야, 두 소유자가 서로를 동시에 강등·제거할
   * 때 나중 요청이 앞 요청의 커밋을 기다렸다가 줄어든 소유자로 판정한다 — 단순 COUNT 는 둘 다 커밋 전의 소유자 2명을 보고 통과해 소유자 0명이 됐다. 같은 행을
   * 잡는 순서가 엇갈려 교착하지 않게 user_id 순으로 잠근다.
   */
  public List<Long> lockOwnerIds(long spaceId) {
    return dsl.select(DRIVE_SPACE_MEMBER.USER_ID)
        .from(DRIVE_SPACE_MEMBER)
        .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .and(DRIVE_SPACE_MEMBER.ROLE.eq("OWNER"))
        .orderBy(DRIVE_SPACE_MEMBER.USER_ID)
        .forUpdate()
        .fetch(DRIVE_SPACE_MEMBER.USER_ID);
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

  /**
   * 공간 멤버를 roster 로 reconcile — roster 의 (userId→role) 을 upsert 하고, roster 에 없는 기존 멤버는 제거. 순수 채널 미러
   * 동기화용. 멱등.
   */
  public void reconcileMembers(long spaceId, java.util.Map<Long, String> roleByUser) {
    for (var e : roleByUser.entrySet()) {
      add(spaceId, e.getKey(), e.getValue()); // 기존 add = upsert(ON CONFLICT DO UPDATE role)
    }
    if (roleByUser.isEmpty()) {
      dsl.deleteFrom(DRIVE_SPACE_MEMBER).where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId)).execute();
    } else {
      dsl.deleteFrom(DRIVE_SPACE_MEMBER)
          .where(DRIVE_SPACE_MEMBER.SPACE_ID.eq(spaceId))
          .and(DRIVE_SPACE_MEMBER.USER_ID.notIn(roleByUser.keySet()))
          .execute();
    }
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
