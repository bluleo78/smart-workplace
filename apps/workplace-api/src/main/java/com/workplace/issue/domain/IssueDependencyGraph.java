package com.workplace.issue.domain;

import java.util.ArrayDeque;
import java.util.Collection;
import java.util.Deque;
import java.util.HashSet;
import java.util.Set;
import java.util.function.LongFunction;

/**
 * 차단(의존성) 그래프 탐색 — 차단을 걸 때(의존성 API)와 관계 일괄 가져오기가 같은 순환 검사를 쓴다(WP-887). 이웃을 어디서 읽을지(DB, 요청 안에서 앞서
 * 받아들인 간선 등)는 부르는 쪽이 정한다.
 */
public final class IssueDependencyGraph {

  private IssueDependencyGraph() {}

  /**
   * start 에서 간선을 따라 goal 에 닿는가 — 반복 DFS(깊은 사슬에서도 스택이 넘치지 않게). (from → to) 간선을 더하면 순환인지는 {@code
   * reaches(to, from, …)} 로 본다.
   *
   * @param neighbors 노드 → 그 노드가 막는 노드들. 노드마다 한 번만 불린다
   */
  public static boolean reaches(
      long start, long goal, LongFunction<? extends Collection<Long>> neighbors) {
    Set<Long> visited = new HashSet<>();
    Deque<Long> stack = new ArrayDeque<>();
    stack.push(start);
    while (!stack.isEmpty()) {
      long cur = stack.pop();
      if (cur == goal) {
        return true;
      }
      if (!visited.add(cur)) {
        continue;
      }
      neighbors.apply(cur).forEach(stack::push);
    }
    return false;
  }
}
