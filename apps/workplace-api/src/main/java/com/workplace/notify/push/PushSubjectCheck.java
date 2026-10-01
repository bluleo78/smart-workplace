package com.workplace.notify.push;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 기동 시 VAPID 연락처 점검 — 잘못된 값은 FCM 에선 통과하고 Apple 에서만 거부돼 "iPhone 만 알림 없음"으로 늦게 드러나므로(WP-152) 기동 로그로
 * 바로 알린다. 발송은 막지 않는다(경고만).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class PushSubjectCheck {

  private final PushProperties props;

  @EventListener(ApplicationReadyEvent.class)
  public void warnOnBadSubject() {
    if (!props.enabled()) return;
    String problem = props.subjectProblem();
    if (problem != null) {
      log.warn(
          "[push] VAPID subject '{}' {} — WORKPLACE_PUSH_SUBJECT 에 mailto:<실제 메일> 을 설정하세요",
          props.subject(),
          problem);
    }
  }
}
