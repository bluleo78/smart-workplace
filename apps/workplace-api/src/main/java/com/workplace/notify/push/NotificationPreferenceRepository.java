package com.workplace.notify.push;

import static com.workplace.jooq.Tables.NOTIFICATION_PREFERENCE;

import java.util.EnumMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * 옛 notification_preference 접근(행이 없으면 켜짐). WP-913 부터 옛 /push/preferences 화면의 조회·저장에만 쓰이고 알림·푸시 판정에는
 * 쓰이지 않는다 — 테이블과 함께 후속 이슈에서 제거.
 */
@Repository
@RequiredArgsConstructor
public class NotificationPreferenceRepository {

  private final DSLContext dsl;

  /** 사용자에게 저장된 설정(저장 안 된 카테고리는 결과에 없음 = 기본 켜짐). */
  public Map<PushCategory, Boolean> findByUser(long userId) {
    Map<PushCategory, Boolean> out = new EnumMap<>(PushCategory.class);
    dsl.select(NOTIFICATION_PREFERENCE.CATEGORY, NOTIFICATION_PREFERENCE.ENABLED)
        .from(NOTIFICATION_PREFERENCE)
        .where(NOTIFICATION_PREFERENCE.USER_ID.eq(userId))
        .forEach(
            r ->
                out.put(
                    PushCategory.valueOf(r.get(NOTIFICATION_PREFERENCE.CATEGORY)),
                    r.get(NOTIFICATION_PREFERENCE.ENABLED)));
    return out;
  }

  /** (user, category) upsert. */
  public void upsert(long userId, PushCategory category, boolean enabled) {
    dsl.insertInto(NOTIFICATION_PREFERENCE)
        .set(NOTIFICATION_PREFERENCE.USER_ID, userId)
        .set(NOTIFICATION_PREFERENCE.CATEGORY, category.name())
        .set(NOTIFICATION_PREFERENCE.ENABLED, enabled)
        .onConflict(NOTIFICATION_PREFERENCE.USER_ID, NOTIFICATION_PREFERENCE.CATEGORY)
        .doUpdate()
        .set(NOTIFICATION_PREFERENCE.ENABLED, enabled)
        .execute();
  }
}
