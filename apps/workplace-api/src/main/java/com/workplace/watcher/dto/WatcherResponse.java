package com.workplace.watcher.dto;

/** 이슈 watcher 사용자 응답 DTO. */
public record WatcherResponse(Long userId, String username, String name) {}
