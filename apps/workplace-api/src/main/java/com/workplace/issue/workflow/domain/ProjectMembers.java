package com.workplace.issue.workflow.domain;

import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 프로젝트의 활성 실효 구성원(직접 + 조직도 부서) 조회표: username → (종류, 에이전트 런타임).
 *
 * <p>왜: 검증기는 DB 를 모른다. 호출하는 쪽(서비스)이 DB 구성원을 이 표로 옮겨 넘기고, 검증기는 역할 구성원이 프로젝트에 있는지·담당 역할에 내부 AI 가 있는지를
 * 이 표로만 묻는다. username UNIQUE 는 대소문자를 구분해 "Kim"·"kim" 이 함께 있을 수 있다. 그래서 {@code IssueFilterResolver}
 * 와 같게(WP-624·666) 정확히 같은 username 이 먼저이고, 없으면 대소문자 무시로 하나일 때만 그 사람으로 읽는다 — 둘 이상이면 고르지 않는다.
 */
public final class ProjectMembers {

  /**
   * 구성원 한 명.
   *
   * @param username 저장된 정확한 로그인 이름
   * @param kind 사용자 행의 종류(HUMAN 또는 AGENT)
   * @param agentRuntime 실행 방식(INTERNAL 또는 EXTERNAL). 사람도 INTERNAL 이므로 AI 인지는 kind 로 본다
   */
  public record Member(String username, String kind, String agentRuntime) {}

  /** 정확한 username → 구성원. */
  private final Map<String, Member> exact;

  /** 소문자 username → 구성원(대소문자 무시로 하나뿐인 것만). */
  private final Map<String, Member> uniqueLower;

  /** 대소문자만 다른 구성원이 둘 이상인 소문자 username. */
  private final Set<String> sharedLower;

  private ProjectMembers(
      Map<String, Member> exact, Map<String, Member> uniqueLower, Set<String> sharedLower) {
    this.exact = exact;
    this.uniqueLower = uniqueLower;
    this.sharedLower = sharedLower;
  }

  /**
   * 구성원 목록으로 표를 만든다(null·username 없는 항목은 건너뛰고, 똑같은 이름이 겹치면 먼저 온 것을 쓴다). 대소문자만 다른 이름은 다른 사람이라 합치지
   * 않는다.
   */
  public static ProjectMembers of(Collection<Member> members) {
    Map<String, Member> exact = new HashMap<>();
    if (members != null) {
      for (Member m : members) {
        if (m != null && m.username() != null) {
          exact.putIfAbsent(m.username(), m);
        }
      }
    }
    Map<String, Member> uniqueLower = new HashMap<>();
    Set<String> sharedLower = new HashSet<>();
    for (Member m : exact.values()) {
      String lower = lower(m.username());
      if (uniqueLower.putIfAbsent(lower, m) != null) {
        sharedLower.add(lower);
      }
    }
    sharedLower.forEach(uniqueLower::remove);
    return new ProjectMembers(exact, uniqueLower, sharedLower);
  }

  /** username 이 가리키는 구성원 — 정확히 같은 것이 먼저, 없으면 대소문자 무시로 하나일 때만. */
  public Optional<Member> find(String username) {
    if (username == null) {
      return Optional.empty();
    }
    Member same = exact.get(username);
    return same != null ? Optional.of(same) : Optional.ofNullable(uniqueLower.get(lower(username)));
  }

  /** 정확히 같은 구성원은 없고 대소문자만 다른 구성원이 둘 이상이라 누구인지 정할 수 없는지. */
  boolean isAmbiguous(String username) {
    return username != null
        && !exact.containsKey(username)
        && sharedLower.contains(lower(username));
  }

  /** 대소문자를 무시한 비교에 쓰는 글(언어 설정과 무관한 소문자). */
  static String lower(String username) {
    return username.toLowerCase(Locale.ROOT);
  }
}
