package com.workplace.issue.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * 검색/필터 파라미터. 모든 컬렉션 필드는 null 또는 빈 리스트일 때 조건 미적용. assigneeIds 와 includeUnassigned 는 OR 결합되어 "지정 사용자
 * 또는 미지정" 매칭을 표현한다. labelIds 는 AND 결합 — 모든 라벨이 부착된 이슈만 매칭. typeIds 는 OR 결합 — 지정된 유형 중 하나라도 일치하면 매칭.
 */
public record IssueSearchQuery(
    String q,
    List<String> statuses,
    List<Long> assigneeIds,
    boolean includeUnassigned,
    List<String> priorities,
    LocalDate dueFrom,
    LocalDate dueTo,
    IssueCursor cursor,
    int size,
    List<Long> labelIds,
    List<Long> typeIds) {}
