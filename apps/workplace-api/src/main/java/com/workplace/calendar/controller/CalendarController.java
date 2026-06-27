package com.workplace.calendar.controller;

import com.workplace.calendar.dto.CalendarRequest;
import com.workplace.calendar.dto.CalendarResponse;
import com.workplace.calendar.service.CalendarService;
import com.workplace.global.security.RequirePermission;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 개인 캘린더(컨테이너) API. 읽기=calendar:read, 쓰기=calendar:write. owner=호출자. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/calendars")
@RequirePermission("calendar:read")
public class CalendarController {
  private final CalendarService service;

  /** 내 캘린더 목록(기본 캘린더 lazy 보장). */
  @GetMapping
  public ResponseEntity<List<CalendarResponse>> list(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(service.list(callerId));
  }

  /** 캘린더 생성. */
  @PostMapping
  @RequirePermission("calendar:write")
  public ResponseEntity<CalendarResponse> create(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody CalendarRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED).body(service.create(callerId, req));
  }

  /** 캘린더 수정. */
  @PatchMapping("/{id}")
  @RequirePermission("calendar:write")
  public ResponseEntity<CalendarResponse> update(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long id,
      @Valid @RequestBody CalendarRequest req) {
    return ResponseEntity.ok(service.update(callerId, id, req));
  }

  /** 캘린더 삭제(기본 불가, 비기본은 일정 기본 이동). */
  @DeleteMapping("/{id}")
  @RequirePermission("calendar:write")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable long id) {
    service.delete(callerId, id);
    return ResponseEntity.noContent().build();
  }
}
