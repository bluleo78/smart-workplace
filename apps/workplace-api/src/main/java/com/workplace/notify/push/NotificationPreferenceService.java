package com.workplace.notify.push;

import java.util.EnumMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 옛 사용자 단위 푸시 종류 설정(/api/v1/push/preferences). 저장 안 된 카테고리는 켜짐으로 채워 돌려준다.
 *
 * <p>WP-913 부터 알림·푸시 판정에 쓰지 않는다(새 설정 NotificationSettingService 만 판정). 롤링 배포 중 옛 웹 화면이 깨지지 않게
 * 조회·저장만 남겨 둔 것이며, 엔드포인트·이 코드·notification_preference 테이블 제거는 후속 이슈에서 한다(expand/contract).
 */
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
}
