package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.CycleProgress;
import com.workplace.issue.service.IssueCycleService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 프로젝트 사이클 진행 집계 — 멤버 권한. */
@RestController
@RequestMapping("/api/v1/projects/{key}/cycles/progress")
@RequiredArgsConstructor
public class CycleProgressController {

  private final IssueCycleService issueCycleService;

  /** 프로젝트 전 사이클의 상태별 진행 집계. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<CycleProgress>> progress(
      Authentication auth, @PathVariable String key) {
    return ResponseEntity.ok(issueCycleService.progress((Long) auth.getPrincipal(), key));
  }
}
