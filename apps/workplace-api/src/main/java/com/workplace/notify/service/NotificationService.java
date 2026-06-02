package com.workplace.notify.service;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.repository.NotificationRepository;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 알림 생성·조회·읽음. 생성 시 수신자 후보에서 actor 본인 제외 + 중복 제거 후 persist 하고, 같은 수신자 집합에 SSE("notify.created")로
 * fan-out 한다. 모든 조회/변경은 recipientId 스코프(타 사용자 알림 접근 불가).
 */
@Service
@RequiredArgsConstructor
public class NotificationService {

  private final NotificationRepository repo;
  private final SseRegistry registry;

  /** 수신자 확정(actor 제외·중복 제거) → batch insert → SSE fan-out. 빈 수신자면 no-op. */
  @Transactional
  public void createAndFanOut(
      NotificationType type, List<Long> recipientIds, Long actorId, long issueId, Long commentId) {
    List<Long> recipients =
        recipientIds.stream()
            .filter(Objects::nonNull)
            .distinct()
            .filter(id -> !id.equals(actorId))
            .toList();
    if (recipients.isEmpty()) return;
    repo.insertBatch(recipients, type, actorId, issueId, commentId);
    // 페이로드는 경량(클라가 수신 즉시 쿼리 invalidate). 상세는 REST 재조회.
    registry.fanOut(recipients, "notify.created", Map.of("type", type.name(), "issueId", issueId));
  }

  @Transactional(readOnly = true)
  public List<NotificationResponse> listRecent(long recipientId, int limit) {
    return repo.listRecent(recipientId, limit);
  }

  @Transactional(readOnly = true)
  public long countUnread(long recipientId) {
    return repo.countUnread(recipientId);
  }

  @Transactional
  public int markRead(long recipientId, long id) {
    return repo.markRead(recipientId, id);
  }

  @Transactional
  public int markAllRead(long recipientId) {
    return repo.markAllRead(recipientId);
  }
}
