package com.workplace.calendar.controller;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.dto.InviteAttendeesRequest;
import com.workplace.calendar.dto.RsvpRequest;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.global.security.RequirePermission;
import jakarta.validation.Valid;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** 개인 일정 API. 읽기=calendar:read, 쓰기=calendar:write. owner=호출자. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/calendar/events")
@RequirePermission("calendar:read")
public class CalendarEventController {
  private final CalendarEventService service;

  /** [from,to) 와 겹치는 내 일정 목록. */
  @GetMapping
  public ResponseEntity<List<CalendarEventResponse>> list(
      @AuthenticationPrincipal Long callerId,
      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime from,
      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime to) {
    return ResponseEntity.ok(service.list(callerId, from, to));
  }

  /** 단건 조회. */
  @GetMapping("/{id}")
  public ResponseEntity<CalendarEventResponse> get(
      @AuthenticationPrincipal Long callerId, @PathVariable long id) {
    return ResponseEntity.ok(service.get(callerId, id));
  }

  /** 일정 생성. */
  @PostMapping
  @RequirePermission("calendar:write")
  public ResponseEntity<CalendarEventResponse> create(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody CalendarEventRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED).body(service.create(callerId, req));
  }

  /**
   * 일정 수정. 반복 일정은 scope(THIS/THIS_AND_FOLLOWING/ALL)와 occurrenceDate(대상 회차 시작시각)로 적용 범위를 지정. scope
   * 미지정 시 ALL(마스터 전체 교체).
   */
  @PatchMapping("/{id}")
  @RequirePermission("calendar:write")
  public ResponseEntity<CalendarEventResponse> update(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long id,
      @Valid @RequestBody CalendarEventRequest req,
      @RequestParam(defaultValue = "ALL") EditScope scope,
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
          OffsetDateTime occurrenceDate) {
    return ResponseEntity.ok(service.update(callerId, id, req, scope, occurrenceDate));
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

  /** 참석자 추가. 주최자만 가능. */
  @PostMapping("/{id}/attendees")
  @RequirePermission("calendar:write")
  public ResponseEntity<Void> invite(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long id,
      @Valid @RequestBody InviteAttendeesRequest req) {
    service.inviteAttendees(callerId, id, req.userIds());
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
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
          OffsetDateTime occurrenceDate) {
    service.delete(callerId, id, scope, occurrenceDate);
    return ResponseEntity.noContent().build();
  }
}
