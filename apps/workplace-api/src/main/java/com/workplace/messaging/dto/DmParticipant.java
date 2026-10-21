package com.workplace.messaging.dto;

/**
 * DM 참여자 1명. kind 는 user.kind(HUMAN/AGENT). active 는 이 워크스페이스에서 활성({@code WorkspaceActive}) — 정지된
 * 상대와의 DM 에 안내를 보이고 입력을 막도록 화면에 알린다(WP-723).
 */
public record DmParticipant(Long userId, String name, String kind, boolean active) {}
