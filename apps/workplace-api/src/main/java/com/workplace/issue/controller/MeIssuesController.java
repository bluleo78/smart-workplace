package com.workplace.issue.controller;

import com.workplace.issue.dto.IssueSearchResponse;
import com.workplace.issue.service.IssueSearchService;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 7c: 홈 위젯용 프로젝트 횡단 "내 이슈" 검색. 호출자가 멤버인 모든 프로젝트를 필터/커서로 조회. */
@RestController
@RequiredArgsConstructor
public class MeIssuesController {

  private final IssueSearchService issueSearchService;

  /**
   * GET /api/v1/me/issues — params 는 per-project 검색과 동일(assignee=me 권장). 인증 필요, 추가 권한 없음(멤버십으로
   * 스코프).
   */
  @GetMapping("/api/v1/me/issues")
  public ResponseEntity<IssueSearchResponse> mine(
      Authentication auth, @RequestParam Map<String, String> params) {
    return ResponseEntity.ok(issueSearchService.searchMine((Long) auth.getPrincipal(), params));
  }
}
