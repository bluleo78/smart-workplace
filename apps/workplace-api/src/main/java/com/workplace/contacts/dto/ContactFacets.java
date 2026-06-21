package com.workplace.contacts.dto;

import java.util.List;

/** 외부 연락처 조직·직책 distinct 목록 — 고급 필터 드롭다운 옵션. */
public record ContactFacets(List<String> organizations, List<String> titles) {}
