package com.workplace.project.repository;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_FAVORITE;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * 프로젝트 즐겨찾기(WP-1001) 리포지토리. 사용자 스코프는 user_id 로, 테넌트 격리는 RLS + tenant_id GUC DEFAULT 로 보장된다(애플리케이션은
 * tenant_id 를 넣지 않는다 — 연락처 즐겨찾기와 같은 방식).
 */
@Repository
@RequiredArgsConstructor
public class ProjectFavoriteRepository {
  private final DSLContext dsl;

  /** 내 즐겨찾기 프로젝트 id — 즐겨찾기한 순서. soft-deleted 프로젝트는 뺀다. */
  public List<Long> findProjectIds(long userId) {
    return dsl.select(PROJECT_FAVORITE.PROJECT_ID)
        .from(PROJECT_FAVORITE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(PROJECT_FAVORITE.PROJECT_ID))
        .where(PROJECT_FAVORITE.USER_ID.eq(userId).and(PROJECT.DELETED_AT.isNull()))
        .orderBy(PROJECT_FAVORITE.CREATED_AT, PROJECT_FAVORITE.PROJECT_ID)
        .fetch(PROJECT_FAVORITE.PROJECT_ID);
  }

  /** 즐겨찾기 추가. 이미 있으면 무시 → 멱등. */
  public void add(long userId, long projectId) {
    dsl.insertInto(PROJECT_FAVORITE)
        .set(PROJECT_FAVORITE.USER_ID, userId)
        .set(PROJECT_FAVORITE.PROJECT_ID, projectId)
        .onConflictDoNothing()
        .execute();
  }

  /** 즐겨찾기 해제. 행이 없어도 영향 0행으로 정상 종료 → 멱등. */
  public void remove(long userId, long projectId) {
    dsl.deleteFrom(PROJECT_FAVORITE)
        .where(PROJECT_FAVORITE.USER_ID.eq(userId))
        .and(PROJECT_FAVORITE.PROJECT_ID.eq(projectId))
        .execute();
  }
}
