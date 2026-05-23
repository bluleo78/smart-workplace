package com.workplace.label.dto;

/** 이슈에 첨부된 라벨 요약 — IssueResponse 안에 임베드된다. */
public record LabelSummary(Long id, String name, String colorToken) {}
