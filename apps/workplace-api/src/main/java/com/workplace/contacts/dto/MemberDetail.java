package com.workplace.contacts.dto;

import java.util.List;

/** 멤버 상세 — 프로필 + 소속 사용자 그룹명 목록(읽기 전용) + isFavorite(호출자 기준 즐겨찾기). */
public record MemberDetail(
    long id,
    String username,
    String name,
    String email,
    String title,
    String kind,
    List<String> groups,
    boolean isFavorite) {}
