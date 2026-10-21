package com.workplace.messaging.dto;

import java.time.Instant;

/**
 * 채널 멤버 1건. role 은 OWNER/ADMIN/MEMBER, kind 는 user.kind(HUMAN/AGENT). username 은 로그인 아이디 — 외부 MCP 가
 * 숫자 userId 없이 사람을 가리키는 값이다(WP-355). active 는 이 워크스페이스에서 활성({@code WorkspaceActive}) — 멤버 목록·멘션 후보가
 * 정지된 구성원을 구분하도록 싣는다(WP-723).
 */
public record ChannelMemberResponse(
    Long userId,
    String username,
    String name,
    String kind,
    String role,
    Instant joinedAt,
    boolean active) {}
