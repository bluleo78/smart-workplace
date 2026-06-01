package com.workplace.view.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.view.dto.SaveViewRequest;
import com.workplace.view.dto.SavedViewResponse;
import com.workplace.view.service.SavedViewService;
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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** 프로젝트 스코프 저장된 뷰 CRUD. 세부 소유/공유 검증은 서비스 레이어. */
@RestController
@RequestMapping("/api/v1/projects/{key}/saved-views")
@RequiredArgsConstructor
public class SavedViewController {

  private final SavedViewService service;

  /** 목록 — 멤버 권한이면 조회(내 것 + SHARED). */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<SavedViewResponse>> list(
      Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(service.list((Long) auth.getPrincipal(), key));
  }

  /** 생성 — 멤버 누구나(자기 뷰). */
  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  @RequirePermission("savedview:manage")
  public ResponseEntity<SavedViewResponse> create(
      Authentication auth, @PathVariable String key, @Valid @RequestBody SaveViewRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.create((Long) auth.getPrincipal(), key, req));
  }

  /** 수정 — owner 본인. */
  @PatchMapping("/{id}")
  @RequirePermission("savedview:manage")
  public ResponseEntity<SavedViewResponse> update(
      Authentication auth,
      @PathVariable String key,
      @PathVariable Long id,
      @Valid @RequestBody SaveViewRequest req) {
    return ResponseEntity.ok(service.update((Long) auth.getPrincipal(), key, id, req));
  }

  /** 삭제 — owner 본인 또는 SHARED 모더레이터. */
  @DeleteMapping("/{id}")
  @RequirePermission("savedview:manage")
  public ResponseEntity<Void> delete(
      Authentication auth, @PathVariable String key, @PathVariable Long id) {
    service.delete((Long) auth.getPrincipal(), key, id);
    return ResponseEntity.noContent().build();
  }
}
