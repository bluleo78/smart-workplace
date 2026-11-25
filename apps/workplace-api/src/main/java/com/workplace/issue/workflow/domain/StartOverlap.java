package com.workplace.issue.workflow.domain;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 시작 조건 겹침 판정(WP-2119) — 같은 프로젝트에서 켜진 두 워크플로우의 start 조건(assigneeRole)이 같은 사람을 가리키면 그 사람이 담당인 이슈에 어느
 * 쪽이 시작될지 정해지지 않는다. 켜기·게시하고 켜기 전에 이 순수 함수(DB 없음)로 거른다.
 *
 * <p>역할 구성원은 실제 시작과 같은 표({@link RunRoleMembers})로 해석해, 나간 사람·다른 대소문자 username 이 겹침으로 잡히지 않는다.
 */
public final class StartOverlap {

  private StartOverlap() {}

  /**
   * 이미 켜진 다른 워크플로우 하나.
   *
   * @param name 정의 이름(거절 문구에 쓴다)
   * @param model 그 정의의 활성 게시 모델
   */
  public record Other(String name, WorkflowModel model) {}

  /**
   * 겹친 상대와 겹친 사람.
   *
   * @param otherName 겹친 워크플로우 이름
   * @param personName 겹친 사람의 username(첫 사람)
   */
  public record Overlap(String otherName, String personName) {}

  /**
   * 내 모델의 시작 역할 구성원과 다른 워크플로우의 시작 역할 구성원이 겹치는 첫 경우를 찾는다.
   *
   * @param mine 켜려는(게시하려는) 모델
   * @param others 같은 프로젝트에서 켜져 있고 게시된 다른 정의들(자기 자신은 뺀 것)
   * @param active 프로젝트의 지금 활성 구성원 — 모든 모델이 같은 표를 쓴다
   */
  public static Optional<Overlap> find(
      WorkflowModel mine, List<Other> others, Collection<ActiveMember> active) {
    RunRoleMembers mineMembers = RunRoleMembers.of(mine, active);
    Set<Long> mineIds = startIds(mine, mineMembers);
    if (mineIds.isEmpty()) {
      return Optional.empty();
    }
    for (Other other : others) {
      RunRoleMembers otherMembers = RunRoleMembers.of(other.model(), active);
      for (Long id : startIds(other.model(), otherMembers)) {
        if (mineIds.contains(id)) {
          String person = otherMembers.username(id).orElse("");
          return Optional.of(new Overlap(other.name(), person));
        }
      }
    }
    return Optional.empty();
  }

  /** 모델의 start 조건(assigneeRole)에 든 역할들의 지금 구성원 id 합집합(순서 유지). */
  private static Set<Long> startIds(WorkflowModel model, RunRoleMembers members) {
    Set<Long> ids = new LinkedHashSet<>();
    for (WorkflowModel.Condition c : model.start()) {
      if (c.assigneeRole() != null) {
        ids.addAll(members.ids(c.assigneeRole()));
      }
    }
    return ids;
  }
}
