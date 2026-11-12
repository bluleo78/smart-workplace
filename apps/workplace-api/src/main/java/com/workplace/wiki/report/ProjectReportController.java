package com.workplace.wiki.report;

import com.workplace.global.security.RequirePermission;
import com.workplace.wiki.report.dto.ProjectReportCardResponse;
import com.workplace.wiki.report.dto.ProjectReportSettingsResponse;
import com.workplace.wiki.report.dto.UpdateProjectReportSettingsRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 프로젝트 리포트 API(WP-1483) — 설정 읽기·저장, 템플릿 기본으로 되돌리기, 개요 카드 리포트 줄. 권한 판정은 서비스가 한다(읽기 = 프로젝트 읽기,
 * 저장·되돌리기 = OWNER·ADMIN, 개인 프로젝트 400). 리포지토리를 직접 쓰지 않는다 — 트랜잭션은 서비스가 나눈다(템플릿 본문 쓰기가 트랜잭션 밖이어야 해서).
 */
@RestController
@RequiredArgsConstructor
public class ProjectReportController {

  private final ProjectReportSettingsService settingsService;
  private final ProjectReportCardService cardService;

  /**
   * GET /api/v1/projects/{key}/reports — 개요 카드 리포트 줄(최신·지난 목록·「리포트」 페이지). 프로젝트를 못 읽으면 404, 노트 공간
   * 멤버가 아니면 빈 응답(200).
   */
  @GetMapping("/api/v1/projects/{key}/reports")
  @RequirePermission("project:read")
  public ResponseEntity<ProjectReportCardResponse> getReports(
      Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(cardService.card((Long) auth.getPrincipal(), key));
  }

  /** GET /api/v1/projects/{key}/report-settings — 설정(행이 없으면 기본값)과 관리 가능 여부. */
  @GetMapping("/api/v1/projects/{key}/report-settings")
  @RequirePermission("project:read")
  public ResponseEntity<ProjectReportSettingsResponse> getSettings(
      Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(settingsService.get((Long) auth.getPrincipal(), key));
  }

  /** PUT /api/v1/projects/{key}/report-settings — 켬/끔·주기·요일·시각 저장. 켤 때 템플릿이 없으면 복사한다. */
  @PutMapping("/api/v1/projects/{key}/report-settings")
  @RequirePermission("project:write")
  public ResponseEntity<ProjectReportSettingsResponse> updateSettings(
      Authentication auth,
      @PathVariable String key,
      @Valid @RequestBody UpdateProjectReportSettingsRequest req) {
    return ResponseEntity.ok(settingsService.update((Long) auth.getPrincipal(), key, req));
  }

  /** POST /api/v1/projects/{key}/report-settings/template/reset — 템플릿 본문을 기본으로(직전 판은 수정 기록에). */
  @PostMapping("/api/v1/projects/{key}/report-settings/template/reset")
  @RequirePermission("project:write")
  public ResponseEntity<ProjectReportSettingsResponse> resetTemplate(
      Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(settingsService.resetTemplate((Long) auth.getPrincipal(), key));
  }
}
