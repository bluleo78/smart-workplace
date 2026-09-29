package com.workplace.notify.push;

import static com.workplace.jooq.Tables.NOTIFICATION_PREFERENCE;

import java.util.Collection;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** notification_preference 접근. 행이 없으면 켜짐으로 간주하므로 "꺼진 사용자"만 조회한다. */
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

  /** 주어진 사용자 중 해당 카테고리를 끈 사용자 집합. */
  public Set<Long> findDisabledUsers(Collection<Long> userIds, PushCategory category) {
    if (userIds.isEmpty()) return Set.of();
    return new HashSet<>(
        dsl.select(NOTIFICATION_PREFERENCE.USER_ID)
            .from(NOTIFICATION_PREFERENCE)
            .where(NOTIFICATION_PREFERENCE.USER_ID.in(userIds))
            .and(NOTIFICATION_PREFERENCE.CATEGORY.eq(category.name()))
            .and(NOTIFICATION_PREFERENCE.ENABLED.isFalse())
            .fetch(NOTIFICATION_PREFERENCE.USER_ID));
  }
}
