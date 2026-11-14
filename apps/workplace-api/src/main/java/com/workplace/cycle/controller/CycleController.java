package com.workplace.cycle.controller;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.dto.CycleCompleteRequest;
import com.workplace.cycle.dto.CycleCompleteResponse;
import com.workplace.cycle.dto.CycleResponse;
import com.workplace.cycle.service.CycleService;
import com.workplace.global.security.RequirePermission;
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

/**
 * 프로젝트 스코프 사이클 CRUD 컨트롤러. 변경은 버전처럼 {@code project:manage} 로 걸고, 실제 판정(프로젝트 OWNER)은 서비스 레이어가
 * 한다(WP-1008).
 */
@RestController
@RequestMapping("/api/v1/projects/{key}/cycles")
@RequiredArgsConstructor
public class CycleController {

  private final CycleService cycleService;

  /** 사이클 전체 목록 — 멤버 권한이면 조회 가능. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<CycleResponse>> list(Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(cycleService.list((Long) auth.getPrincipal(), key));
  }

  /** 신규 사이클 생성 — OWNER 권한. */
  @PostMapping
  @RequirePermission("project:manage")
  public ResponseEntity<CycleResponse> create(
      Authentication auth, @PathVariable String key, @Valid @RequestBody CreateCycleRequest req) {
    return ResponseEntity.ok(cycleService.create((Long) auth.getPrincipal(), key, req));
  }

  /** 사이클 수정 — OWNER 권한. */
  @PatchMapping("/{cycleId}")
  @RequirePermission("project:manage")
  public ResponseEntity<CycleResponse> update(
      Authentication auth,
      @PathVariable String key,
      @PathVariable Long cycleId,
      @Valid @RequestBody CreateCycleRequest req) {
    return ResponseEntity.ok(cycleService.update((Long) auth.getPrincipal(), key, cycleId, req));
  }

  /** 사이클 삭제 — OWNER 권한. */
  @DeleteMapping("/{cycleId}")
  @RequirePermission("project:manage")
  public ResponseEntity<Void> delete(
      Authentication auth, @PathVariable String key, @PathVariable Long cycleId) {
    cycleService.delete((Long) auth.getPrincipal(), key, cycleId);
    return ResponseEntity.noContent().build();
  }

  /**
   * 사이클 완료 — OWNER 권한. 진행 중 사이클을 완료 처리하고, 미완료 이슈를 지정한 곳으로 이동한다(WP-1578).
   *
   * <p>완료 처리 + 새 사이클 생성(또는 예정 사이클 시작) + 이슈 추가는 한 트랜잭션으로 처리한다. destination이 NONE이면 사이클만 완료한다.
   */
  @PostMapping("/{cycleId}/complete")
  @RequirePermission("project:manage")
  public ResponseEntity<CycleCompleteResponse> complete(
      Authentication auth,
      @PathVariable String key,
      @PathVariable Long cycleId,
      @Valid @RequestBody CycleCompleteRequest req) {
    return ResponseEntity.ok(cycleService.complete((Long) auth.getPrincipal(), key, cycleId, req));
  }
}
