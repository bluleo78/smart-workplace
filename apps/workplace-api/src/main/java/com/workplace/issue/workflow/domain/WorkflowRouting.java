package com.workplace.issue.workflow.domain;

import com.workplace.issue.workflow.domain.WorkflowModel.Condition;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * 시작 조건과 자동 노드(decision) 연쇄 판정(설계 §6·§8). DB·Spring 없는 순수 함수.
 *
 * <p>왜: 시작·이동의 검증({@link MoveRules#check})과 저장(서비스)이 같은 함수로 최종 노드를 정해야 두 계산이 갈리지 않는다(원장 R1).
 */
public final class WorkflowRouting {

  /** 한 요청에서 지날 수 있는 자동 노드 수 — 넘으면 멈추고 실행을 SUSPENDED 로 둔다. */
  public static final int MAX_AUTO_STEPS = 20;

  private WorkflowRouting() {}

  /**
   * 첫 매치한 start 조건.
   *
   * @param index start 목록 안의 자리
   * @param to 도착 노드
   * @param matched 그 조건에 맞은 지금 이슈 담당(이슈 담당 순서)
   */
  public record StartMatch(int index, String to, List<Long> matched) {
    /** 매치 목록을 불변으로. */
    public StartMatch {
      matched = List.copyOf(matched);
    }
  }

  /**
   * 지나간 자동 노드 하나 — node_run 을 COMPLETED(entered=left)로 남길 때 쓴다.
   *
   * @param nodeKey 지나간 decision 노드
   * @param to 그 노드가 보낸 곳
   */
  public record Step(String nodeKey, String to) {}

  /**
   * 연쇄 결과.
   *
   * @param passed 지나간 자동 노드(순서대로, 최대 {@link #MAX_AUTO_STEPS})
   * @param stopNode 머무는 노드. 한도를 넘었으면 더 지나지 못한 자동 노드(FAILED 로 남길 자리)
   * @param limitExceeded 한도를 넘었는지
   */
  public record Route(List<Step> passed, String stopNode, boolean limitExceeded) {
    /** 지나간 목록을 불변으로. */
    public Route {
      passed = List.copyOf(passed);
    }
  }

  /**
   * start 조건을 위에서부터 보고 첫 매치를 돌려준다. 그 조건의 역할에 든 지금 이슈 담당만 매치된 사람이다.
   *
   * <p>start 조건에는 context 를 쓸 수 없다(검증기 START_CONTEXT_UNAVAILABLE). 혹시 있어도 시작 때 context 는 비었으므로 맞지
   * 않는다.
   *
   * @param issueAssignees 지금 이슈 담당(순서 유지)
   * @param members 역할 해석표(역할 밖·비활성은 자연히 빠진다)
   */
  public static Optional<StartMatch> start(
      WorkflowModel model, Collection<Long> issueAssignees, RunRoleMembers members) {
    List<Condition> conditions = model.start();
    for (int i = 0; i < conditions.size(); i++) {
      Condition c = conditions.get(i);
      if (c.assigneeRole() == null) {
        continue;
      }
      Set<Long> roleIds = members.idSet(c.assigneeRole());
      List<Long> matched = new ArrayList<>();
      if (issueAssignees != null) {
        for (Long id : issueAssignees) {
          if (id != null && roleIds.contains(id) && !matched.contains(id)) {
            matched.add(id);
          }
        }
      }
      if (!matched.isEmpty()) {
        return Optional.of(new StartMatch(i, c.to(), matched));
      }
    }
    return Optional.empty();
  }

  /**
   * {@code to} 부터 decision 을 따라가 머무는 노드를 정한다.
   *
   * @param to 결과·start 가 가리키는 첫 노드
   * @param basis assigneeRole 판정의 기준 사람들(담당 확정 <b>전</b> 값 — 설계 §8)
   * @param context 이번 이동의 출력까지 덮은 실행 context
   */
  public static Route route(
      WorkflowModel model,
      String to,
      Collection<Long> basis,
      Map<String, Object> context,
      RunRoleMembers members) {
    List<Step> passed = new ArrayList<>();
    String current = to;
    while (true) {
      Node node = current == null ? null : model.nodes().get(current);
      if (node == null || !"decision".equals(node.type())) {
        // 머무는 노드(task·end). 게시본은 검증을 통과해 없는 노드를 가리키지 않는다.
        return new Route(passed, current, false);
      }
      if (passed.size() >= MAX_AUTO_STEPS) {
        // 21 번째 자동 노드 — 지나지 않고 여기서 멈춘다(무한 순환도 여기서 끊긴다).
        return new Route(passed, current, true);
      }
      String next = decide(node, basis, context, members);
      passed.add(new Step(current, next));
      current = next;
    }
  }

  /** decision 하나의 다음 노드 — 위에서 첫 매치, 없으면 default. */
  private static String decide(
      Node node, Collection<Long> basis, Map<String, Object> context, RunRoleMembers members) {
    for (Condition c : node.conditions()) {
      if (matches(c, basis, context, members)) {
        return c.to();
      }
    }
    return node.defaultTo();
  }

  /** 조건 하나가 맞는지 — assigneeRole 은 기준 사람 중 한 명이라도 그 역할이면, context 는 값이 같으면. */
  static boolean matches(
      Condition c, Collection<Long> basis, Map<String, Object> context, RunRoleMembers members) {
    if (c.assigneeRole() != null) {
      if (basis == null) {
        return false;
      }
      for (Long id : basis) {
        if (id != null && members.isInRole(id, c.assigneeRole())) {
          return true;
        }
      }
      return false;
    }
    if (c.contextKey() == null) {
      return false;
    }
    Object actual = contextValue(context, c.contextKey());
    return actual != null && valueEquals(actual, c.equalsValue());
  }

  /** {@code <노드>.<출력>} 의 값(첫 점에서 자른다). 없으면 null. */
  private static Object contextValue(Map<String, Object> context, String key) {
    int dot = key.indexOf('.');
    if (dot <= 0 || context == null) {
      return null;
    }
    Object node = context.get(key.substring(0, dot));
    return node instanceof Map<?, ?> map ? map.get(key.substring(dot + 1)) : null;
  }

  /** 값 비교 — 수는 BigDecimal 값으로(JSONB 를 거치며 1 이 1.0 이 될 수 있다), 나머지는 형까지 같아야 한다(글 "true" ≠ true). */
  static boolean valueEquals(Object actual, Object expected) {
    if (actual == null || expected == null) {
      return false;
    }
    if (actual instanceof Number a && expected instanceof Number e) {
      BigDecimal x = decimal(a);
      BigDecimal y = decimal(e);
      return x != null && y != null && x.compareTo(y) == 0;
    }
    if (actual instanceof Number || expected instanceof Number) {
      return false;
    }
    return Objects.equals(actual, expected);
  }

  /** 수를 BigDecimal 로. NaN·무한은 비교할 수 없어 null. */
  private static BigDecimal decimal(Number n) {
    if (n instanceof BigDecimal d) {
      return d;
    }
    try {
      return new BigDecimal(n.toString());
    } catch (NumberFormatException e) {
      return null;
    }
  }
}
