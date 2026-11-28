package com.workplace.calendar.service;

import com.workplace.calendar.dto.CalendarUserSettingResponse;
import com.workplace.calendar.dto.CalendarUserSettingUpdateRequest;
import com.workplace.calendar.repository.CalendarUserSettingRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 내 캘린더 사용자 설정(WP-2169) 조회·저장. 지금은 「새 일정 기본 캘린더」 하나이고 사람마다(테넌트별) 하나다. 서버에 두어 새 일정 창·외부 MCP
 * create_event 가 같은 기본을 따른다.
 */
@Service
@RequiredArgsConstructor
public class CalendarUserSettingService {

  private final CalendarUserSettingRepository repository;
  private final CalendarService calendarService;

  /**
   * 내 설정 — 실효 기본 캘린더. 외부 캘린더도 허용한다(REST 생성은 트랜잭션 밖이라 Outlook 에 만들 수 있다). Works 캘린더가 아직 없으면 만든다 —
   * 캘린더 목록 GET 처럼 일반 트랜잭션이다.
   */
  @Transactional
  public CalendarUserSettingResponse get(long userId) {
    return new CalendarUserSettingResponse(
        calendarService.resolveCreateCalendarId(userId, true, true),
        repository.isOutlookPrompted(userId));
  }

  /** Outlook 기본 캘린더 질문을 했다고 기록한다(WP-2171). 멱등 — 처음 기록 시각을 유지하고 기존 기본 캘린더 지정은 건드리지 않는다. */
  @Transactional
  public void markOutlookPrompted(long userId) {
    repository.markOutlookPrompted(userId);
  }

  /**
   * 기본 캘린더를 지정하고 실효값을 돌려준다. 남의/없는 캘린더와 연결 해제 계정의 캘린더(목록에서 숨겨짐)는 404, 읽기 전용은 409(일정 생성과 같은 예외).
   * 보이는지를 먼저 본다 — 연결 해제 계정의 읽기 전용 캘린더도 존재를 드러내지 않고 404 다.
   */
  @Transactional
  public CalendarUserSettingResponse update(long userId, CalendarUserSettingUpdateRequest req) {
    long calendarId = req.calendarId();
    calendarService.requireUsableCreateTarget(userId, calendarId);
    repository.upsertPreferred(userId, calendarId);
    // 검증한 쓰기 가능·보이는 캘린더가 곧 실효값이다 — get 으로 다시 해석하지 않는다.
    return new CalendarUserSettingResponse(calendarId, repository.isOutlookPrompted(userId));
  }
}
