package com.workplace.home.repository;

import static com.workplace.jooq.tables.UserDashboard.USER_DASHBOARD;

import com.workplace.home.dto.DashboardDevice;
import com.workplace.jooq.tables.records.UserDashboardRecord;
import java.util.Optional;
import java.util.OptionalLong;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.InsertOnConflictDoUpdateStep;
import org.jooq.JSONB;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** 사용자별 홈 대시보드 레이아웃(위젯 키 JSONB 배열) 저장/조회. 계정·기기당 1행, tenant RLS 격리. */
@Repository
@RequiredArgsConstructor
public class DashboardRepository {

  private final DSLContext dsl;

  /** 저장된 레이아웃 — 위젯 JSON 원문과 낙관적 동시성 version(WP-1953). */
  public record StoredLayout(String widgetsJson, long version) {}

  /** userId·device 의 저장 레이아웃. 미설정이면 empty. 기기별 행은 서로 독립(WP-142). */
  public Optional<StoredLayout> find(long userId, DashboardDevice device) {
    return dsl.select(USER_DASHBOARD.WIDGETS, USER_DASHBOARD.VERSION)
        .from(USER_DASHBOARD)
        .where(USER_DASHBOARD.USER_ID.eq(userId))
        .and(USER_DASHBOARD.DEVICE.eq(device.name()))
        .fetchOptional(
            r ->
                new StoredLayout(
                    r.get(USER_DASHBOARD.WIDGETS).data(), r.get(USER_DASHBOARD.VERSION)));
  }

  /**
   * 위젯 레이아웃 upsert(version 검사 없음 — 옛 호출·롤링 배포 호환). tenant_id 는 DB DEFAULT(GUC)로 채워지므로 직접 set 하지
   * 않는다. 충돌(tenant_id, user_id, device) 시 widgets/updated_at 만 갱신하고 version 을 1 올린다 — 다른 기기 행은 건드리지
   * 않는다.
   *
   * @return 저장 뒤 version(새 행이면 1)
   */
  public long upsert(long userId, DashboardDevice device, String widgetsJson) {
    return insertFirst(userId, device, widgetsJson)
        .doUpdate()
        .set(USER_DASHBOARD.WIDGETS, JSONB.valueOf(widgetsJson))
        .set(USER_DASHBOARD.VERSION, USER_DASHBOARD.VERSION.plus(1L))
        .set(USER_DASHBOARD.UPDATED_AT, DSL.currentOffsetDateTime())
        .returning(USER_DASHBOARD.VERSION)
        .fetchOne()
        .getVersion();
  }

  /**
   * 읽은 version 일 때만 저장(조건부 저장, WP-1953). 먼저 {@code UPDATE … WHERE version = expected} 로 갱신하고, 행이 없고
   * expected 가 0(행 없음의 GET version)이면 {@code INSERT … ON CONFLICT DO NOTHING} 으로 첫 행을 만든다. 동시에 온 두
   * 첫 저장은 유니크 키에서 하나만 넣어 지고, 진 쪽은 0행이라 empty 다.
   *
   * @return 저장 뒤 새 version. version 이 달라졌거나(또는 행이 이미 있어 첫 저장이 졌으면) empty
   */
  public OptionalLong saveIfVersion(
      long userId, DashboardDevice device, String widgetsJson, long expected) {
    var updated =
        dsl.update(USER_DASHBOARD)
            .set(USER_DASHBOARD.WIDGETS, JSONB.valueOf(widgetsJson))
            .set(USER_DASHBOARD.VERSION, USER_DASHBOARD.VERSION.plus(1L))
            .set(USER_DASHBOARD.UPDATED_AT, DSL.currentOffsetDateTime())
            .where(USER_DASHBOARD.USER_ID.eq(userId))
            .and(USER_DASHBOARD.DEVICE.eq(device.name()))
            .and(USER_DASHBOARD.VERSION.eq(expected))
            .returning(USER_DASHBOARD.VERSION)
            .fetchOne();
    if (updated != null) {
      return OptionalLong.of(updated.getVersion());
    }
    if (expected != 0L) {
      return OptionalLong.empty();
    }
    var inserted =
        insertFirst(userId, device, widgetsJson)
            .doNothing()
            .returning(USER_DASHBOARD.VERSION)
            .fetchOne();
    return inserted == null ? OptionalLong.empty() : OptionalLong.of(inserted.getVersion());
  }

  /**
   * 첫 행 INSERT(version 1)에 유니크 키 충돌 절까지 붙인 공통 앞부분 — upsert 는 doUpdate, 조건부 첫 저장은 doNothing 으로 이어
   * 쓴다. tenant_id 는 DB DEFAULT(GUC)로 채워진다.
   */
  private InsertOnConflictDoUpdateStep<UserDashboardRecord> insertFirst(
      long userId, DashboardDevice device, String widgetsJson) {
    return dsl.insertInto(USER_DASHBOARD)
        .set(USER_DASHBOARD.USER_ID, userId)
        .set(USER_DASHBOARD.DEVICE, device.name())
        .set(USER_DASHBOARD.WIDGETS, JSONB.valueOf(widgetsJson))
        .set(USER_DASHBOARD.VERSION, 1L)
        .onConflict(USER_DASHBOARD.TENANT_ID, USER_DASHBOARD.USER_ID, USER_DASHBOARD.DEVICE);
  }
}
