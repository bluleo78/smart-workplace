package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static com.workplace.jooq.Tables.WIKI_SPACE_MEMBER;

import com.workplace.wiki.dto.WikiMemberResponse;
import java.util.Collection;
import java.util.List;
import java.util.Map;
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

  /** 여러 사람의 그 스페이스 역할을 한 번에 읽는다 — 멤버가 아닌 사람은 빠진다(WP-988 스페이스 이동의 공유 유지 판정). */
  public Map<Long, String> findRoles(long spaceId, Collection<Long> userIds) {
    if (userIds.isEmpty()) {
      return Map.of();
    }
    return dsl.select(WIKI_SPACE_MEMBER.USER_ID, WIKI_SPACE_MEMBER.ROLE)
        .from(WIKI_SPACE_MEMBER)
        .where(WIKI_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .and(WIKI_SPACE_MEMBER.USER_ID.in(userIds))
        .fetchMap(WIKI_SPACE_MEMBER.USER_ID, WIKI_SPACE_MEMBER.ROLE);
  }

  /**
   * 역할을 잠가 읽는다(FOR SHARE, WP-579) — 진행 중인 강등·제거(이 행의 UPDATE·DELETE)가 있으면 그 커밋을 기다려 바뀐 값을 보고, 읽은 뒤엔
   * 이 트랜잭션이 끝날 때까지 강등·제거를 막는다. 공유 변경이 「강등된 사람 이름으로」 만들어지지 않게 하는 데 쓴다.
   */
  public Optional<String> findRoleForShare(long spaceId, long userId) {
    return dsl.select(WIKI_SPACE_MEMBER.ROLE)
        .from(WIKI_SPACE_MEMBER)
        .where(WIKI_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .and(WIKI_SPACE_MEMBER.USER_ID.eq(userId))
        .forShare()
        .fetchOptional(WIKI_SPACE_MEMBER.ROLE);
  }

  /**
   * 공간의 OWNER 멤버 행을 잠그고 그 사용자 id 를 돌려준다(WP-788). 「마지막 소유자」 판정을 이 잠근 집합으로 해야, 두 소유자가 서로를 동시에 강등·제거할
   * 때 나중 요청이 앞 요청의 커밋을 기다렸다가 줄어든 소유자로 판정한다 — 단순 COUNT 는 둘 다 커밋 전의 소유자 2명을 보고 통과해 소유자 0명이 됐다. 같은 행을
   * 잡는 순서가 엇갈려 교착하지 않게 user_id 순으로 잠근다.
   */
  public List<Long> lockOwnerIds(long spaceId) {
    return dsl.select(WIKI_SPACE_MEMBER.USER_ID)
        .from(WIKI_SPACE_MEMBER)
        .where(WIKI_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .and(WIKI_SPACE_MEMBER.ROLE.eq("OWNER"))
        .orderBy(WIKI_SPACE_MEMBER.USER_ID)
        .forUpdate()
        .fetch(WIKI_SPACE_MEMBER.USER_ID);
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

  /**
   * 이 사람이 멤버인 팀 스페이스 id 를 그 멤버 행을 잠그고(FOR UPDATE) 읽는다(WP-579, AGENT 삭제). 멤버 제거 경로와 같은 순서(멤버 행 → 공유
   * 행)로 잠그려고 공유 해제보다 먼저 부른다 — 동시에 그 멤버를 내보내는 요청과 서로 기다리는 교착이 생기지 않는다. 개인 스페이스는 멤버 변경 대상이 아니라 뺀다. 잠금
   * 순서가 요청마다 같도록 스페이스 id 순.
   */
  public List<Long> lockTeamSpaceIdsOf(long userId) {
    return dsl.select(WIKI_SPACE_MEMBER.SPACE_ID)
        .from(WIKI_SPACE_MEMBER)
        .join(WIKI_SPACE)
        .on(WIKI_SPACE.ID.eq(WIKI_SPACE_MEMBER.SPACE_ID))
        .where(WIKI_SPACE_MEMBER.USER_ID.eq(userId))
        .and(WIKI_SPACE.TYPE.eq("TEAM"))
        .orderBy(WIKI_SPACE_MEMBER.SPACE_ID)
        .forUpdate()
        .of(WIKI_SPACE_MEMBER)
        .fetch(WIKI_SPACE_MEMBER.SPACE_ID);
  }

  /** 스페이스 멤버 user id 목록 — SSE fan-out 대상(#724). */
  public List<Long> memberUserIds(long spaceId) {
    return dsl.select(WIKI_SPACE_MEMBER.USER_ID)
        .from(WIKI_SPACE_MEMBER)
        .where(WIKI_SPACE_MEMBER.SPACE_ID.eq(spaceId))
        .fetch(WIKI_SPACE_MEMBER.USER_ID);
  }

  /**
   * 원본 스페이스 멤버 중 대상 스페이스 멤버가 아닌 사람 수(WP-988) — 페이지를 옮기면 그 사람들은 멤버 자격으로는 더 볼 수 없다. 공유 링크로 보는 것은 따로
   * 판정된다. 인자를 뒤집으면(대상 기준) 옮긴 뒤 새로 보게 되는 사람 수가 된다.
   */
  public int countMissingFrom(long sourceSpaceId, long targetSpaceId) {
    return dsl.fetchCount(
        dsl.select(WIKI_SPACE_MEMBER.USER_ID)
            .from(WIKI_SPACE_MEMBER)
            .where(WIKI_SPACE_MEMBER.SPACE_ID.eq(sourceSpaceId))
            .and(
                WIKI_SPACE_MEMBER.USER_ID.notIn(
                    dsl.select(WIKI_SPACE_MEMBER.USER_ID)
                        .from(WIKI_SPACE_MEMBER)
                        .where(WIKI_SPACE_MEMBER.SPACE_ID.eq(targetSpaceId)))));
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
