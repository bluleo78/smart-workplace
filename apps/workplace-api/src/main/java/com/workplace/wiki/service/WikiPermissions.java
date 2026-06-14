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
    if (RANK.get(role) < RANK.get(minRole)) {
      throw new WikiForbiddenException(spaceId, userId);
    }
    return role;
  }
}
