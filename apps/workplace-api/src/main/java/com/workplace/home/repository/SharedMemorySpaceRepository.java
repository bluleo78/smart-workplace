package com.workplace.home.repository;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.WIKI_SPACE;

import com.workplace.global.share.WikiSpaceMembership;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 공용 메모리 공간 조회(WP-386) — 프로젝트·노트 스페이스의 존재·유형·이름과, 사용자가 읽을 수 있는 공간 목록. 권한 판정은 SharedMemorySpaces 가
 * 하고 여기서는 재료만 읽는다. 프로젝트는 soft delete 를 거른다(ProjectRepository 와 같은 조건). 테넌트 트랜잭션 안에서 부른다(RLS).
 */
@Repository
@RequiredArgsConstructor
public class SharedMemorySpaceRepository {

  private final DSLContext dsl;

  /** 프로젝트 요약 — type 은 TEAM·OPEN·PERSONAL. */
  public record ProjectInfo(long id, String key, String name, String type) {}

  /** 노트 스페이스 요약 — type 은 TEAM·PERSONAL. */
  public record WikiInfo(long id, String name, String type) {}

  /** 프로젝트 + 조회 사용자의 프로젝트 구성원 역할(구성원이 아니면 null) — 공간별 역할 재조회를 없애려고 한 쿼리에 싣는다. */
  public record ProjectWithRole(ProjectInfo project, String role) {}

  /** 노트 스페이스 + 조회 사용자의 스페이스 역할(항상 구성원이라 null 이 아니다). */
  public record WikiWithRole(WikiInfo wiki, String role) {}

  /** 지워지지 않은 프로젝트. */
  public Optional<ProjectInfo> project(long id) {
    return dsl.select(PROJECT.ID, PROJECT.KEY, PROJECT.NAME, PROJECT.TYPE)
        .from(PROJECT)
        .where(PROJECT.ID.eq(id).and(PROJECT.DELETED_AT.isNull()))
        .fetchOptional(r -> new ProjectInfo(r.value1(), r.value2(), r.value3(), r.value4()));
  }

  /** 키로 지워지지 않은 프로젝트. */
  public Optional<ProjectInfo> projectByKey(String key) {
    return dsl.select(PROJECT.ID, PROJECT.KEY, PROJECT.NAME, PROJECT.TYPE)
        .from(PROJECT)
        .where(PROJECT.KEY.eq(key).and(PROJECT.DELETED_AT.isNull()))
        .fetchOptional(r -> new ProjectInfo(r.value1(), r.value2(), r.value3(), r.value4()));
  }

  /** 노트 스페이스. */
  public Optional<WikiInfo> wiki(long id) {
    return dsl.select(WIKI_SPACE.ID, WIKI_SPACE.NAME, WIKI_SPACE.TYPE)
        .from(WIKI_SPACE)
        .where(WIKI_SPACE.ID.eq(id))
        .fetchOptional(r -> new WikiInfo(r.value1(), r.value2(), r.value3()));
  }

  /**
   * 읽을 수 있는 TEAM·OPEN 프로젝트(이름순)와 사용자의 구성원 역할 — OPEN 은 누구나, TEAM 은 구성원 또는
   * ADMIN(ProjectAccessGuard.isReadable 과 같은 규칙, PERSONAL 은 대상이 아니다). 구성원 테이블을 LEFT JOIN 해 역할을 같이
   * 읽는다((project_id, user_id) 가 PK 라 행이 늘지 않는다).
   */
  public List<ProjectWithRole> readableProjects(long userId, boolean admin) {
    var readable =
        PROJECT
            .TYPE
            .eq("OPEN")
            .or(
                PROJECT
                    .TYPE
                    .eq("TEAM")
                    .and(admin ? DSL.trueCondition() : PROJECT_MEMBER.USER_ID.isNotNull()));
    return dsl.select(PROJECT.ID, PROJECT.KEY, PROJECT.NAME, PROJECT.TYPE, PROJECT_MEMBER.ROLE)
        .from(PROJECT)
        .leftJoin(PROJECT_MEMBER)
        .on(PROJECT_MEMBER.PROJECT_ID.eq(PROJECT.ID).and(PROJECT_MEMBER.USER_ID.eq(userId)))
        .where(PROJECT.DELETED_AT.isNull())
        .and(readable)
        .orderBy(PROJECT.NAME.asc(), PROJECT.ID.asc())
        .fetch(
            r ->
                new ProjectWithRole(
                    new ProjectInfo(r.value1(), r.value2(), r.value3(), r.value4()), r.value5()));
  }

  /**
   * 구성원인 TEAM 노트 스페이스(이름순)와 사용자의 스페이스 실효 역할 — 직접 멤버이거나 멤버로 둔 조직도 부서에 걸린 스페이스, 역할은 가장 높은 것(WP-1052,
   * 노트 화면과 같은 규칙).
   */
  public List<WikiWithRole> teamWikis(long userId) {
    return dsl.select(
            WIKI_SPACE.ID,
            WIKI_SPACE.NAME,
            WIKI_SPACE.TYPE,
            WikiSpaceMembership.effectiveRole(WIKI_SPACE.ID, DSL.val(userId)))
        .from(WIKI_SPACE)
        .where(WIKI_SPACE.TYPE.eq("TEAM"))
        .and(WikiSpaceMembership.isMember(WIKI_SPACE.ID, DSL.val(userId)))
        .orderBy(WIKI_SPACE.NAME.asc(), WIKI_SPACE.ID.asc())
        .fetch(r -> new WikiWithRole(new WikiInfo(r.value1(), r.value2(), r.value3()), r.value4()));
  }
}
