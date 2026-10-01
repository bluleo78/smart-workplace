package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;

import org.jooq.DSLContext;

/**
 * WP-150 "나" 프로필·보낸 사람 관계 통합 테스트 공용 시드(테넌트#1, 세션 GUC). 그룹 이름은 형제 간 유니크라(V129) 호출부가 고유 접미사를 붙여 넘긴다.
 */
public final class MailPeopleFixtures {

  private MailPeopleFixtures() {}

  /** 사용자 user.email(전역 테이블). */
  public static String userEmail(DSLContext dsl, long userId) {
    return dsl.select(USER.EMAIL).from(USER).where(USER.ID.eq(userId)).fetchOne(USER.EMAIL);
  }

  /** 이름·직함을 바꾼다. */
  public static void setProfile(DSLContext dsl, long userId, String name, String title) {
    dsl.update(USER)
        .set(USER.NAME, name)
        .set(USER.TITLE, title)
        .where(USER.ID.eq(userId))
        .execute();
  }

  /** 같은 사용자의 메일 계정 하나 더(주소는 저장된 그대로 — 정규화는 조회 쪽 책임). */
  public static long addAccount(DSLContext dsl, long userId, String address, String displayName) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, address)
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, displayName)
        .set(EMAIL_ACCOUNT.TENANT_ID, 1L)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /** 공유 조직도 그룹 + MEMBER 멤버들. */
  public static long sharedGroup(DSLContext dsl, String name, long... memberUserIds) {
    long id =
        dsl.insertInto(USER_GROUP)
            .set(USER_GROUP.NAME, name)
            .set(USER_GROUP.VISIBILITY, "SHARED")
            .returning(USER_GROUP.ID)
            .fetchOne()
            .getId();
    addMembers(dsl, id, memberUserIds);
    return id;
  }

  /** ownerId 의 개인 그룹 + MEMBER 멤버들(내 소속으로 새면 안 되는 그룹). */
  public static long personalGroup(
      DSLContext dsl, long ownerId, String name, long... memberUserIds) {
    long id =
        dsl.insertInto(USER_GROUP)
            .set(USER_GROUP.NAME, name)
            .set(USER_GROUP.VISIBILITY, "PERSONAL")
            .set(USER_GROUP.OWNER_ID, ownerId)
            .returning(USER_GROUP.ID)
            .fetchOne()
            .getId();
    addMembers(dsl, id, memberUserIds);
    return id;
  }

  private static void addMembers(DSLContext dsl, long groupId, long... userIds) {
    for (long u : userIds) {
      dsl.insertInto(USER_GROUP_MEMBER)
          .set(USER_GROUP_MEMBER.GROUP_ID, groupId)
          .set(USER_GROUP_MEMBER.TARGET_TYPE, "MEMBER")
          .set(USER_GROUP_MEMBER.TARGET_ID, u)
          .execute();
    }
  }
}
