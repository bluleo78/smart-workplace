package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.USER;

import com.workplace.drive.dto.DriveMemberResponse;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * drive_space_member 접근 + 공간 실효 멤버십(직접 + 조직도 부서, WP-1056) 조회. 마지막 소유자 보호({@link #lockOwnerIds})와 채널
 * 미러 동기화({@link #reconcileMembers})는 직접 멤버 행만 다룬다 — 부서 행은 OWNER 를 갖지 않고 채널 공간에는 부서 행을 두지 않는다.
 */
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

  /**
   * 공간 실효 멤버 userId(중복 없음) — 직접 멤버와 멤버로 둔 부서·하위 부서의 활성 사람 구성원(WP-1056). DRIVE_SPACE SSE 수신자·변경 알림의
   * 「바뀌기 전 명단」·공간 삭제 알림 대상. PERSONAL 공간도 소유자 OWNER 행이 있어 한 쿼리로 모든 유형을 커버한다.
   */
  public List<Long> audienceUserIds(long spaceId) {
    return dsl.fetch(DriveSpaceMembership.audienceUserIds(DSL.val(spaceId)))
        .getValues(0, Long.class);
  }

  /**
   * 사람의 공간 실효 역할(WP-1056) — 직접 멤버 역할과 멤버로 둔 조직도 부서(내 부서·상위 부서) 역할 중 가장 높은 것. 멤버가 아니면 empty. 권한
   * 판정({@code DrivePermissions})이 이 값을 쓴다.
   */
  public Optional<String> findRole(long spaceId, long userId) {
    // 직접 소유자면 부서가 더 높일 수 없다 — 모든 드라이브 요청이 거치는 판정이라 부서 트리 탐색을 건너뛴다.
    Optional<String> direct = findDirectRole(spaceId, userId);
    if (direct.filter("OWNER"::equals).isPresent()) {
      return direct;
    }
    return Optional.ofNullable(
        dsl.select(DriveSpaceMembership.effectiveRole(DSL.val(spaceId), DSL.val(userId)))
            .fetchOne(0, String.class));
  }

  /**
   * 직접 멤버 행의 역할만 — 멤버 관리(역할 변경 대상 확인, WP-667)용. 부서로만 들어온 사람은 empty — 직접 행이 없는 사람의 역할 변경이 0행 UPDATE
   * 로 성공처럼 보이지 않게.
   */
  public Optional<String> findDirectRole(long spaceId, long userId) {
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
