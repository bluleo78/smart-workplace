package com.workplace.issue.workflow.domain;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 노드 번호(0..n-1)로 이루어진 방향 그래프와 그 위의 계산(도달·역도달·고리).
 *
 * <p>왜: 검증기가 닿지 않는 노드·막다른 노드·되돌림 고리를 판정할 때 노드마다 다시 탐색하면 노드 수천 개에서 느려진다. 그래서 선을 한 번 모아 O(노드+선) 으로
 * 계산한다. 모든 탐색은 반복문이다 — 사슬이 수천 개여도 호출 스택이 넘치지 않는다. 선마다 표지(flags)가 있어 계산이 어떤 선을 셀지 고른다.
 */
final class WorkflowGraph {

  /** 선 표지: onError 로 가는 선(사람 조치라 완주 계산에서 뺀다). */
  static final int ON_ERROR = 1;

  /** 선 표지: returnTo 로 돌아가는 결과 선(되돌림 고리 계산에서 뺀다). */
  static final int RETURN = 2;

  private final int n;
  private int[] from = new int[16];
  private int[] to = new int[16];
  private int[] flags = new int[16];
  private int m;

  /** 나가는 선 목록(CSR): outOff[v]..outOff[v+1] 구간이 v 에서 나가는 선 번호. */
  private int[] outOff;

  private int[] outEdge;

  /** 들어오는 선 목록(CSR). */
  private int[] inOff;

  private int[] inEdge;

  /** 노드 수로 빈 그래프를 만든다 — 노드를 번호로 다뤄 긴 키를 비교·복사하지 않는다. */
  WorkflowGraph(int nodeCount) {
    this.n = nodeCount;
  }

  /** 선 하나를 더한다(계산을 시작한 뒤에는 더하지 않는다). */
  void edge(int fromNode, int toNode, int edgeFlags) {
    if (m == from.length) {
      from = Arrays.copyOf(from, m * 2);
      to = Arrays.copyOf(to, m * 2);
      flags = Arrays.copyOf(flags, m * 2);
    }
    from[m] = fromNode;
    to[m] = toNode;
    flags[m] = edgeFlags;
    m++;
  }

  /** 선 목록을 노드별 구간 배열로 굳힌다(처음 계산할 때 한 번). */
  private void seal() {
    if (outOff != null) {
      return;
    }
    outOff = new int[n + 1];
    inOff = new int[n + 1];
    for (int e = 0; e < m; e++) {
      outOff[from[e] + 1]++;
      inOff[to[e] + 1]++;
    }
    for (int v = 0; v < n; v++) {
      outOff[v + 1] += outOff[v];
      inOff[v + 1] += inOff[v];
    }
    outEdge = new int[m];
    inEdge = new int[m];
    int[] outFill = Arrays.copyOf(outOff, n);
    int[] inFill = Arrays.copyOf(inOff, n);
    for (int e = 0; e < m; e++) {
      outEdge[outFill[from[e]]++] = e;
      inEdge[inFill[to[e]]++] = e;
    }
  }

  /** src 에서 선을 따라 닿는 노드(src 자신 포함). excludeFlags 표지가 하나라도 겹치는 선은 건너뛴다. */
  boolean[] reachableFrom(int src, int excludeFlags) {
    seal();
    boolean[] seen = new boolean[n];
    int[] queue = new int[n];
    int head = 0;
    int tail = 0;
    seen[src] = true;
    queue[tail++] = src;
    while (head < tail) {
      int v = queue[head++];
      for (int k = outOff[v]; k < outOff[v + 1]; k++) {
        int e = outEdge[k];
        if ((flags[e] & excludeFlags) == 0 && !seen[to[e]]) {
          seen[to[e]] = true;
          queue[tail++] = to[e];
        }
      }
    }
    return seen;
  }

  /** targets 중 하나에 선을 따라 닿을 수 있는 노드(targets 자신 포함). 거꾸로 한 번 훑는다. */
  boolean[] canReach(boolean[] targets, int excludeFlags) {
    seal();
    boolean[] seen = new boolean[n];
    int[] queue = new int[n];
    int head = 0;
    int tail = 0;
    for (int v = 0; v < n; v++) {
      if (targets[v]) {
        seen[v] = true;
        queue[tail++] = v;
      }
    }
    while (head < tail) {
      int v = queue[head++];
      for (int k = inOff[v]; k < inOff[v + 1]; k++) {
        int e = inEdge[k];
        if ((flags[e] & excludeFlags) == 0 && !seen[from[e]]) {
          seen[from[e]] = true;
          queue[tail++] = from[e];
        }
      }
    }
    return seen;
  }

  /**
   * keep 인 노드끼리의 선(excludeFlags 제외)이 만드는 강연결 묶음 중 고리인 것(노드 둘 이상 또는 자기 자신으로 가는 선)을 돌려준다. 각 묶음은 노드 번호
   * 오름차순이라 첫 원소가 정의 순서 첫 노드이고, 묶음 목록도 첫 원소 순이다. 반복형 Tarjan.
   */
  List<int[]> cycles(boolean[] keep, int excludeFlags) {
    seal();
    int[] index = new int[n];
    Arrays.fill(index, -1);
    int[] low = new int[n];
    boolean[] onStack = new boolean[n];
    int[] stack = new int[n];
    int sp = 0;
    int[] callNode = new int[n];
    int[] callPos = new int[n];
    int counter = 0;
    List<int[]> out = new ArrayList<>();
    for (int root = 0; root < n; root++) {
      if (!keep[root] || index[root] >= 0) {
        continue;
      }
      int cp = 0;
      index[root] = counter;
      low[root] = counter++;
      stack[sp++] = root;
      onStack[root] = true;
      callNode[cp] = root;
      callPos[cp++] = outOff[root];
      while (cp > 0) {
        int v = callNode[cp - 1];
        if (callPos[cp - 1] < outOff[v + 1]) {
          int e = outEdge[callPos[cp - 1]++];
          int w = to[e];
          if ((flags[e] & excludeFlags) != 0 || !keep[w]) {
            continue;
          }
          if (index[w] < 0) {
            index[w] = counter;
            low[w] = counter++;
            stack[sp++] = w;
            onStack[w] = true;
            callNode[cp] = w;
            callPos[cp++] = outOff[w];
          } else if (onStack[w]) {
            low[v] = Math.min(low[v], index[w]);
          }
        } else {
          if (low[v] == index[v]) {
            int start = sp;
            do {
              start--;
              onStack[stack[start]] = false;
            } while (stack[start] != v);
            int[] comp = Arrays.copyOfRange(stack, start, sp);
            sp = start;
            if (comp.length > 1 || hasSelfEdge(v, excludeFlags)) {
              Arrays.sort(comp);
              out.add(comp);
            }
          }
          cp--;
          if (cp > 0) {
            int parent = callNode[cp - 1];
            low[parent] = Math.min(low[parent], low[v]);
          }
        }
      }
    }
    out.sort((a, b) -> Integer.compare(a[0], b[0]));
    return out;
  }

  /** v 에서 v 로 돌아오는 선이 있는지. */
  private boolean hasSelfEdge(int v, int excludeFlags) {
    for (int k = outOff[v]; k < outOff[v + 1]; k++) {
      int e = outEdge[k];
      if (to[e] == v && (flags[e] & excludeFlags) == 0) {
        return true;
      }
    }
    return false;
  }
}
