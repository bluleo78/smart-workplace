package com.workplace.user.dto;

import java.util.List;

/**
 * 그룹과 하위 조직에서 찾은 구성원 한 명(WP-1000) — {@link UserGroupMemberSummary} 의 필드에 그 사람이 속한 그룹(groupId)과 소속
 * 경로를 더했다. groupPath 는 찾은 그룹부터 속한 그룹까지의 이름(「경영지원본부」, 「재경팀」)이고, 찾은 그룹의 직속이면 비어 있다 — 웹이 트리를 받지 않아도
 * 경로를 그린다. 한 사람이 여러 하위 조직에 있으면 찾은 그룹에 가장 가까운 소속 하나만 온다.
 */
public record UserGroupMemberHit(
    long groupId,
    List<String> groupPath,
    String targetType,
    long targetId,
    String name,
    String email,
    String title,
    String organization,
    String username) {

  /** 멤버 요약 + 소속 그룹·경로로 만든다. */
  public static UserGroupMemberHit of(
      long groupId, List<String> groupPath, UserGroupMemberSummary m) {
    return new UserGroupMemberHit(
        groupId,
        groupPath,
        m.targetType(),
        m.targetId(),
        m.name(),
        m.email(),
        m.title(),
        m.organization(),
        m.username());
  }
}
