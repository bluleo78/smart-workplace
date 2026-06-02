package com.workplace.cycle.dto;

/** 이슈에 연결된 사이클 요약 — 이슈 도메인 응답에 임베드된다. */
public record CycleSummary(Long id, String name, String status) {}
