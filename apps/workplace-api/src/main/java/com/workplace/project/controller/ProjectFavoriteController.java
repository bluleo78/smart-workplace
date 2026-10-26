package com.workplace.project.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.project.dto.ImportProjectFavoritesRequest;
import com.workplace.project.dto.ProjectFavoritesResponse;
import com.workplace.project.service.ProjectFavoriteService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 내 프로젝트 즐겨찾기 API(WP-1001). 사용자별 설정이라 /me 아래에 둔다 — /projects/{key} 와 경로가 겹치지 않게(「favorites」라는 key 와
 * 부딪치지 않게).
 */
@RestController
@RequestMapping("/api/v1/me/project-favorites")
@RequiredArgsConstructor
public class ProjectFavoriteController {

  private final ProjectFavoriteService service;

  /** 내 즐겨찾기 프로젝트 key — 즐겨찾기한 순서. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<ProjectFavoritesResponse> list(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(service.list(callerId));
  }

  /** 즐겨찾기 추가 — 멱등. 볼 수 없는 프로젝트는 404. */
  @PutMapping("/{key}")
  @RequirePermission("project:read")
  public ResponseEntity<Void> add(
      @AuthenticationPrincipal Long callerId, @PathVariable String key) {
    service.add(callerId, key);
    return ResponseEntity.noContent().build();
  }

  /** 즐겨찾기 해제 — 멱등(없어도 204). */
  @DeleteMapping("/{key}")
  @RequirePermission("project:read")
  public ResponseEntity<Void> remove(
      @AuthenticationPrincipal Long callerId, @PathVariable String key) {
    service.remove(callerId, key);
    return ResponseEntity.noContent().build();
  }

  /** 브라우저에만 있던 즐겨찾기 이관 — 볼 수 없는 key 는 건너뛰고, 올린 뒤의 목록을 돌려준다. */
  @PostMapping("/import")
  @RequirePermission("project:read")
  public ResponseEntity<ProjectFavoritesResponse> importKeys(
      @AuthenticationPrincipal Long callerId,
      @Valid @RequestBody ImportProjectFavoritesRequest req) {
    return ResponseEntity.ok(service.importKeys(callerId, req.projectKeys()));
  }
}
