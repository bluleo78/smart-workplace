package com.workplace.issue.workflow.domain;

import com.workplace.global.util.Texts;
import com.workplace.issue.workflow.dto.WorkflowProblem;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Supplier;
import org.yaml.snakeyaml.error.Mark;

/**
 * 파싱 한 번의 작업 상태: 위치 변환표·위치표·문제 모음.
 *
 * <p>왜: 검사 단계(작성·점검·스키마·모델 만들기)가 같은 위치표와 문제 목록을 나눠 쓴다. 문제는 상한(100건)에서 멈춘다 — 악의적인 큰 문서가 응답 크기와 일을
 * 키우지 못하게 하기 위해서다. 같은 코드·위치의 문제는 한 번만 담는다.
 */
final class ParseSession {

  /** 한 번에 모아 내는 문제 수 상한. */
  static final int MAX_PROBLEMS = 100;

  final LineIndex lines;
  final SourceMap source = SourceMap.create();
  private final List<WorkflowProblem> problems = new ArrayList<>();
  private final Set<String> seen = new HashSet<>();

  ParseSession(String text) {
    this.lines = new LineIndex(text.codePoints().toArray());
  }

  /** SnakeYAML 표시의 위치(편집기 기준 1 부터). */
  SourceMap.Pos pos(Mark mark) {
    return lines.at(mark.getIndex());
  }

  /** 문구에 되비추는 키·값·경로 조각의 최대 길이. */
  static final int MAX_ECHO = 80;

  /** 문제 문구 전체의 최대 길이. */
  static final int MAX_MESSAGE = 500;

  /** 문제 nodeKey 의 최대 길이. */
  static final int MAX_NODE_KEY = 100;

  /** 문제가 상한까지 찼는지(찼으면 문구를 만들 필요가 없다). */
  boolean full() {
    return problems.size() >= MAX_PROBLEMS;
  }

  /** 문구에 되비추는 글을 80자까지만 남기고 …를 붙인다(짝 없는 서로게이트를 만들지 않는다). */
  static String clip(String text) {
    if (text == null || text.length() <= MAX_ECHO) {
      return text;
    }
    return Texts.headUtf16(text, MAX_ECHO) + "…";
  }

  /** 상수 문구 ERROR. */
  void error(String code, String message, SourceMap.Pos pos, String nodeKey) {
    error(code, () -> message, pos, nodeKey);
  }

  /**
   * 위치를 직접 지정한 ERROR 를 담는다. 문구는 상한이 차지 않았을 때만 만든다 — 악의적인 문서가 긴 키·값을 문구로 되비춰 응답을 키우는 것을 막는다. 같은
   * 코드·위치는 한 번만 담고(중복 제거에 문구를 쓰지 않는다), 문구는 500자, nodeKey 는 100자로 자른다.
   */
  void error(String code, Supplier<String> message, SourceMap.Pos pos, String nodeKey) {
    error(code, message, pos, nodeKey, null);
  }

  /**
   * detail 은 같은 자리의 서로 다른 오류를 가르는 짧은 구분값(스키마에서 온 빠진 필수 필드 이름 등)이다. 원문 키·값·경로·문구는 넣지 않는다 — 중복 제거 열쇠가
   * 긴 입력을 붙잡지 않게 하기 위해서다.
   */
  void error(
      String code, Supplier<String> message, SourceMap.Pos pos, String nodeKey, String detail) {
    if (full()
        || !seen.add(
            code + ":" + pos.line() + ":" + pos.column() + ":" + (detail == null ? "" : detail))) {
      return;
    }
    problems.add(
        new WorkflowProblem(
            WorkflowProblem.ERROR,
            code,
            limitMessage(message.get()),
            pos.line(),
            pos.column(),
            limitNodeKey(nodeKey)));
  }

  /** 문제 문구를 500자 안으로 자른다(검증기도 같은 상한을 쓴다). */
  static String limitMessage(String text) {
    return text.length() > MAX_MESSAGE ? Texts.headUtf16(text, MAX_MESSAGE - 1) + "…" : text;
  }

  /** 문제 nodeKey 를 100자 안으로 자른다(null 은 그대로). */
  static String limitNodeKey(String nodeKey) {
    return Texts.headUtf16(nodeKey, MAX_NODE_KEY);
  }

  /** 경로의 위치(없으면 가까운 부모)에 ERROR 를 담는다. */
  void errorAt(String code, Supplier<String> message, List<String> path) {
    errorAt(code, message, path, null);
  }

  /** 구분값이 있는 버전(같은 자리의 서로 다른 오류를 모두 담는다). */
  void errorAt(String code, Supplier<String> message, List<String> path, String detail) {
    if (full()) {
      return;
    }
    error(code, message, source.at(path), nodeKey(path), detail);
  }

  /** 상수 문구 버전. */
  void errorAt(String code, String message, List<String> path) {
    errorAt(code, () -> message, path);
  }

  /** 경로가 {@code nodes.<키>…} 이면 그 노드 키, 아니면 null. */
  static String nodeKey(List<String> path) {
    return path.size() >= 2 && "nodes".equals(path.get(0)) ? path.get(1) : null;
  }

  /** ERROR 가 하나라도 있는지. */
  boolean hasError() {
    return !problems.isEmpty();
  }

  /** 줄·열 순으로 정렬한 문제 목록(같은 위치면 발견 순서 유지). */
  List<WorkflowProblem> sortedProblems() {
    List<WorkflowProblem> out = new ArrayList<>(problems);
    out.sort(
        Comparator.comparingInt(WorkflowProblem::line).thenComparingInt(WorkflowProblem::column));
    return out;
  }
}
