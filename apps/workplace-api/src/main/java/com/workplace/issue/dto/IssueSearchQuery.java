package com.workplace.issue.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * 검색/필터 파라미터. 모든 컬렉션 필드는 null 또는 빈 리스트일 때 조건 미적용. assigneeIds 와 includeUnassigned 는 OR 결합되어 "지정 사용자
 * 또는 미지정" 매칭을 표현한다. labelIds 는 AND 결합 — 모든 라벨이 부착된 이슈만 매칭. typeIds 는 OR 결합 — 지정된 유형 중 하나라도 일치하면 매칭.
 * parentNumber 가 지정되면 해당 부모의 자식만, topLevel=true 면 parent_issue_id IS NULL 인 이슈만 (Phase 4a).
 * parentNumber 가 있으면 topLevel 은 무시된다. blocked=true 면 활성 차단자(미완료)가 존재하는 이슈만 (Phase 4b).
 * fieldId+fieldValue 동시 지정 시 해당 필드의 JSONB 값을 텍스트 캐스트 동등 비교로 필터 (Phase 4c, 1차 단순화). reporterIds 는 OR
 * 결합 — 이슈를 만든 사람(reporter_id 직접 컬럼) 필터. 비어 있으면 미적용. cycleIds 는 OR 결합 — 지정된 사이클 중 하나라도 연결된 이슈만 매칭.
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
    List<Long> typeIds,
    Integer parentNumber,
    Boolean topLevel,
    Boolean blocked,
    Long fieldId,
    String fieldValue,
    // 7-nav: reporter(이슈를 만든 사람) 필터. "me" 는 호출자로 치환. 비어 있으면 미적용.
    List<Long> reporterIds,
    // 사이클 필터 — OR 결합. 지정된 사이클 중 하나에라도 포함된 이슈만 매칭. 비어 있으면 미적용.
    List<Long> cycleIds) {}
