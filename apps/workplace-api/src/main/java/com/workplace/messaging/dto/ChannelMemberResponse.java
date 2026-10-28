package com.workplace.messaging.dto;

import java.time.Instant;
import java.util.List;

/**
 * 채널 멤버 1건. role 은 OWNER/ADMIN/MEMBER, kind 는 user.kind(HUMAN/AGENT). username 은 로그인 아이디 — 외부 MCP 가
 * 숫자 userId 없이 사람을 가리키는 값이다(WP-355). active 는 이 워크스페이스에서 활성({@code WorkspaceActive}) — 멤버 목록·멘션 후보가
 * 정지된 구성원을 구분하도록 싣는다(WP-723).
 *
 * <p>direct·viaGroupIds(WP-1058): direct 는 직접 멤버(초대·참여·생성·관리 역할 승격)인가 — false 면 멤버 부서로만 들어온 사람이라
 * 부서가 빠지거나 부서에서 빠지면 채널에서도 빠진다. viaGroupIds 는 이 사람이 걸리는 이 채널의 멤버 부서 id(오름차순, 없으면 빈 목록) — 직접 멤버도 부서에
 * 걸리면 담긴다. 정지된 구성원도 부서로 걸린 것으로 본다(정지돼도 부서 사람 행은 남는다). 멤버 목록 API 만 채운다(내부 roster 조회는 빈 목록).
 */
public record ChannelMemberResponse(
    Long userId,
    String username,
    String name,
    String kind,
    String role,
    Instant joinedAt,
    boolean active,
    boolean direct,
    List<Long> viaGroupIds) {

  /** viaGroupIds 를 채운 사본 — 멤버 목록 API 가 부서 판정 결과를 붙일 때 쓴다. */
  public ChannelMemberResponse withViaGroupIds(List<Long> groupIds) {
    return new ChannelMemberResponse(
        userId, username, name, kind, role, joinedAt, active, direct, List.copyOf(groupIds));
  }
}
