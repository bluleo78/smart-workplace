package com.workplace.wiki.dto;

/** wiki_reference 한 행 — source 페이지가 참조하는 대상. */
public record WikiReferenceRow(long sourcePageId, String targetType, long targetId) {}
