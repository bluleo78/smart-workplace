package com.workplace.issue.controller;

import com.workplace.issue.dto.AiTaskCounts;
import com.workplace.issue.dto.IssueSearchResponse;
import com.workplace.issue.service.AiTaskSearchService;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 내 작업 › AI 위임 작업(WP-377 §5.2). 호출자가 접근 가능한 프로젝트 안에서 AI 에게 맡긴 이슈·사람이 AI 도구로 작업 중인 이슈를 급한 순으로 보여 주고,
 * 빠른 필터 칩 건수를 낸다. 인증만 필요(범위는 프로젝트 멤버십으로 제한).
 */
@RestController
@RequiredArgsConstructor
public class AiTasksController {

  private final AiTaskSearchService aiTaskSearchService;

  /** GET /api/v1/me/ai-tasks?scope=MINE|ALL&agentState=&status=&priority=&cursor=&size= */
  @GetMapping("/api/v1/me/ai-tasks")
  public ResponseEntity<IssueSearchResponse> list(
      Authentication auth, @RequestParam Map<String, String> params) {
    return ResponseEntity.ok(aiTaskSearchService.search((Long) auth.getPrincipal(), params));
  }

  /** GET /api/v1/me/ai-tasks/counts?scope=&status=&priority= */
  @GetMapping("/api/v1/me/ai-tasks/counts")
  public ResponseEntity<AiTaskCounts> counts(
      Authentication auth, @RequestParam Map<String, String> params) {
    return ResponseEntity.ok(aiTaskSearchService.counts((Long) auth.getPrincipal(), params));
  }
}
