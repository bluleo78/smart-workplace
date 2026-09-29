package com.workplace.notify.push;

import java.util.Collection;
import java.util.EnumMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 사용자 단위 알림 종류 설정. 저장 안 된 카테고리는 켜짐으로 채워 돌려준다. */
@Service
@RequiredArgsConstructor
public class NotificationPreferenceService {

  private final NotificationPreferenceRepository repo;

  /** 4개 카테고리 전체 상태. */
  @Transactional(readOnly = true)
  public Map<PushCategory, Boolean> get(long userId) {
    Map<PushCategory, Boolean> out = new EnumMap<>(PushCategory.class);
    for (PushCategory c : PushCategory.values()) out.put(c, true);
    out.putAll(repo.findByUser(userId));
    return out;
  }

  /** 부분 업데이트 후 전체 상태 반환. */
  @Transactional
  public Map<PushCategory, Boolean> update(long userId, Map<PushCategory, Boolean> changes) {
    changes.forEach((c, enabled) -> repo.upsert(userId, c, Boolean.TRUE.equals(enabled)));
    return get(userId);
  }

  /** 해당 카테고리를 끄지 않은 사용자만(입력 순서 유지, 중복 제거). */
  @Transactional(readOnly = true)
  public Set<Long> filterEnabled(Collection<Long> userIds, PushCategory category) {
    Set<Long> disabled = repo.findDisabledUsers(userIds, category);
    Set<Long> out = new LinkedHashSet<>(userIds);
    out.removeAll(disabled);
    return out;
  }
}
