package com.workplace.messaging.dto;

/** DM 참여자 1명. kind 는 user.kind(HUMAN/AGENT). */
public record DmParticipant(Long userId, String name, String kind) {}
