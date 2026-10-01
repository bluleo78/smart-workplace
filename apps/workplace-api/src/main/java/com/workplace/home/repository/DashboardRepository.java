package com.workplace.home.repository;

import static com.workplace.jooq.tables.UserDashboard.USER_DASHBOARD;

import com.workplace.home.dto.DashboardDevice;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** 사용자별 홈 대시보드 레이아웃(위젯 키 JSONB 배열) 저장/조회. 계정·기기당 1행, tenant RLS 격리. */
@Repository
@RequiredArgsConstructor
public class DashboardRepository {

  private final DSLContext dsl;

  /** userId·device 의 위젯 JSON 원문. 미설정이면 empty. 기기별 행은 서로 독립(WP-142). */
  public Optional<String> findWidgetsJson(long userId, DashboardDevice device) {
    return dsl.select(USER_DASHBOARD.WIDGETS)
        .from(USER_DASHBOARD)
        .where(USER_DASHBOARD.USER_ID.eq(userId))
        .and(USER_DASHBOARD.DEVICE.eq(device.name()))
        .fetchOptional(r -> r.get(USER_DASHBOARD.WIDGETS).data());
  }

  /**
   * 위젯 레이아웃 upsert. tenant_id 는 DB DEFAULT(GUC)로 채워지므로 직접 set 하지 않는다. 충돌(tenant_id, user_id,
   * device) 시 widgets/updated_at 만 갱신 — 다른 기기 행은 건드리지 않는다.
   */
  public void upsert(long userId, DashboardDevice device, String widgetsJson) {
    dsl.insertInto(USER_DASHBOARD)
        .set(USER_DASHBOARD.USER_ID, userId)
        .set(USER_DASHBOARD.DEVICE, device.name())
        .set(USER_DASHBOARD.WIDGETS, JSONB.valueOf(widgetsJson))
        .onConflict(USER_DASHBOARD.TENANT_ID, USER_DASHBOARD.USER_ID, USER_DASHBOARD.DEVICE)
        .doUpdate()
        .set(USER_DASHBOARD.WIDGETS, JSONB.valueOf(widgetsJson))
        .set(USER_DASHBOARD.UPDATED_AT, DSL.currentOffsetDateTime())
        .execute();
  }
}
