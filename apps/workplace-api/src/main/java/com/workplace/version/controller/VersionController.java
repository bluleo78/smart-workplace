package com.workplace.version.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.version.dto.CreateVersionRequest;
import com.workplace.version.dto.ReleaseVersionRequest;
import com.workplace.version.dto.UpdateVersionRequest;
import com.workplace.version.dto.VersionIssueCount;
import com.workplace.version.dto.VersionResponse;
import com.workplace.version.service.VersionService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 프로젝트 버전 목록 관리 REST API(WP-888). 보기는 프로젝트를 읽을 수 있는 사람({@code project:read}), 변경은 OWNER·ADMIN — 역할
 * 검증은 서비스 레이어가 한다(구성요소와 같은 규칙). 출시·출시 취소·삭제·이슈 수도 여기 있다.
 */
@RestController
@RequestMapping("/api/v1/projects/{key}/versions")
@RequiredArgsConstructor
public class VersionController {

  private final VersionService versionService;

  /** 버전 전체 목록(보관 포함, 목록 순서). */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<VersionResponse>> list(Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(versionService.list((Long) auth.getPrincipal(), key));
  }

  /** 버전 한 건. */
  @GetMapping("/{id}")
  @RequirePermission("project:read")
  public ResponseEntity<VersionResponse> get(
      Authentication auth, @PathVariable String key, @PathVariable long id) {
    return ResponseEntity.ok(versionService.get((Long) auth.getPrincipal(), key, id));
  }

  /** 버전 추가 — OWNER·ADMIN. */
  @PostMapping
  @RequirePermission("project:manage")
  public ResponseEntity<VersionResponse> create(
      Authentication auth, @PathVariable String key, @Valid @RequestBody CreateVersionRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(versionService.create((Long) auth.getPrincipal(), key, req));
  }

  /** 이름·설명·날짜·보관 여부 수정(보낸 필드만) — OWNER·ADMIN. */
  @PatchMapping("/{id}")
  @RequirePermission("project:manage")
  public ResponseEntity<VersionResponse> update(
      Authentication auth,
      @PathVariable String key,
      @PathVariable long id,
      @Valid @RequestBody UpdateVersionRequest req) {
    return ResponseEntity.ok(versionService.update((Long) auth.getPrincipal(), key, id, req));
  }

  /** 출시 — 본문은 선택(출시일·끝나지 않은 이슈를 옮길 버전). OWNER·ADMIN. */
  @PostMapping("/{id}/release")
  @RequirePermission("project:manage")
  public ResponseEntity<VersionResponse> release(
      Authentication auth,
      @PathVariable String key,
      @PathVariable long id,
      @RequestBody(required = false) ReleaseVersionRequest req) {
    return ResponseEntity.ok(versionService.release((Long) auth.getPrincipal(), key, id, req));
  }

  /** 출시 취소 — 출시일은 남는다. OWNER·ADMIN. */
  @PostMapping("/{id}/unrelease")
  @RequirePermission("project:manage")
  public ResponseEntity<VersionResponse> unrelease(
      Authentication auth, @PathVariable String key, @PathVariable long id) {
    return ResponseEntity.ok(versionService.unrelease((Long) auth.getPrincipal(), key, id));
  }

  /** 붙은 이슈 수(수정·영향·끝나지 않은 수정) — 삭제 확인창·출시 대화상자 안내. */
  @GetMapping("/{id}/issue-count")
  @RequirePermission("project:read")
  public ResponseEntity<VersionIssueCount> issueCount(
      Authentication auth, @PathVariable String key, @PathVariable long id) {
    return ResponseEntity.ok(versionService.issueCount((Long) auth.getPrincipal(), key, id));
  }

  /** 보관한 버전 삭제 — moveTo 가 있으면 붙어 있던 이슈를 같은 종류로 그 버전에 옮기고, 없으면 떼기만. OWNER·ADMIN. */
  @DeleteMapping("/{id}")
  @RequirePermission("project:manage")
  public ResponseEntity<Void> delete(
      Authentication auth,
      @PathVariable String key,
      @PathVariable long id,
      @RequestParam(required = false) Long moveTo) {
    versionService.delete((Long) auth.getPrincipal(), key, id, moveTo);
    return ResponseEntity.noContent().build();
  }
}
