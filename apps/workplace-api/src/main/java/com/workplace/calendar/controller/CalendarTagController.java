package com.workplace.calendar.controller;

import com.workplace.calendar.dto.CalendarTagRequest;
import com.workplace.calendar.dto.CalendarTagResponse;
import com.workplace.calendar.dto.EventTagsRequest;
import com.workplace.calendar.service.CalendarTagService;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 캘린더 태그 API(WP-714). 태그는 호출자 본인 것만 다룬다. 읽기=calendar:read, 쓰기=calendar:write.
 *
 * <p>일정에 태그 붙이기({@code PUT /events/{id}/tags})도 여기 둔다 — 일정 컨트롤러는 일정 본문만 다루고, 태그는 사람마다 따로라 이 모듈의
 * 관심사이기 때문이다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/calendar")
@RequirePermission("calendar:read")
public class CalendarTagController {
  private final CalendarTagService service;

  /** 내 태그 목록(이름순) — 일정 수·구독 주소 여부 포함. */
  @GetMapping("/tags")
  public ResponseEntity<List<CalendarTagResponse>> list(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(service.list(callerId));
  }

  /** 태그 만들기 — 같은 이름(대소문자 무시)이면 409. */
  @PostMapping("/tags")
  @RequirePermission("calendar:write")
  public ResponseEntity<CalendarTagResponse> create(
      @AuthenticationPrincipal Long callerId, @RequestBody CalendarTagRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED).body(service.create(callerId, req));
  }

  /** 이름·색 바꾸기 — 보낸 필드만. */
  @PatchMapping("/tags/{id}")
  @RequirePermission("calendar:write")
  public ResponseEntity<CalendarTagResponse> update(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long id,
      @RequestBody CalendarTagRequest req) {
    return ResponseEntity.ok(service.update(callerId, id, req));
  }

  /** 태그 지우기 — 일정 연결·구독 주소도 함께 사라진다. */
  @DeleteMapping("/tags/{id}")
  @RequirePermission("calendar:write")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable long id) {
    service.delete(callerId, id);
    return ResponseEntity.noContent().build();
  }

  /** 일정의 내 태그를 tagIds 로 바꾼다 — 앱 일정만(M365 는 409), 반복 회차는 마스터에. 초대받은 사람도 자기 태그를 붙일 수 있다. */
  @PutMapping("/events/{id}/tags")
  @RequirePermission("calendar:write")
  public ResponseEntity<Void> setEventTags(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long id,
      @Valid @RequestBody EventTagsRequest req) {
    service.setEventTags(callerId, id, req.tagIds());
    return ResponseEntity.noContent().build();
  }
}
