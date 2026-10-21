package com.workplace.calendar.controller;

import com.workplace.calendar.exception.CalendarTagNotFoundException;
import com.workplace.calendar.repository.CalendarTagRepository.FeedTagRow;
import com.workplace.calendar.service.CalendarTagFeedService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantStatusChecker;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 태그 구독 주소 공개 엔드포인트(WP-715, 인증 불필요) — {@code GET …/feeds/{토큰}.ics?week=2026-W43}. 토큰이 곧
 * 권한(capability URL)이다.
 *
 * <p>스테이징 업로드 링크({@code PublicStagedUploadController})처럼 컨트롤러가 TenantContext 를 직접 설정하고 finally 에서
 * 지운다. 컨트롤러에는 {@code @Transactional} 을 달지 않는다 — 토큰 resolve 는 테넌트 컨텍스트 없이(SECURITY DEFINER), 일정 조회는
 * 컨텍스트 설정 뒤 별도 트랜잭션이어야 테넌트 GUC 가 주입된다. 오류도 JSON 이 아닌 짧은 평문으로 돌려준다 — 캘린더 클라이언트는 {@code Accept:
 * text/calendar} 로 부르므로 JSON 오류 본문은 협상에 걸려 상태 코드가 바뀔 수 있다. 토큰 원문은 로그에 남기지 않는다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/public/calendar/feeds")
public class PublicCalendarFeedController {
  private static final MediaType TEXT_CALENDAR =
      new MediaType("text", "calendar", StandardCharsets.UTF_8);

  private final CalendarTagFeedService feeds;
  private final TenantStatusChecker tenantStatusChecker;

  /** 한 주치 .ics — 주 형식 오류 400, 없는(폐기·재발급된) 토큰 404. 캐시하지 않는다(재발급·태그 변경이 바로 보이게). */
  @GetMapping("/{token}.ics")
  public ResponseEntity<String> feed(
      @PathVariable("token") String token, @RequestParam(required = false) String week) {
    LocalDate monday;
    try {
      monday = CalendarTagFeedService.weekStart(week, CalendarTagFeedService.today());
    } catch (IllegalArgumentException e) {
      return plain(HttpStatus.BAD_REQUEST, e.getMessage());
    }
    FeedTagRow tag = feeds.resolve(token).orElse(null);
    if (tag == null || !tenantStatusChecker.isActive(tag.tenantId())) {
      return notFound();
    }
    String body;
    try {
      TenantContext.set(tag.tenantId());
      body = feeds.render(tag, monday);
    } catch (CalendarTagNotFoundException e) {
      return notFound();
    } finally {
      TenantContext.clear();
    }
    return ResponseEntity.ok()
        .contentType(TEXT_CALENDAR)
        .cacheControl(CacheControl.noStore())
        .body(body);
  }

  private static ResponseEntity<String> notFound() {
    return plain(HttpStatus.NOT_FOUND, "구독 주소를 찾을 수 없습니다");
  }

  private static ResponseEntity<String> plain(HttpStatus status, String message) {
    return ResponseEntity.status(status)
        .contentType(new MediaType("text", "plain", StandardCharsets.UTF_8))
        .cacheControl(CacheControl.noStore())
        .body(message);
  }
}
