package com.workplace.issue.workflow.domain;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 역할 하나의 members 를 구성원 표로 해석한 것 — 두 역할이 겹치는지 묻는 데 쓴다.
 *
 * <p>왜: 해석된 이름은 사람으로 견줘야 대소문자만 다른 두 사람을 같다고 하지 않는다. 해석하지 못한 이름(없음·모호)은 이미 ERROR 라, 소문자가 같으면 겹친 것으로
 * 봐서 같은 원인으로 「항상 거절되는 이동」까지 나지 않게 한다.
 *
 * @param resolved 해석된 구성원의 저장된 username
 * @param unresolved 해석하지 못한 이름의 소문자
 * @param all 적힌 모든 이름의 소문자
 */
record RoleMembers(Set<String> resolved, Set<String> unresolved, Set<String> all) {

  /** 적힌 이름들을 한 번 훑어 해석한다. */
  static RoleMembers of(List<String> usernames, ProjectMembers members) {
    Set<String> resolved = new HashSet<>();
    Set<String> unresolved = new HashSet<>();
    Set<String> all = new HashSet<>();
    for (String typed : usernames) {
      String lower = ProjectMembers.lower(typed);
      all.add(lower);
      members
          .find(typed)
          .ifPresentOrElse(m -> resolved.add(m.username()), () -> unresolved.add(lower));
    }
    return new RoleMembers(resolved, unresolved, all);
  }

  /** 적힌 구성원이 하나도 없는지. */
  boolean isEmpty() {
    return all.isEmpty();
  }

  /** 한 명이라도 겹치는지(비용은 작은 쪽 크기에 비례). */
  boolean overlaps(RoleMembers other) {
    return intersects(resolved, other.resolved)
        || intersects(unresolved, other.all)
        || intersects(other.unresolved, all);
  }

  /** 작은 집합을 훑어 공통 원소가 있는지 본다. */
  private static boolean intersects(Set<String> a, Set<String> b) {
    Set<String> small = a.size() <= b.size() ? a : b;
    Set<String> large = small == a ? b : a;
    for (String value : small) {
      if (large.contains(value)) {
        return true;
      }
    }
    return false;
  }
}
