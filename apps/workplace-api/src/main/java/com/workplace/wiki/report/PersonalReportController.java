package com.workplace.wiki.report;

import com.workplace.global.time.SupportedDateTime;
import com.workplace.issue.report.PersonalReportKind;
import com.workplace.wiki.report.PersonalReportService.CreateResult;
import com.workplace.wiki.report.dto.CreatePersonalReportRequest;
import com.workplace.wiki.report.dto.PersonalReportConflictResponse;
import com.workplace.wiki.report.dto.PersonalReportLookupResponse;
import com.workplace.wiki.report.dto.PersonalReportSettingsResponse;
import com.workplace.wiki.report.dto.PersonalReportStatusResponse;
import com.workplace.wiki.report.dto.UpdatePersonalReportSettingsRequest;
import jakarta.validation.Valid;
import java.time.LocalDate;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * 개인 보고 API(WP-1486) — 「보고서 설정」·「보고서 만들기」·「일일 보고 보기」. 인증만 필요하고 대상은 언제나 로그인한 본인({@code
 * auth.getPrincipal()})이다 — 사용자 id 를 받지 않아 남의 설정·보고를 보거나 만들 길이 없다. 개인 노트에만 쓰므로
 * {@code @RequirePermission} 은 두지 않는다(업무 프로파일 API 와 같은 판단 — 맞는 권한 코드가 없다).
 *
 * <p>@Validated: 찾기의 date 쿼리 파라미터 지원 범위({@link SupportedDateTime}) 검사를 켠다 — 범위 밖 날짜가 DB 에서 409 로
 * 터지던 것을 한국어 400 으로 거절한다(WP-1579).
 */
@RestController
@Validated
@RequiredArgsConstructor
public class PersonalReportController {

  private final PersonalReportSettingsService settingsService;
  private final PersonalReportService reportService;

  /** GET /api/v1/me/report-settings — 설정(행이 없으면 기본값)·템플릿 링크·비서 유무·마지막 실패. */
  @GetMapping("/api/v1/me/report-settings")
  public ResponseEntity<PersonalReportSettingsResponse> getSettings(Authentication auth) {
    return ResponseEntity.ok(settingsService.get(userId(auth)));
  }

  /** PUT /api/v1/me/report-settings — 켬/끔·시각(정시)·건너뜀. 켤 때 「보고」·템플릿을 만든다. */
  @PutMapping("/api/v1/me/report-settings")
  public ResponseEntity<PersonalReportSettingsResponse> updateSettings(
      Authentication auth, @Valid @RequestBody UpdatePersonalReportSettingsRequest req) {
    return ResponseEntity.ok(settingsService.update(userId(auth), req));
  }

  /** POST /api/v1/me/report-settings/templates/{DAILY|WEEKLY}/reset — 템플릿을 기본으로(직전 판은 수정 기록에). */
  @PostMapping("/api/v1/me/report-settings/templates/{kind}/reset")
  public ResponseEntity<PersonalReportSettingsResponse> resetTemplate(
      Authentication auth, @PathVariable String kind) {
    return ResponseEntity.ok(
        settingsService.resetTemplate(userId(auth), PersonalReportKind.parse(kind)));
  }

  /** GET /api/v1/me/reports?kind=DAILY&date=2026-11-11 — 그 회차의 최신 보고 노트(200), 없으면 204. */
  @GetMapping("/api/v1/me/reports")
  public ResponseEntity<PersonalReportLookupResponse> lookup(
      Authentication auth,
      @RequestParam String kind,
      @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) @SupportedDateTime
          LocalDate date) {
    return reportService
        .lookup(userId(auth), PersonalReportKind.parse(kind), date)
        .map(ResponseEntity::ok)
        .orElseGet(() -> ResponseEntity.noContent().build());
  }

  /** POST /api/v1/me/reports — 회차를 예약하고 생성을 시작한다(202). 400·409·429 는 서비스 참고. */
  @PostMapping("/api/v1/me/reports")
  public ResponseEntity<CreateResult> create(
      Authentication auth, @RequestBody CreatePersonalReportRequest req) {
    return ResponseEntity.status(HttpStatus.ACCEPTED).body(reportService.create(userId(auth), req));
  }

  /** GET /api/v1/me/reports/{id} — 회차 상태(폴링). 남의 id 는 404(존재 은닉). */
  @GetMapping("/api/v1/me/reports/{id}")
  public ResponseEntity<PersonalReportStatusResponse> status(
      Authentication auth, @PathVariable long id) {
    return reportService
        .status(userId(auth), id)
        .map(ResponseEntity::ok)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "보고를 찾을 수 없어요"));
  }

  /** 만들기 409 — 공용 오류 본문에 없는 code·pageId·title·id 를 실어야 해서 이 컨트롤러가 직접 답한다. */
  @ExceptionHandler(PersonalReportConflictException.class)
  public ResponseEntity<PersonalReportConflictResponse> conflict(
      PersonalReportConflictException e) {
    return ResponseEntity.status(HttpStatus.CONFLICT).body(e.body());
  }

  private static long userId(Authentication auth) {
    return (Long) auth.getPrincipal();
  }
}
