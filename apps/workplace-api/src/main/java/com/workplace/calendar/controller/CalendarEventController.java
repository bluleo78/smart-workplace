package com.workplace.calendar.controller;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.CalendarEventSearchResponse;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.dto.InviteAttendeesRequest;
import com.workplace.calendar.dto.RsvpRequest;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.global.dto.WithWebUrl;
import com.workplace.global.security.RequirePermission;
import com.workplace.global.time.SupportedDateTime;
import com.workplace.global.util.AppWebLinks;
import jakarta.validation.Valid;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

/**
 * 개인 일정 API. 읽기=calendar:read, 쓰기=calendar:write. owner=호출자.
 *
 * <p>@Validated: 쿼리 파라미터 시각(from·to·occurrenceDate)의 지원 범위({@link SupportedDateTime}) 검사를 켠다 — 범위 밖
 * 값이 DB 에서 409 로 터지던 것을 한국어 400 으로 거절한다(WP-1579).
 */
@RestController
@Validated
@RequiredArgsConstructor
@RequestMapping("/api/v1/calendar/events")
@RequirePermission("calendar:read")
public class CalendarEventController {
  private final CalendarEventService service;

  /** 화면 주소(WP-1523) — 단건 조회·생성·수정 응답에 url 로 싣는다. */
  private final AppWebLinks webLinks;

  /** [from,to) 와 겹치는 내 일정 목록. */
  @GetMapping
  public ResponseEntity<List<CalendarEventResponse>> list(
      @AuthenticationPrincipal Long callerId,
      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) @SupportedDateTime
          OffsetDateTime from,
      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) @SupportedDateTime
          OffsetDateTime to) {
    return ResponseEntity.ok(service.list(callerId, from, to));
  }

  /** 일정 키워드 검색(WP-1357) — 제목·장소·참석자. 빈 q 는 400 이 아니라 빈 목록. 리터럴 경로라 {@code /{id}} 보다 먼저 매칭된다. */
  @GetMapping("/search")
  public ResponseEntity<CalendarEventSearchResponse> search(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(required = false, defaultValue = "") String q,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer limit) {
    return ResponseEntity.ok(service.search(callerId, q, cursor, limit));
  }

  /** 단건 조회. */
  @GetMapping("/{id}")
  public ResponseEntity<WithWebUrl<CalendarEventResponse>> get(
      @AuthenticationPrincipal Long callerId, @PathVariable long id) {
    return ResponseEntity.ok(withUrl(service.get(callerId, id)));
  }

  /**
   * 일정 생성. notify=false 면 초대 참석자에게 인박스 알림을 보내지 않는다(WP-348, 외부 MCP create_event 의 알림 입력). 생략하면 알림을
   * 보낸다(기존 동작).
   */
  @PostMapping
  @RequirePermission("calendar:write")
  public ResponseEntity<WithWebUrl<CalendarEventResponse>> create(
      @AuthenticationPrincipal Long callerId,
      @Valid @RequestBody CalendarEventRequest req,
      @RequestParam(defaultValue = "true") boolean notify) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(withUrl(service.create(callerId, req, notify)));
  }

  /**
   * 일정 수정. 반복 일정은 scope(THIS/THIS_AND_FOLLOWING/ALL)와 occurrenceDate(대상 회차 시작시각)로 적용 범위를 지정. scope
   * 미지정 시 ALL(마스터 전체 교체).
   */
  @PatchMapping("/{id}")
  @RequirePermission("calendar:write")
  public ResponseEntity<WithWebUrl<CalendarEventResponse>> update(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long id,
      @Valid @RequestBody CalendarEventRequest req,
      @RequestParam(defaultValue = "ALL") EditScope scope,
      @RequestParam(required = false)
          @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
          @SupportedDateTime
          OffsetDateTime occurrenceDate) {
    return ResponseEntity.ok(withUrl(service.update(callerId, id, req, scope, occurrenceDate)));
  }

  /** RSVP 응답. 참석자 본인만 가능(비참석자 → 404 은닉). calendar:read 권한으로 충분(쓰기 권한 없는 참석자도 응답 가능). */
  @PatchMapping("/{id}/rsvp")
  public ResponseEntity<Void> rsvp(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long id,
      @Valid @RequestBody RsvpRequest req) {
    service.respondRsvp(callerId, id, req.status());
    return ResponseEntity.noContent().build();
  }

  /** 참석자 추가. 주최자만 가능. notify=false 면 새 참석자에게 인박스 알림을 보내지 않는다(WP-348). 생략하면 알림을 보낸다. */
  @PostMapping("/{id}/attendees")
  @RequirePermission("calendar:write")
  public ResponseEntity<Void> invite(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long id,
      @Valid @RequestBody InviteAttendeesRequest req,
      @RequestParam(defaultValue = "true") boolean notify) {
    service.inviteAttendees(callerId, id, req.userIds(), notify);
    return ResponseEntity.noContent().build();
  }

  /** 참석자 제거. 주최자만 가능. */
  @DeleteMapping("/{id}/attendees/{userId}")
  @RequirePermission("calendar:write")
  public ResponseEntity<Void> removeAttendee(
      @AuthenticationPrincipal Long callerId, @PathVariable long id, @PathVariable long userId) {
    service.removeAttendee(callerId, id, userId);
    return ResponseEntity.noContent().build();
  }

  /** 일정 삭제. 반복 일정은 scope/occurrenceDate 로 적용 범위 지정. scope 미지정 시 ALL(시리즈 전체 삭제). */
  @DeleteMapping("/{id}")
  @RequirePermission("calendar:write")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long id,
      @RequestParam(defaultValue = "ALL") EditScope scope,
      @RequestParam(required = false)
          @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
          @SupportedDateTime
          OffsetDateTime occurrenceDate) {
    service.delete(callerId, id, scope, occurrenceDate);
    return ResponseEntity.noContent().build();
  }

  /**
   * 일정 응답에 화면 주소(/calendar?eventId={id})를 붙인다(WP-1523). 단건 조회·생성·수정은 늘 실제 일정 행을 돌려준다(가상 회차가 아니다).
   */
  private WithWebUrl<CalendarEventResponse> withUrl(CalendarEventResponse e) {
    return WithWebUrl.of(e, webLinks.calendarEvent(e.id()));
  }
}
