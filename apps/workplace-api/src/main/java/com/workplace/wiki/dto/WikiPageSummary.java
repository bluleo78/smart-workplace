package com.workplace.wiki.dto;

public record WikiPageSummary(long id, Long parentId, String title, int position) {}
