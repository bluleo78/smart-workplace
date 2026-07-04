package com.workplace.milestone.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.milestone.dto.CreateMilestoneRequest;
import com.workplace.milestone.dto.MilestoneResponse;
import com.workplace.milestone.service.MilestoneService;
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
import org.springframework.web.bind.annotation.RestController;

/** 프로젝트 스코프 마일스톤 CRUD 컨트롤러. 멤버십 검증은 서비스 레이어(ProjectAccessGuard). */
@RestController
@RequestMapping("/api/v1/projects/{key}/milestones")
@RequiredArgsConstructor
public class MilestoneController {

  private final MilestoneService milestoneService;

  /** 마일스톤 전체 목록 — 읽기 권한이면 조회 가능. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<MilestoneResponse>> list(
      Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(milestoneService.list((Long) auth.getPrincipal(), key));
  }

  /** 신규 마일스톤 생성 — 멤버 권한. */
  @PostMapping
  @RequirePermission("milestone:manage")
  public ResponseEntity<MilestoneResponse> create(
      Authentication auth,
      @PathVariable String key,
      @Valid @RequestBody CreateMilestoneRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(milestoneService.create((Long) auth.getPrincipal(), key, req));
  }

  /** 마일스톤 수정 — 멤버 권한. */
  @PatchMapping("/{milestoneId}")
  @RequirePermission("milestone:manage")
  public ResponseEntity<MilestoneResponse> update(
      Authentication auth,
      @PathVariable String key,
      @PathVariable Long milestoneId,
      @Valid @RequestBody CreateMilestoneRequest req) {
    return ResponseEntity.ok(
        milestoneService.update((Long) auth.getPrincipal(), key, milestoneId, req));
  }

  /** 마일스톤 삭제 — 멤버 권한. */
  @DeleteMapping("/{milestoneId}")
  @RequirePermission("milestone:manage")
  public ResponseEntity<Void> delete(
      Authentication auth, @PathVariable String key, @PathVariable Long milestoneId) {
    milestoneService.delete((Long) auth.getPrincipal(), key, milestoneId);
    return ResponseEntity.noContent().build();
  }
}
