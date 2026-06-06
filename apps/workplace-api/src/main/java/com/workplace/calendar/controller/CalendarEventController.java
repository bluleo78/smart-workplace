package com.workplace.calendar.controller;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.EditScope;
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

  /** 일정 수정(전체 교체). */
  @PatchMapping("/{id}")
  @RequirePermission("calendar:write")
  public ResponseEntity<CalendarEventResponse> update(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long id,
      @Valid @RequestBody CalendarEventRequest req) {
    // scope/occurrenceDate 쿼리 파라미터 연동은 Task 5 — 지금은 ALL(마스터 전체 교체)로 호출.
    return ResponseEntity.ok(service.update(callerId, id, req, EditScope.ALL, null));
  }

  /** 일정 삭제. */
  @DeleteMapping("/{id}")
  @RequirePermission("calendar:write")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable long id) {
    service.delete(callerId, id, EditScope.ALL, null);
    return ResponseEntity.noContent().build();
  }
}
