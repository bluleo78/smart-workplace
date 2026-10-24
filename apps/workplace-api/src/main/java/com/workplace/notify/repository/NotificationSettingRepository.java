package com.workplace.notify.repository;

import static com.workplace.jooq.Tables.NOTIFICATION_APP_SETTING;
import static com.workplace.jooq.Tables.NOTIFICATION_SETTING;

import com.workplace.notify.dto.NotificationActor;
import com.workplace.notify.dto.NotificationApp;
import com.workplace.notify.dto.NotificationSettingItem;
import java.util.Arrays;
import java.util.Collection;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * notification_setting(칸)·notification_app_setting(앱 스위치) 접근. 둘 다 사용자 단위 글로벌(비-RLS) 테이블이라 테넌트 GUC
 * 없이도 동작한다. 사용자가 바꾼 값만 저장되므로 조회 결과에 없는 칸·앱은 호출측이 기본값으로 채운다. DB 의 문자열이 코드 enum 에 없으면(항목을 지운 뒤 남은 행
 * 등) 예외로 500 을 내지 않고 건너뛴다.
 */
@Repository
@RequiredArgsConstructor
public class NotificationSettingRepository {

  private final DSLContext dsl;

  /** 칸 키 — (항목, 행위자 열). */
  public record CellKey(NotificationSettingItem item, NotificationActor actor) {}

  /** 사용자가 저장한 앱 스위치(저장 안 한 앱은 결과에 없음 = 켜짐). */
  public Map<NotificationApp, Boolean> findApps(long userId) {
    Map<NotificationApp, Boolean> out = new EnumMap<>(NotificationApp.class);
    dsl.select(NOTIFICATION_APP_SETTING.APP, NOTIFICATION_APP_SETTING.ENABLED)
        .from(NOTIFICATION_APP_SETTING)
        .where(NOTIFICATION_APP_SETTING.USER_ID.eq(userId))
        .forEach(
            r ->
                parse(NotificationApp.class, r.get(NOTIFICATION_APP_SETTING.APP))
                    .ifPresent(app -> out.put(app, r.get(NOTIFICATION_APP_SETTING.ENABLED))));
    return out;
  }

  /** 사용자가 저장한 칸(저장 안 한 칸은 결과에 없음 = 기본값). */
  public Map<CellKey, Boolean> findCells(long userId) {
    Map<CellKey, Boolean> out = new HashMap<>();
    dsl.select(NOTIFICATION_SETTING.ITEM, NOTIFICATION_SETTING.ACTOR, NOTIFICATION_SETTING.ENABLED)
        .from(NOTIFICATION_SETTING)
        .where(NOTIFICATION_SETTING.USER_ID.eq(userId))
        .forEach(
            r -> {
              Optional<NotificationSettingItem> item =
                  parse(NotificationSettingItem.class, r.get(NOTIFICATION_SETTING.ITEM));
              Optional<NotificationActor> actor =
                  parse(NotificationActor.class, r.get(NOTIFICATION_SETTING.ACTOR));
              if (item.isPresent() && actor.isPresent()) {
                out.put(new CellKey(item.get(), actor.get()), r.get(NOTIFICATION_SETTING.ENABLED));
              }
            });
    return out;
  }

  /** (사용자, 앱) 스위치 저장. 기본값(켜짐)과 같으면 행을 지운다 — DB 에는 사용자가 바꾼 값만 남겨야 저장 안 한 사용자가 기본값을 따른다(스펙 §4). */
  public void upsertApp(long userId, NotificationApp app, boolean enabled) {
    if (enabled) {
      dsl.deleteFrom(NOTIFICATION_APP_SETTING)
          .where(NOTIFICATION_APP_SETTING.USER_ID.eq(userId))
          .and(NOTIFICATION_APP_SETTING.APP.eq(app.name()))
          .execute();
      return;
    }
    dsl.insertInto(NOTIFICATION_APP_SETTING)
        .set(NOTIFICATION_APP_SETTING.USER_ID, userId)
        .set(NOTIFICATION_APP_SETTING.APP, app.name())
        .set(NOTIFICATION_APP_SETTING.ENABLED, enabled)
        .onConflict(NOTIFICATION_APP_SETTING.USER_ID, NOTIFICATION_APP_SETTING.APP)
        .doUpdate()
        .set(NOTIFICATION_APP_SETTING.ENABLED, enabled)
        .execute();
  }

  /**
   * (사용자, 항목, 행위자) 칸 저장. 그 칸의 코드 기본값과 같으면 행을 지우고, 다르면 upsert 한다 — 껐다가 다시 켠 사용자에게 행이 남으면 나중에 기본값을
   * 바꿔도 그 사용자에게 반영되지 않기 때문이다(스펙 §4 「DB 에는 사용자가 바꾼 값만 저장」).
   */
  public void upsertCell(
      long userId, NotificationSettingItem item, NotificationActor actor, boolean enabled) {
    if (enabled == item.defaultFor(actor)) {
      dsl.deleteFrom(NOTIFICATION_SETTING)
          .where(NOTIFICATION_SETTING.USER_ID.eq(userId))
          .and(NOTIFICATION_SETTING.ITEM.eq(item.name()))
          .and(NOTIFICATION_SETTING.ACTOR.eq(actor.name()))
          .execute();
      return;
    }
    dsl.insertInto(NOTIFICATION_SETTING)
        .set(NOTIFICATION_SETTING.USER_ID, userId)
        .set(NOTIFICATION_SETTING.ITEM, item.name())
        .set(NOTIFICATION_SETTING.ACTOR, actor.name())
        .set(NOTIFICATION_SETTING.ENABLED, enabled)
        .onConflict(
            NOTIFICATION_SETTING.USER_ID, NOTIFICATION_SETTING.ITEM, NOTIFICATION_SETTING.ACTOR)
        .doUpdate()
        .set(NOTIFICATION_SETTING.ENABLED, enabled)
        .execute();
  }

  /** 주어진 사용자 중 그 앱 전체를 끈 사용자 집합. */
  public Set<Long> findAppDisabledUsers(Collection<Long> userIds, NotificationApp app) {
    if (userIds.isEmpty()) return Set.of();
    return new HashSet<>(
        dsl.select(NOTIFICATION_APP_SETTING.USER_ID)
            .from(NOTIFICATION_APP_SETTING)
            .where(NOTIFICATION_APP_SETTING.USER_ID.in(userIds))
            .and(NOTIFICATION_APP_SETTING.APP.eq(app.name()))
            .and(NOTIFICATION_APP_SETTING.ENABLED.isFalse())
            .fetch(NOTIFICATION_APP_SETTING.USER_ID));
  }

  /** 주어진 사용자들이 그 칸에 저장한 값(저장 안 한 사용자는 결과에 없음 = 기본값). */
  public Map<Long, Boolean> findCellValues(
      Collection<Long> userIds, NotificationSettingItem item, NotificationActor actor) {
    Map<Long, Boolean> out = new HashMap<>();
    if (userIds.isEmpty()) return out;
    dsl.select(NOTIFICATION_SETTING.USER_ID, NOTIFICATION_SETTING.ENABLED)
        .from(NOTIFICATION_SETTING)
        .where(NOTIFICATION_SETTING.USER_ID.in(userIds))
        .and(NOTIFICATION_SETTING.ITEM.eq(item.name()))
        .and(NOTIFICATION_SETTING.ACTOR.eq(actor.name()))
        .forEach(
            r -> out.put(r.get(NOTIFICATION_SETTING.USER_ID), r.get(NOTIFICATION_SETTING.ENABLED)));
    return out;
  }

  /** 문자열 → enum. 모르는 값이면 빈 값(valueOf 예외로 조회 전체가 500 이 되지 않게). */
  private static <E extends Enum<E>> Optional<E> parse(Class<E> type, String name) {
    return Arrays.stream(type.getEnumConstants()).filter(e -> e.name().equals(name)).findFirst();
  }
}
