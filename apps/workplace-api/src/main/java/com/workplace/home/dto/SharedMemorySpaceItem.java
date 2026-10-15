package com.workplace.home.dto;

/** 공용 메모리 공간 한 줄(WP-386) — 조직은 id·key 가 null. label 은 블록·결과 줄과 같은 표시 이름. */
public record SharedMemorySpaceItem(
    String type,
    Long id,
    String key,
    String name,
    String label,
    int count,
    int limit,
    boolean canAdd,
    boolean canManage) {}
