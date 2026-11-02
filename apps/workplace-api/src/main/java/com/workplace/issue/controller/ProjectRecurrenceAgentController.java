package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.IssueRecurrenceAgentOption;
import com.workplace.issue.service.IssueRecurrenceService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * 프로젝트 단위 실행 일정 담당 AI 후보(WP-1315). 작업 만들기 창의 「AI 에게 맡기기」는 이슈가 생기기 전에 담당 AI 를 골라야 해서, 이슈 단위
 * 후보({@code …/issues/{number}/recurrence/agents}, WP-1314)와 같은 목록을 프로젝트 키만으로 내린다.
 */
@RestController
@RequiredArgsConstructor
public class ProjectRecurrenceAgentController {

  private final IssueRecurrenceService recurrenceService;

  /** GET — 이 프로젝트의 실행 일정에 담당으로 고를 수 있는 AI(서버 실행 AI, 남의 개인 비서 제외, 내 AI 비서가 맨 앞). */
  @GetMapping("/api/v1/projects/{key}/recurrence-agents")
  @RequirePermission("project:read")
  public List<IssueRecurrenceAgentOption> agents(Authentication auth, @PathVariable String key) {
    return recurrenceService.projectAgentOptions((Long) auth.getPrincipal(), key);
  }
}
