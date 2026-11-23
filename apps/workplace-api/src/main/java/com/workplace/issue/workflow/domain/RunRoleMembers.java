package com.workplace.issue.workflow.domain;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 게시본 역할 → 지금의 활성 구성원(id) 해석표.
 *
 * <p>왜: 역할 구성원은 게시본 username 과 <b>정확히</b> 같은 지금의 활성 구성원만이다(설계 §7). {@link ProjectMembers#find} 의
 * 대소문자 무시 맞춤을 쓰면 나간 {@code Kim} 자리를 {@code kim} 이 물려받는다 — {@link WorkflowModel#withStoredUsernames}
 * 가 정확한 username 을 남긴 것도 이 비교를 위해서다. 한 번 만들어 이동 판정·담당 고르기·options 가 같은 표를 쓰게 해 두 계산이 갈리지 않게 한다.
 */
public final class RunRoleMembers {

  /** 역할 키 → 구성원(게시본에 적힌 순서, 같은 사람은 처음 자리만). */
  private final Map<String, List<ActiveMember>> byRole;

  /** id → 구성원(역할에 든 사람만). */
  private final Map<Long, ActiveMember> byId;

  private RunRoleMembers(Map<String, List<ActiveMember>> byRole, Map<Long, ActiveMember> byId) {
    this.byRole = byRole;
    this.byId = byId;
  }

  /**
   * 게시본 모델의 역할마다 지금 활성 구성원 중 username 이 정확히 같은 사람을 찾는다.
   *
   * @param model 실행이 고정한 게시본 모델
   * @param active 프로젝트의 지금 활성 실효 구성원(null·username 없는 항목은 건너뛰고, 같은 username 이 겹치면 먼저 온 것)
   */
  public static RunRoleMembers of(WorkflowModel model, Collection<ActiveMember> active) {
    Map<String, ActiveMember> exact = new HashMap<>();
    if (active != null) {
      for (ActiveMember m : active) {
        if (m != null && m.username() != null) {
          exact.putIfAbsent(m.username(), m);
        }
      }
    }
    Map<String, List<ActiveMember>> byRole = new LinkedHashMap<>();
    Map<Long, ActiveMember> byId = new HashMap<>();
    model
        .roles()
        .forEach(
            (key, role) -> {
              Map<Long, ActiveMember> found = new LinkedHashMap<>();
              for (String username : role.memberUsernames()) {
                ActiveMember m = exact.get(username);
                if (m != null) {
                  found.putIfAbsent(m.id(), m);
                  byId.putIfAbsent(m.id(), m);
                }
              }
              byRole.put(key, List.copyOf(found.values()));
            });
    return new RunRoleMembers(byRole, byId);
  }

  /** 역할의 지금 구성원(게시본 순서). 없는 역할·null 이면 빈 목록. */
  public List<ActiveMember> members(String roleKey) {
    if (roleKey == null) {
      return List.of();
    }
    return byRole.getOrDefault(roleKey, List.of());
  }

  /** 역할의 지금 구성원 id(게시본 순서). */
  public List<Long> ids(String roleKey) {
    List<Long> ids = new ArrayList<>();
    for (ActiveMember m : members(roleKey)) {
      ids.add(m.id());
    }
    return Collections.unmodifiableList(ids);
  }

  /** 그 사람이 역할의 지금 구성원인지. */
  public boolean isInRole(long id, String roleKey) {
    for (ActiveMember m : members(roleKey)) {
      if (m.id() == id) {
        return true;
      }
    }
    return false;
  }

  /** 역할에 든 사람의 username(오류의 candidates 글에 쓴다). */
  public Optional<String> username(long id) {
    ActiveMember m = byId.get(id);
    return m == null ? Optional.empty() : Optional.of(m.username());
  }

  /** 역할 구성원 id 집합(순서 유지) — 교집합 계산용. */
  Set<Long> idSet(String roleKey) {
    return new LinkedHashSet<>(ids(roleKey));
  }
}
