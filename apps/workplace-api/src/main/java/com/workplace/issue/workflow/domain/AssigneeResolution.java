package com.workplace.issue.workflow.domain;

import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.domain.WorkflowModel.Outcome;
import com.workplace.issue.workflow.domain.WorkflowRouting.Route;
import com.workplace.issue.workflow.domain.WorkflowRouting.StartMatch;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 머무는 노드의 담당 정하기(설계 §6 시작·§7 표·§11 options). DB·Spring 없는 순수 함수.
 *
 * <p>왜: 이동 검증({@link MoveRules#check})·저장·조회 view 가 같은 후보(pool)·기준을 써야 「view 는 고르라 했는데 이동은 거절」 같은
 * 어긋남이 없다(원장 R1). 역할 구성원은 {@link RunRoleMembers} 의 정확한 username 해석만 쓴다.
 */
public final class AssigneeResolution {

  /** 담당을 그대로 두라는 assignTo 값. */
  public static final String KEEP = "keep";

  private AssigneeResolution() {}

  /**
   * 담당 판정 결과.
   *
   * @param assignees 머무는 노드의 담당(위반이 있으면 빈 목록)
   * @param violation 위반(없으면 null)
   */
  public record Resolution(List<Long> assignees, MoveViolation violation) {
    /** 담당 목록을 불변으로. */
    public Resolution {
      assignees = assignees == null ? List.of() : List.copyOf(assignees);
    }

    static Resolution ok(List<Long> assignees) {
      return new Resolution(assignees, null);
    }

    static Resolution fail(MoveViolation violation) {
      return new Resolution(List.of(), violation);
    }
  }

  /**
   * view 의 결과별 담당 후보.
   *
   * @param candidates 후보 id
   * @param required assigneeIds 가 필요한지. decision 을 지나 목적을 미리 모르면 null
   */
  public record Options(List<Long> candidates, Boolean required) {
    /** 후보 목록을 불변으로. */
    public Options {
      candidates = candidates == null ? List.of() : List.copyOf(candidates);
    }
  }

  /** assignTo 가 역할(keep·생략이 아님)인지. */
  public static boolean assignsRole(Outcome outcome) {
    return outcome.assignTo() != null && !KEEP.equals(outcome.assignTo());
  }

  /**
   * assigneeRole 판정의 기준 사람들(설계 §8) — assignTo 가 역할이면 assigneeIds(모두 그 역할의 지금 구성원일 때만) 또는 그 역할의 지금
   * 구성원, keep·생략이면 현재 노드 담당 ∩ 지금 이슈 담당. 담당 확정보다 먼저 정한다.
   *
   * <p>왜 이슈 담당과 교집합: {@link #forMove} 의 생략 기준·{@link MoveActor} 의 담당 판정처럼 사람이 이슈에서 뺀 노드 담당은 더 이상 그
   * 노드의 담당이 아니다(원장 R1 — check·plan·options 가 같은 기준). 교집합이 비면 기준도 비어 assigneeRole 조건은 맞지 않고 decision
   * 의 다른 조건·default 로 간다 — 기준이 빈 다른 경로({@code WorkflowRouting} 의 판정)와 같다.
   *
   * <p>왜 검증된 id 만 쓰나: 연쇄가 end 에 닿거나 한도를 넘으면 담당 고르기({@link #forMove})가 그 id 들을 담당으로 쓰지 않는다. 아무 id 나
   * 기준으로 받으면 이동자가 decision 을 end 로 몰 수 있다(코드 리뷰 R28). 역할 밖 id 가 섞이면 보내지 않은 것처럼 역할 구성원으로 판정하고, 그 id
   * 들은 forMove 가 거절한다. keep·생략은 판정 전에 맞춰 볼 역할이 없고 end 에서는 assigneeIds 를 보지 않으므로(§7 표) 기준에도 쓰지 않는다 —
   * 머무는 task 의 고르기에서만 검증된다.
   */
  public static List<Long> routingBasis(
      Outcome outcome, List<Long> requested, RunState state, RunRoleMembers members) {
    if (assignsRole(outcome)) {
      List<Long> roleIds = members.ids(outcome.assignTo());
      List<Long> req = distinct(requested);
      return !req.isEmpty() && roleIds.containsAll(req) ? req : roleIds;
    }
    return keepIn(state.nodeAssignees(), state.issueAssignees());
  }

  /**
   * 이동의 담당(설계 §7 표).
   *
   * <p>연쇄 한도를 넘었거나 end 면 담당을 바꾸지 않으므로 빈 결과다 — 한도면 이동은 200 으로 SUSPENDED 가 된다(§8). 단 assignTo 역할 밖
   * assigneeIds 는 여기서도 NOT_IN_ROLE 이다(R28).
   *
   * @param requested 요청 assigneeIds(빈 목록은 보내지 않은 것, 중복은 한 번)
   */
  public static Resolution forMove(
      Outcome outcome, Route route, List<Long> requested, RunState state, RunRoleMembers members) {
    List<Long> req = distinct(requested);
    Node target = state.model().nodes().get(route.stopNode());
    if (route.limitExceeded() || target == null || "end".equals(target.type())) {
      // 담당을 정하지 않는 자리 — 그래도 assignTo 역할 밖 id 는 거절한다(Y 를 모르니 X 기준). 라우팅이 그 id 를 기준으로 쓰지 않았어도
      // 통과시키면 「역할 밖 사람을 보내도 된다」로 읽히고, view 의 decision 후보(X 구성원)와도 어긋난다(코드 리뷰 R28).
      if (assignsRole(outcome) && !req.isEmpty()) {
        List<Long> roleIds = members.ids(outcome.assignTo());
        if (!roleIds.containsAll(req)) {
          return Resolution.fail(
              MoveViolation.assigneeNotInRole(outcome.assignTo(), usernames(roleIds, members)));
        }
      }
      return Resolution.ok(List.of());
    }
    String y = target.roleKey();
    if (assignsRole(outcome)) {
      List<Long> pool = rolePool(outcome.assignTo(), y, !route.passed().isEmpty(), members);
      return pickFromPool(pool, req, y, members);
    }
    List<Long> basis = basis(outcome, route.stopNode(), y, state, members);
    if (!basis.isEmpty()) {
      // 기준이 있으면 그대로 — 다른 사람(일부만 고른 것 포함)을 보내면 거절한다.
      if (req.isEmpty() || new LinkedHashSet<>(req).equals(new LinkedHashSet<>(basis))) {
        return Resolution.ok(basis);
      }
      return Resolution.fail(MoveViolation.assigneeNotBasis(y, usernames(basis, members)));
    }
    // 기준이 없으면 Y 안에서 골라야 한다(한 명이어도 — 누구에게 넘길지 사람이 정하게).
    List<Long> roleIds = members.ids(y);
    if (req.isEmpty()) {
      return Resolution.fail(
          MoveViolation.assigneeRequired(
              y, usernames(roleIds, members), "다음 단계 담당을 이 역할 중에서 골라 주세요."));
    }
    if (!roleIds.containsAll(req)) {
      return Resolution.fail(MoveViolation.assigneeNotInRole(y, usernames(roleIds, members)));
    }
    return Resolution.ok(req);
  }

  /**
   * 시작의 담당(설계 §6 의 6) — 매치된 사람 ∩ Y, 비면 지금 이슈 담당 ∩ Y, 비면 Y 가 한 명일 때 그 사람, 그래도 없으면 ASSIGNEE_REQUIRED.
   */
  public static Resolution forStart(
      WorkflowModel model,
      StartMatch match,
      Route route,
      Collection<Long> issueAssignees,
      RunRoleMembers members) {
    if (route.limitExceeded()) {
      return Resolution.ok(List.of());
    }
    Node target = model.nodes().get(route.stopNode());
    if (target == null || "end".equals(target.type())) {
      return Resolution.ok(List.of());
    }
    String y = target.roleKey();
    List<Long> roleIds = members.ids(y);
    List<Long> fromMatch = keepIn(match.matched(), roleIds);
    if (!fromMatch.isEmpty()) {
      return Resolution.ok(fromMatch);
    }
    List<Long> fromIssue = keepIn(issueAssignees, roleIds);
    if (!fromIssue.isEmpty()) {
      return Resolution.ok(fromIssue);
    }
    if (roleIds.size() == 1) {
      return Resolution.ok(roleIds);
    }
    return Resolution.fail(
        MoveViolation.assigneeRequired(
            y, usernames(roleIds, members), "이 역할 중 한 명을 이슈 담당으로 넣고 시작해 주세요."));
  }

  /**
   * view 의 결과별 후보(설계 §11) — 바로 task 는 표대로, 바로 end 는 빈 목록·false, decision 을 지나면 목적을 모르므로 역할이면 X
   * 구성원·아니면 빈 목록이고 required 는 null.
   *
   * @param from 쓰지 않음(계획 서명 호환). 생략의 기준은 state 의 지금 node_run 담당으로 본다
   */
  public static Options options(
      Node from, Outcome outcome, RunState state, RunRoleMembers members) {
    Node direct = outcome.to() == null ? null : state.model().nodes().get(outcome.to());
    if (direct == null) {
      return new Options(List.of(), null);
    }
    if ("end".equals(direct.type())) {
      return new Options(List.of(), false);
    }
    if ("decision".equals(direct.type())) {
      return new Options(assignsRole(outcome) ? members.ids(outcome.assignTo()) : List.of(), null);
    }
    String y = direct.roleKey();
    if (assignsRole(outcome)) {
      List<Long> pool = rolePool(outcome.assignTo(), y, false, members);
      // 한 명이면 그 사람으로 정해진다. 여럿이거나 아무도 없으면 요청이 담당을 보내야 한다.
      return new Options(pool, pool.size() != 1);
    }
    List<Long> basis = basis(outcome, direct.key(), y, state, members);
    if (!basis.isEmpty()) {
      return new Options(basis, false);
    }
    return new Options(members.ids(y), true);
  }

  /** 역할 X 의 후보 — X ∩ Y(Y 순서), decision 을 지났고 비면 Y. */
  private static List<Long> rolePool(
      String x, String y, boolean throughDecision, RunRoleMembers members) {
    List<Long> pool = keepIn(members.ids(y), members.ids(x));
    if (pool.isEmpty() && throughDecision) {
      return members.ids(y);
    }
    return pool;
  }

  /** keep·생략의 기준 — keep 은 최종 노드의 가장 최근 담당 ∩ Y, 생략은 현재 노드 담당 ∩ 지금 이슈 담당 ∩ Y. */
  private static List<Long> basis(
      Outcome outcome, String stopNode, String y, RunState state, RunRoleMembers members) {
    List<Long> roleIds = members.ids(y);
    if (KEEP.equals(outcome.assignTo())) {
      return keepIn(state.lastAssigneesByNode().get(stopNode), roleIds);
    }
    return keepIn(keepIn(state.nodeAssignees(), state.issueAssignees()), roleIds);
  }

  /** 후보에서 고르기 — 보냈으면 모두 후보 안이어야, 안 보냈으면 한 명일 때만 그 사람. */
  private static Resolution pickFromPool(
      List<Long> pool, List<Long> req, String y, RunRoleMembers members) {
    if (!req.isEmpty()) {
      return pool.containsAll(req)
          ? Resolution.ok(req)
          : Resolution.fail(MoveViolation.assigneeNotInRole(y, usernames(pool, members)));
    }
    if (pool.size() == 1) {
      return Resolution.ok(pool);
    }
    if (pool.isEmpty()) {
      return Resolution.fail(
          MoveViolation.assigneeRequired(y, "", "다음 단계 역할에 넘길 수 있는 구성원이 남아 있지 않습니다."));
    }
    return Resolution.fail(
        MoveViolation.assigneeRequired(y, usernames(pool, members), "다음 단계 담당을 후보 중에서 골라 주세요."));
  }

  /** source 순서를 지키며 allowed 에 든 것만(중복·null 제외). */
  private static List<Long> keepIn(Collection<Long> source, Collection<Long> allowed) {
    List<Long> out = new ArrayList<>();
    if (source == null) {
      return out;
    }
    Set<Long> allow = new LinkedHashSet<>(allowed);
    for (Long id : source) {
      if (id != null && allow.contains(id) && !out.contains(id)) {
        out.add(id);
      }
    }
    return out;
  }

  /** null·중복을 뺀 목록(null 이면 빈 목록). */
  private static List<Long> distinct(List<Long> ids) {
    if (ids == null) {
      return List.of();
    }
    List<Long> out = new ArrayList<>();
    for (Long id : ids) {
      if (id != null && !out.contains(id)) {
        out.add(id);
      }
    }
    return out;
  }

  /** 후보 username 쉼표 목록(오류 errors.candidates). */
  private static String usernames(List<Long> ids, RunRoleMembers members) {
    List<String> names = new ArrayList<>();
    for (Long id : ids) {
      members.username(id).ifPresent(names::add);
    }
    return String.join(",", names);
  }
}
