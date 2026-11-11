package com.workplace.help.controller;

import com.workplace.global.security.PermissionChecker;
import com.workplace.help.dto.HelpSearchResponse;
import com.workplace.help.service.HelpSearchService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 도움말 검색 API(WP-1509) — 로그인한 누구나. 관리자 역할이면 관리자 전용 장도 검색 대상에 든다. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/help")
public class HelpSearchController {

  private final HelpSearchService service;
  private final PermissionChecker permissionChecker;

  /** 질의로 도움말 절을 찾는다. limit 은 서비스가 기본 8·최대 20 으로 맞춘다. */
  @GetMapping("/search")
  public ResponseEntity<HelpSearchResponse> search(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(name = "q", defaultValue = "") String q,
      @RequestParam(name = "limit", defaultValue = "8") int limit) {
    boolean admin = permissionChecker.userHasRole(callerId, "ADMIN");
    return ResponseEntity.ok(HelpSearchResponse.from(service.search(q, admin, limit)));
  }
}
