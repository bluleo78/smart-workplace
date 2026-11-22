package com.workplace.issue.workflow.domain;

import com.workplace.issue.workflow.dto.WorkflowProblem;
import java.util.List;

/**
 * YAML 파싱 결과.
 *
 * <p>왜: 문제가 있어도 위치와 함께 모두 돌려줘야 편집기가 한 번에 보여 주고, 검증기는 같은 위치표로 자기 문제의 줄·열을 찍는다.
 *
 * @param model ERROR 가 하나라도 있으면 null
 * @param problems 발견한 문제(줄·열 순)
 * @param source 경로 → 줄·열 위치표(문법 오류로 트리가 없으면 빈 표)
 */
public record ParseResult(WorkflowModel model, List<WorkflowProblem> problems, SourceMap source) {

  /** 문제 목록을 불변으로 굳힌다(null 이면 빈 목록). */
  public ParseResult {
    problems = problems == null ? List.of() : List.copyOf(problems);
    source = source == null ? SourceMap.empty() : source;
  }
}
