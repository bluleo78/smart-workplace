package com.workplace.contacts.repository;

import static com.workplace.jooq.Tables.CONTACT_FAVORITE;

import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * 즐겨찾기 쓰기 전용 리포지토리. 읽기(isFavorite 플래그·favorite 필터)는 ContactRepository 가 담당한다. owner 스코프는 owner_id
 * 로, tenant 격리는 RLS + tenant_id GUC DEFAULT 로 보장된다(애플리케이션은 tenant_id 미지정).
 */
@Repository
@RequiredArgsConstructor
public class FavoriteRepository {
  private final DSLContext dsl;

  /** 즐겨찾기 추가. PK 충돌(이미 즐겨찾기) 시 무시 → 멱등. */
  public void add(long ownerId, String targetType, long targetId) {
    dsl.insertInto(CONTACT_FAVORITE)
        .set(CONTACT_FAVORITE.OWNER_ID, ownerId)
        .set(CONTACT_FAVORITE.TARGET_TYPE, targetType)
        .set(CONTACT_FAVORITE.TARGET_ID, targetId)
        .onConflictDoNothing()
        .execute();
  }

  /** 즐겨찾기 해제. 해당 행이 없어도 영향 0행으로 정상 종료 → 멱등. */
  public void remove(long ownerId, String targetType, long targetId) {
    dsl.deleteFrom(CONTACT_FAVORITE)
        .where(CONTACT_FAVORITE.OWNER_ID.eq(ownerId))
        .and(CONTACT_FAVORITE.TARGET_TYPE.eq(targetType))
        .and(CONTACT_FAVORITE.TARGET_ID.eq(targetId))
        .execute();
  }
}
