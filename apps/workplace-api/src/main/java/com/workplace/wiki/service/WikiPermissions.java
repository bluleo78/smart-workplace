package com.workplace.wiki.service;

import com.workplace.wiki.exception.WikiForbiddenException;
import com.workplace.wiki.exception.WikiInvalidRoleException;
import com.workplace.wiki.exception.WikiSpaceNotFoundException;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** 공간 역할 검증. wiki_space_member 만 사용(전역 RBAC 키 없음 — Drive 패턴). */
@Component
@RequiredArgsConstructor
public class WikiPermissions {
  private final WikiSpaceMemberRepository members;

  private static final Map<String, Integer> RANK = Map.of("VIEWER", 1, "EDITOR", 2, "OWNER", 3);

  public void validateRole(String role) {
    if (!RANK.containsKey(role)) {
      throw new WikiInvalidRoleException(role);
    }
  }

  /**
   * 호출자가 공간 멤버이고 최소 역할 이상인지 검증. 멤버 아니면 NotFound(존재 은닉), 역할 미달이면 Forbidden.
   *
   * @return 호출자의 실제 역할
   */
  public String requireRole(long spaceId, long userId, String minRole) {
    String role =
        members
            .findRole(spaceId, userId)
            .orElseThrow(() -> new WikiSpaceNotFoundException(spaceId));
    if (!atLeast(role, minRole)) {
      throw new WikiForbiddenException(spaceId, userId);
    }
    return role;
  }

  /**
   * {@link #requireRole} 과 같되 호출자 멤버 행을 잠가 읽는다(FOR SHARE, WP-579) — 판정 뒤 트랜잭션이 끝날 때까지 강등·제거가 끼어들지
   * 못한다.
   */
  public String requireRoleLocked(long spaceId, long userId, String minRole) {
    String role =
        members
            .findRoleForShare(spaceId, userId)
            .orElseThrow(() -> new WikiSpaceNotFoundException(spaceId));
    if (!atLeast(role, minRole)) {
      throw new WikiForbiddenException(spaceId, userId);
    }
    return role;
  }

  /** role 이 minRole 이상인지(VIEWER &lt; EDITOR &lt; OWNER). */
  static boolean atLeast(String role, String minRole) {
    return RANK.get(role) >= RANK.get(minRole);
  }

  /** 두 역할 중 높은 쪽 — 한쪽이 null(없음)이면 다른 쪽. 공유 판정이 멤버 역할과 공유 역할을 합칠 때 쓴다(WP-579). */
  static String higher(String a, String b) {
    if (a == null) return b;
    if (b == null) return a;
    return atLeast(a, b) ? a : b;
  }
}
