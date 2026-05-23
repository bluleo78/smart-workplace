package com.workplace.watcher.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.IssueSearchResponse;
import com.workplace.watcher.dto.WatcherResponse;
import com.workplace.watcher.service.WatcherService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 이슈 watcher 토글 + /api/v1/me/watched-issues 엔드포인트. */
@RestController
@RequiredArgsConstructor
public class WatcherController {

  private final WatcherService watcherService;

  /** 이슈의 watcher 목록. */
  @GetMapping("/api/v1/projects/{key}/issues/{number}/watchers")
  @RequirePermission("project:read")
  public ResponseEntity<List<WatcherResponse>> list(
      Authentication auth, @PathVariable String key, @PathVariable int number) {
    return ResponseEntity.ok(watcherService.list((Long) auth.getPrincipal(), key, number));
  }

  /** 본인을 watcher 로 등록. */
  @PostMapping("/api/v1/projects/{key}/issues/{number}/watch")
  @RequirePermission("project:read")
  public ResponseEntity<Void> watch(
      Authentication auth, @PathVariable String key, @PathVariable int number) {
    watcherService.watch((Long) auth.getPrincipal(), key, number);
    return ResponseEntity.noContent().build();
  }

  /** 본인 watcher 해제. */
  @DeleteMapping("/api/v1/projects/{key}/issues/{number}/watch")
  @RequirePermission("project:read")
  public ResponseEntity<Void> unwatch(
      Authentication auth, @PathVariable String key, @PathVariable int number) {
    watcherService.unwatch((Long) auth.getPrincipal(), key, number);
    return ResponseEntity.noContent().build();
  }

  /** 호출자가 watch 한 이슈 목록 (cursor 페이지네이션, 비멤버 프로젝트 자동 숨김). */
  @GetMapping("/api/v1/me/watched-issues")
  public ResponseEntity<IssueSearchResponse> watched(
      Authentication auth,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "30") int size) {
    return ResponseEntity.ok(
        watcherService.watchedIssues((Long) auth.getPrincipal(), cursor, size));
  }
}
