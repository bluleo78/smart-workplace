package com.workplace.drive.controller;

import com.workplace.drive.dto.DriveContentSearchResponse;
import com.workplace.drive.service.DriveContentSearchService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Drive 콘텐츠 검색. spaceId 미지정 시 테넌트 전역, 지정 시 해당 공간으로 제한(기존 space-scoped 파일명 검색 /spaces/{id}/search 와
 * 별개 API).
 */
@RestController
@RequestMapping("/api/v1/drive")
public class DriveContentSearchController {

  private final DriveContentSearchService svc;

  public DriveContentSearchController(DriveContentSearchService svc) {
    this.svc = svc;
  }

  /** 콘텐츠 하이브리드 검색. RLS+멤버십으로 접근 가능 파일만 반환. spaceId 지정 시 해당 공간으로 결과 제한. */
  @GetMapping("/search")
  public ResponseEntity<DriveContentSearchResponse> search(
      @AuthenticationPrincipal Long callerId,
      @RequestParam String q,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Long spaceId) {
    return ResponseEntity.ok(svc.search(callerId, q, limit, spaceId));
  }
}
