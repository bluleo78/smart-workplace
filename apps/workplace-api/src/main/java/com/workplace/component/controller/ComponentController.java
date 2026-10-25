package com.workplace.component.controller;

import com.workplace.component.dto.ComponentResponse;
import com.workplace.component.dto.CreateComponentRequest;
import com.workplace.component.dto.UpdateComponentRequest;
import com.workplace.component.service.ComponentService;
import com.workplace.global.security.RequirePermission;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
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
import org.springframework.web.bind.annotation.RestController;

/**
 * 프로젝트 구성요소 목록 관리 REST API(WP-933). 보기는 프로젝트를 읽을 수 있는 사람({@code project:read}), 변경은 OWNER·ADMIN —
 * 역할 검증은 서비스 레이어가 한다(이슈 유형 관리와 같은 규칙).
 */
@RestController
@RequestMapping("/api/v1/projects/{key}/components")
@RequiredArgsConstructor
public class ComponentController {

  private final ComponentService componentService;

  /** 구성요소 전체 목록(보관 포함, 이름 순). */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<ComponentResponse>> list(
      Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(componentService.list((Long) auth.getPrincipal(), key));
  }

  /** 구성요소 추가 — OWNER·ADMIN. */
  @PostMapping
  @RequirePermission("project:manage")
  public ResponseEntity<ComponentResponse> create(
      Authentication auth,
      @PathVariable String key,
      @Valid @RequestBody CreateComponentRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(componentService.create((Long) auth.getPrincipal(), key, req));
  }

  /** 이름·설명·담당자·보관 여부 수정(보낸 필드만) — OWNER·ADMIN. */
  @PatchMapping("/{id}")
  @RequirePermission("project:manage")
  public ResponseEntity<ComponentResponse> update(
      Authentication auth,
      @PathVariable String key,
      @PathVariable long id,
      @Valid @RequestBody UpdateComponentRequest req) {
    return ResponseEntity.ok(componentService.update((Long) auth.getPrincipal(), key, id, req));
  }

  /** 구성요소가 붙은 이슈 수 — 삭제 확인창의 영향 안내. */
  @GetMapping("/{id}/issue-count")
  @RequirePermission("project:read")
  public ResponseEntity<Map<String, Integer>> issueCount(
      Authentication auth, @PathVariable String key, @PathVariable long id) {
    return ResponseEntity.ok(
        Map.of("count", componentService.issueCount((Long) auth.getPrincipal(), key, id)));
  }

  /** 구성요소 삭제 — 붙어 있던 이슈에서 빠지고 이슈마다 제거 이력이 남는다. OWNER·ADMIN. */
  @DeleteMapping("/{id}")
  @RequirePermission("project:manage")
  public ResponseEntity<Void> delete(
      Authentication auth, @PathVariable String key, @PathVariable long id) {
    componentService.delete((Long) auth.getPrincipal(), key, id);
    return ResponseEntity.noContent().build();
  }
}
