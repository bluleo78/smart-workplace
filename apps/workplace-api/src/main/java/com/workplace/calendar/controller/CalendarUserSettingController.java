package com.workplace.calendar.controller;

import com.workplace.calendar.dto.CalendarUserSettingResponse;
import com.workplace.calendar.dto.CalendarUserSettingUpdateRequest;
import com.workplace.calendar.service.CalendarUserSettingService;
import com.workplace.global.security.RequirePermission;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 내 캘린더 사용자 설정 REST(WP-2169). 사람마다 하나이고 본인 것만 다룬다(@AuthenticationPrincipal callerId). 사이드바의 「기본으로
 * 지정」이 저장하고, 새 일정 창이 처음 캘린더를 정할 때 읽는다. 읽기=calendar:read, 쓰기=calendar:write(캘린더 API 와 같다).
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/calendar/settings")
@RequirePermission("calendar:read")
public class CalendarUserSettingController {

  private final CalendarUserSettingService settingService;

  /** 내 설정 — 실효 기본 캘린더(지정이 없거나 쓸 수 없으면 Works 캘린더). */
  @GetMapping
  public CalendarUserSettingResponse get(@AuthenticationPrincipal Long callerId) {
    return settingService.get(callerId);
  }

  /** 새 일정 기본 캘린더 지정 — calendarId 없으면 400, 남의/없는 캘린더 404, 읽기 전용 409. */
  @PutMapping
  @RequirePermission("calendar:write")
  public CalendarUserSettingResponse update(
      @AuthenticationPrincipal Long callerId,
      @Valid @RequestBody CalendarUserSettingUpdateRequest request) {
    return settingService.update(callerId, request);
  }

  /**
   * Outlook 기본 캘린더 질문을 했다고 기록한다(WP-2171) — 사람당 한 번만 묻기 위함. 읽기 권한이면 된다(본인 알림 표시 상태 기록이라 일정 데이터를 바꾸지
   * 않는다). 멱등.
   */
  @PostMapping("/outlook-prompted")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void markOutlookPrompted(@AuthenticationPrincipal Long callerId) {
    settingService.markOutlookPrompted(callerId);
  }
}
