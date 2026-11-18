package com.workplace.calendar.controller;

import com.workplace.calendar.dto.NoteLinkedEventsResponse;
import com.workplace.calendar.service.CalendarEventNoteService;
import com.workplace.global.security.RequirePermission;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 노트 기준 일정 조회 API(WP-1703) — 노트 하단 「연결된 일정」이 그 노트를 회의록으로 이은 일정을 읽는다. 연결 행은 calendar 가 갖고 있어 wiki 가
 * calendar 를 알지 않도록 calendar API 에 둔다. 권한은 일정 노트 조회({@code GET /calendar/events/{id}/note})와 같은
 * calendar:read.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/calendar/notes")
@RequirePermission("calendar:read")
public class CalendarNoteController {
  private final CalendarEventNoteService noteService;

  /**
   * 노트에 이어진, 호출자가 볼 수 있는 일정 목록(최근 일정 먼저, 최대 50개). 노트를 읽을 수 없으면 없는 노트와 같은 404 — 응답 차이로 노트의 존재를 알 수
   * 없게.
   */
  @GetMapping("/{pageId}/events")
  public ResponseEntity<NoteLinkedEventsResponse> linkedEvents(
      @AuthenticationPrincipal Long callerId, @PathVariable long pageId) {
    return ResponseEntity.ok(noteService.linkedEvents(callerId, pageId));
  }
}
