package com.workplace.calendar.outbound;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.realtime.UserAudienceResolver;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 캘린더 일정·캘린더 변경 → {@link ResourceChangedEvent} 발행 헬퍼 (WP-61). 일정은 소유자와 내부 참석자가 보므로 USER(소유자) + 참석자를
 * extra 로 싣는다. 삭제·참석자 제거는 커밋 후 참석자 행이 사라지므로 호출자가 변경 *전* 명단을 넘긴다. 반드시 쓰기 트랜잭션(txTemplate 람다) 안에서 호출
 * — CalendarEventService 의 create/update/delete 는 @Transactional 이 아니다.
 */
@Component
@RequiredArgsConstructor
public class CalendarChangeNotifier {

  /** 리소스 이름 — 프론트 무효화 맵(resourceInvalidation RULES) 키와 계약 테스트로 일치를 고정한다. */
  public static final String RESOURCE_CALENDAR_EVENT = "calendar-event";

  public static final String RESOURCE_CALENDAR = "calendar";

  private final ApplicationEventPublisher publisher;

  /** 일정 변경. attendeeUserIds — 내부 참석자(user_id 있는 행) userId, 외부 이메일 참석자는 제외. */
  public void eventChanged(
      String op, long eventId, long ownerId, Collection<Long> attendeeUserIds, Long actorId) {
    publisher.publishEvent(
        ResourceChangedEvent.of(
            RESOURCE_CALENDAR_EVENT,
            op,
            UserAudienceResolver.SCOPE,
            ownerId,
            List.of(eventId),
            Map.of(),
            actorId,
            attendeeUserIds));
  }

  /** 캘린더(컨테이너) 변경 — 소유자 전용. */
  public void calendarChanged(String op, long calendarId, long ownerId, Long actorId) {
    calendarChanged(op, calendarId, ownerId, List.of(), actorId);
  }

  /** 캘린더 변경 + 추가 수신자. 캘린더 초기화처럼 소속 일정의 내부 참석자도 영향받는 경우, 하드 삭제로 참석자 행이 사라지기 전에 수집한 userId 를 싣는다. */
  public void calendarChanged(
      String op, long calendarId, long ownerId, Collection<Long> extraUserIds, Long actorId) {
    publisher.publishEvent(
        ResourceChangedEvent.of(
            RESOURCE_CALENDAR,
            op,
            UserAudienceResolver.SCOPE,
            ownerId,
            List.of(calendarId),
            Map.of(),
            actorId,
            extraUserIds));
  }
}
