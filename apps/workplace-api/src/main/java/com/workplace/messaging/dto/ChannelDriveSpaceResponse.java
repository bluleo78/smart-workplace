package com.workplace.messaging.dto;

/** 채널 연동 드라이브 공간 ensure 응답 — 프론트가 spaceId 로 /drive/spaces/{id} 진입. */
public record ChannelDriveSpaceResponse(long spaceId, boolean archived) {}
