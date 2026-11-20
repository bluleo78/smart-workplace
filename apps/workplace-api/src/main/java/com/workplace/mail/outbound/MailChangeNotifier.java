package com.workplace.mail.outbound;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.realtime.UserAudienceResolver;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 메일·메일 계정 변경 → {@link ResourceChangedEvent} 발행 헬퍼 (WP-64). 메일은 계정 소유자 한 명만 보므로 모두 USER scope 로
 * 보낸다. payload 에는 id 만 싣는다. 반드시 쓰기 트랜잭션 안에서 호출해야 한다(AFTER_COMMIT 디스패처는 fallbackExecution 이 없어 트랜잭션
 * 밖 발행은 유실된다).
 */
@Component
@RequiredArgsConstructor
public class MailChangeNotifier {

  /** 리소스 이름 — 프론트 무효화 맵(resourceInvalidation RULES) 키와 계약 테스트로 일치를 고정한다. */
  public static final String RESOURCE_MAIL = "mail";

  public static final String RESOURCE_MAIL_ACCOUNT = "mail-account";

  private final ApplicationEventPublisher publisher;

  /**
   * 메일(목록·상세·회신필요 등) 변경. messageId 가 null 이면 계정 단위 변경(동기화로 새 메일 유입 등). actorId 가 null 이면 시스템
   * 발화(동기화). Map.of 는 null 값을 거부하므로 HashMap 으로 attrs 를 조립한다.
   */
  public void mailChanged(long ownerId, long accountId, Long messageId, Long actorId) {
    Map<String, Object> attrs = new HashMap<>();
    attrs.put("accountId", accountId);
    if (messageId != null) attrs.put("messageId", messageId);
    publisher.publishEvent(
        ResourceChangedEvent.of(
            RESOURCE_MAIL,
            ResourceChangedEvent.OP_UPDATED,
            UserAudienceResolver.SCOPE,
            ownerId,
            messageId == null ? List.of() : List.of(messageId),
            attrs,
            actorId));
  }

  /** 메일 계정 생성·수정·삭제·일괄 설정. accountId 0 은 "사용자의 모든 계정"(전역 토글) 을 뜻한다. */
  public void accountChanged(String op, long ownerId, long accountId, Long actorId) {
    publishAccount(op, ownerId, accountId, Map.of("accountId", accountId), actorId);
  }

  /**
   * WP-1789: 계정 변경 이벤트 attrs 의 change 값 — 알림 범위(notify_mode)만 바뀐 변경임을 뜻한다. 웹의 실시간 규칙이 이 글자를 그대로
   * 비교하므로 바꾸면 웹과 함께 고쳐야 한다.
   */
  public static final String CHANGE_NOTIFY_MODE = "notify-mode";

  /**
   * WP-1789: 알림 범위만 바뀐 계정 변경(updated). accountChanged 와 같은 이벤트에 change="notify-mode" 를 더 실어, 웹이 이
   * 변경을 구분해 처리(계정 목록은 갱신하되 메일 목록 등은 건드리지 않음)할 수 있게 한다.
   */
  public void accountNotifyModeChanged(long ownerId, long accountId, Long actorId) {
    publishAccount(
        ResourceChangedEvent.OP_UPDATED,
        ownerId,
        accountId,
        Map.of("accountId", accountId, "change", CHANGE_NOTIFY_MODE),
        actorId);
  }

  /** 계정 이벤트 발행 공통부 — 리소스·scope·ids 조립을 한곳에 둔다(accountChanged 와 알림 범위 변경이 어긋나지 않게, WP-1789). */
  private void publishAccount(
      String op, long ownerId, long accountId, Map<String, Object> attrs, Long actorId) {
    publisher.publishEvent(
        ResourceChangedEvent.of(
            RESOURCE_MAIL_ACCOUNT,
            op,
            UserAudienceResolver.SCOPE,
            ownerId,
            accountId == 0 ? List.of() : List.of(accountId),
            attrs,
            actorId));
  }
}
