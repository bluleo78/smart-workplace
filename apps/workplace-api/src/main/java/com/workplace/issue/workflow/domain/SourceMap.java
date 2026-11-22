package com.workplace.issue.workflow.domain;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 문서 안 경로(예: {@code nodes.dev.outcomes.ask.to}) → 줄·열 위치표.
 *
 * <p>왜: 검증기는 DB 도 YAML 도 모르고 모델만 받는다. 그래서 모델의 어느 자리가 원문 몇 행 몇 열인지 이 표로 묻는다. 맵 항목의 위치는 그 키가 적힌 자리이고,
 * 목록 항목은 {@code start.0.to} 처럼 번호를 경로에 쓰며 그 항목이 시작하는 자리다. 경로를 단계별 트라이로 저장해 키가 긴 문서에서도 경로 문자열을 반복해
 * 쌓지 않는다(저장 크기는 노드 수에 비례). 키 안에 점이 있으면 점 구분 조회가 맞지 않아 가까운 부모로 물러난다.
 */
public final class SourceMap {

  /** 1 부터 시작하는 줄·열. */
  public record Pos(int line, int column) {}

  /** 위치를 끝내 모를 때의 1행 1열. */
  private static final Pos ORIGIN = new Pos(1, 1);

  /** 트라이 한 칸: 이 경로의 위치(없을 수 있음)와 자식 단계들. */
  private static final class Entry {
    Pos pos;
    Map<String, Entry> children;
  }

  private final Entry root = new Entry();

  private SourceMap() {}

  /** 빈 위치표 — 모든 조회가 1행 1열이고 {@link #has} 는 항상 false. */
  public static SourceMap empty() {
    return new SourceMap();
  }

  /** 새 위치표를 만든다(파서 전용). */
  static SourceMap create() {
    return new SourceMap();
  }

  /** 경로의 위치. 없으면 가장 가까운 부모의 위치, 끝내 없으면 1행 1열. 빈 경로는 문서 처음. */
  public Pos at(String path) {
    return at(split(path));
  }

  /** 이 경로가 원문(또는 ask 펼침)에 실제로 있는지. 노드의 종류별 필드 허용 검사에 쓴다. */
  public boolean has(String path) {
    return has(split(path));
  }

  /** 단계 목록으로 위치를 찾는다(내부용 — 키에 점이 있어도 정확하다). */
  Pos at(List<String> segments) {
    Entry cur = root;
    Pos best = root.pos;
    for (String s : segments) {
      Entry next = cur.children == null ? null : cur.children.get(s);
      if (next == null) {
        break;
      }
      cur = next;
      if (cur.pos != null) {
        best = cur.pos;
      }
    }
    return best == null ? ORIGIN : best;
  }

  /** 단계 목록이 실제로 등록돼 있는지. */
  boolean has(List<String> segments) {
    Entry cur = root;
    for (String s : segments) {
      cur = cur.children == null ? null : cur.children.get(s);
      if (cur == null) {
        return false;
      }
    }
    return cur.pos != null;
  }

  /** 경로의 위치를 등록한다(이미 있으면 덮어쓴다). */
  void put(List<String> segments, Pos pos) {
    Entry cur = root;
    for (String s : segments) {
      if (cur.children == null) {
        cur.children = new HashMap<>();
      }
      cur = cur.children.computeIfAbsent(s, k -> new Entry());
    }
    cur.pos = pos;
  }

  /** 점으로 이은 경로를 단계로 쪼갠다(빈 문자열은 빈 목록). */
  private static List<String> split(String path) {
    List<String> out = new ArrayList<>();
    if (path == null || path.isEmpty()) {
      return out;
    }
    int from = 0;
    for (int i = 0; i <= path.length(); i++) {
      if (i == path.length() || path.charAt(i) == '.') {
        out.add(path.substring(from, i));
        from = i + 1;
      }
    }
    return out;
  }
}
