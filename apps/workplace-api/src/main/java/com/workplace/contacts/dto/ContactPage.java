package com.workplace.contacts.dto;

import java.util.List;

/** 커서 페이지네이션 응답. nextCursor 는 다음 페이지가 없으면 null. */
public record ContactPage(List<ContactSummary> items, String nextCursor, boolean hasMore) {}
