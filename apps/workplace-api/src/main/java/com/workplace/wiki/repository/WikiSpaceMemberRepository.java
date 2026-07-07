package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_SPACE_MEMBER;

import com.workplace.wiki.dto.WikiMemberResponse;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** wiki_space_member 접근. */
@Repository
@RequiredArgsConstructor
public class WikiSpaceMemberRepository {
  private final DSLContext dsl;

  public void add(long spaceId, long userId, String role) {
    dsl.insertInto(WIKI_SPACE_MEMBER)
        .set(WIKI_SPACE_MEMBER.SPACE_ID, spaceId)
        .set(WIKI_SPACE_MEMBER.USER_ID, userId)
        .set(WIKI_SPACE_MEMBER.ROLE, role)
        .onConflict(WIKI_SPACE_MEMBER.SPACE_ID, WIKI_SPACE_MEMBER.USER_ID)
        .doUpdate()
        .set(WIKI_SPACE_MEMBER.ROLE, role)
        .execute();
  }

  public Optional<String> findRole(long spaceId, long userId) {
    return dsl.select(WIKI_SPACE_MEMBER.ROLE)
        .from(WIKI_SPACE_MEMBER)
        .where(WIKI_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .and(WIKI_SPACE_MEMBER.USER_ID.eq(userId))
        .fetchOptional(WIKI_SPACE_MEMBER.ROLE);
  }

  public void changeRole(long spaceId, long userId, String role) {
    dsl.update(WIKI_SPACE_MEMBER)
        .set(WIKI_SPACE_MEMBER.ROLE, role)
        .where(WIKI_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .and(WIKI_SPACE_MEMBER.USER_ID.eq(userId))
        .execute();
  }

  public void remove(long spaceId, long userId) {
    dsl.deleteFrom(WIKI_SPACE_MEMBER)
        .where(WIKI_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .and(WIKI_SPACE_MEMBER.USER_ID.eq(userId))
        .execute();
  }

  /** 스페이스 멤버 user id 목록 — SSE fan-out 대상(#724). */
  public List<Long> memberUserIds(long spaceId) {
    return dsl.select(WIKI_SPACE_MEMBER.USER_ID)
        .from(WIKI_SPACE_MEMBER)
        .where(WIKI_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .fetch(WIKI_SPACE_MEMBER.USER_ID);
  }

  public List<WikiMemberResponse> listMembers(long spaceId) {
    return dsl.select(WIKI_SPACE_MEMBER.USER_ID, USER.NAME, WIKI_SPACE_MEMBER.ROLE)
        .from(WIKI_SPACE_MEMBER)
        .join(USER)
        .on(USER.ID.eq(WIKI_SPACE_MEMBER.USER_ID))
        .where(WIKI_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .orderBy(USER.NAME.asc())
        .fetch(
            r ->
                new WikiMemberResponse(
                    r.get(WIKI_SPACE_MEMBER.USER_ID),
                    r.get(USER.NAME),
                    r.get(WIKI_SPACE_MEMBER.ROLE)));
  }
}
