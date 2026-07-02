package com.workplace.home.repository;

import static com.workplace.jooq.tables.UserPriorityItem.USER_PRIORITY_ITEM;

import com.workplace.home.dto.PriorityItemRow;
import java.util.List;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * user_priority_item 테이블 jOOQ 접근. tenant_id 는 INSERT 시 GUC DEFAULT(app.tenant_id)가 자동으로 채운다(V105
 * issue_ai_summary 패턴). RLS FORCE 로 GUC 주입된 트랜잭션 안에서만 읽기/쓰기 가능.
 */
@Repository
public class PriorityItemRepository {

  private final DSLContext dsl;

  public PriorityItemRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /**
   * 사용자의 우선순위 항목을 이번 배치 결과로 전량 교체한다. 기존 행 중 이번 후보 집합 {@code (sourceType, sourceId)}에 없는 것은 삭제(완료·읽음
   * 처리된 항목 정리), 나머지는 upsert.
   *
   * @param userId 대상 사용자
   * @param items 이번 배치의 후보별 점수(빈 리스트면 후보가 하나도 없다는 뜻 — 전량 삭제)
   */
  public void replaceForUser(long userId, List<PriorityItemRow> items) {
    if (items.isEmpty()) {
      dsl.deleteFrom(USER_PRIORITY_ITEM).where(USER_PRIORITY_ITEM.USER_ID.eq(userId)).execute();
      return;
    }
    List<String> keptKeys = items.stream().map(i -> i.sourceType() + ":" + i.sourceId()).toList();
    dsl.deleteFrom(USER_PRIORITY_ITEM)
        .where(USER_PRIORITY_ITEM.USER_ID.eq(userId))
        .and(
            USER_PRIORITY_ITEM
                .SOURCE_TYPE
                .concat(":")
                .concat(USER_PRIORITY_ITEM.SOURCE_ID)
                .notIn(keptKeys))
        .execute();
    for (PriorityItemRow item : items) {
      dsl.insertInto(USER_PRIORITY_ITEM)
          .set(USER_PRIORITY_ITEM.USER_ID, userId)
          .set(USER_PRIORITY_ITEM.SOURCE_TYPE, item.sourceType())
          .set(USER_PRIORITY_ITEM.SOURCE_ID, item.sourceId())
          .set(USER_PRIORITY_ITEM.TITLE, item.title())
          .set(USER_PRIORITY_ITEM.DEEP_LINK, item.deepLink())
          .set(USER_PRIORITY_ITEM.IMPORTANCE_SCORE, (short) item.importanceScore())
          .set(USER_PRIORITY_ITEM.URGENCY_SCORE, (short) item.urgencyScore())
          .set(USER_PRIORITY_ITEM.REASON, item.reason())
          .onConflict(
              USER_PRIORITY_ITEM.TENANT_ID,
              USER_PRIORITY_ITEM.USER_ID,
              USER_PRIORITY_ITEM.SOURCE_TYPE,
              USER_PRIORITY_ITEM.SOURCE_ID)
          .doUpdate()
          .set(USER_PRIORITY_ITEM.TITLE, item.title())
          .set(USER_PRIORITY_ITEM.DEEP_LINK, item.deepLink())
          .set(USER_PRIORITY_ITEM.IMPORTANCE_SCORE, (short) item.importanceScore())
          .set(USER_PRIORITY_ITEM.URGENCY_SCORE, (short) item.urgencyScore())
          .set(USER_PRIORITY_ITEM.REASON, item.reason())
          .set(USER_PRIORITY_ITEM.COMPUTED_AT, org.jooq.impl.DSL.currentOffsetDateTime())
          .execute();
    }
  }

  /**
   * 사용자의 저장된 우선순위 항목 전체 조회(정렬 없음 — 호출부가 필요에 맞게 정렬).
   *
   * @param userId 대상 사용자
   * @return 저장된 항목 목록(없으면 빈 리스트)
   */
  public List<PriorityItemRow> findForUser(long userId) {
    return dsl.selectFrom(USER_PRIORITY_ITEM)
        .where(USER_PRIORITY_ITEM.USER_ID.eq(userId))
        .fetch(
            r ->
                new PriorityItemRow(
                    r.getSourceType(),
                    r.getSourceId(),
                    r.getTitle(),
                    r.getDeepLink(),
                    r.getImportanceScore(),
                    r.getUrgencyScore(),
                    r.getReason()));
  }
}
