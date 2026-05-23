package com.workplace.label.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.label.dto.CreateLabelRequest;
import com.workplace.label.dto.LabelResponse;
import com.workplace.label.service.LabelService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
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

/** 프로젝트 스코프 라벨 CRUD 컨트롤러. OWNER 검증은 서비스 레이어. */
@RestController
@RequestMapping("/api/v1/projects/{key}/labels")
@RequiredArgsConstructor
public class LabelController {

  private final LabelService labelService;

  /** 라벨 전체 목록 — 멤버 권한이면 조회 가능. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<LabelResponse>> list(Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(labelService.list((Long) auth.getPrincipal(), key));
  }

  /** 신규 라벨 생성 — OWNER 권한. */
  @PostMapping
  @RequirePermission("label:manage")
  public ResponseEntity<LabelResponse> create(
      Authentication auth, @PathVariable String key, @Valid @RequestBody CreateLabelRequest req) {
    return ResponseEntity.ok(labelService.create((Long) auth.getPrincipal(), key, req));
  }

  /** 라벨 이름/색상 수정 — OWNER 권한. */
  @PatchMapping("/{labelId}")
  @RequirePermission("label:manage")
  public ResponseEntity<LabelResponse> update(
      Authentication auth,
      @PathVariable String key,
      @PathVariable Long labelId,
      @Valid @RequestBody CreateLabelRequest req) {
    return ResponseEntity.ok(labelService.update((Long) auth.getPrincipal(), key, labelId, req));
  }

  /** 라벨 삭제 — OWNER 권한. */
  @DeleteMapping("/{labelId}")
  @RequirePermission("label:manage")
  public ResponseEntity<Void> delete(
      Authentication auth, @PathVariable String key, @PathVariable Long labelId) {
    labelService.delete((Long) auth.getPrincipal(), key, labelId);
    return ResponseEntity.noContent().build();
  }
}
