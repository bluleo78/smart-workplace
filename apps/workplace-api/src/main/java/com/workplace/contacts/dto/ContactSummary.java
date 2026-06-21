package com.workplace.contacts.dto;

/** 통합 목록 항목. isFavorite 는 호출자(callerId) 기준 즐겨찾기 여부. */
public record ContactSummary(
    String type,
    long id,
    String name,
    String email,
    String title,
    String organization,
    boolean isFavorite) {}
