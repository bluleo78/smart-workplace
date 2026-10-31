package com.workplace.issue.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * 검색/필터 파라미터. 모든 컬렉션 필드는 null 또는 빈 리스트일 때 조건 미적용. assigneeIds 와 includeUnassigned 는 OR 결합되어 "지정 사용자
 * 또는 미지정" 매칭을 표현한다. labelIdGroups 는 그룹 간 AND·그룹 내 OR — 그룹(필터 토큰 하나)마다 그 중 하나라도 부착된 이슈만 매칭. typeIds
 * 는 OR 결합 — 지정된 유형 중 하나라도 일치하면 매칭. parentNumber 가 지정되면 해당 부모의 자식만, topLevel=true 면 parent_issue_id
 * IS NULL 인 이슈만 (Phase 4a). parentNumber 가 있으면 topLevel 은 무시된다. blocked=true 면 활성 차단자(미완료)가 존재하는
 * 이슈만 (Phase 4b). fieldId+fieldValue 동시 지정 시 해당 필드의 JSONB 값을 텍스트 캐스트 동등 비교로 필터 (Phase 4c, 1차 단순화).
 * reporterIds 는 OR 결합 — 이슈를 만든 사람(reporter_id 직접 컬럼) 필터. 비어 있으면 미적용. cycleIds 는 OR 결합 — 지정된 사이클 중
 * 하나라도 연결된 이슈만 매칭하며, includeNoOpenCycle·includeNoCycle 과 OR 결합되어 "지정 사이클 또는 백로그(진행 중·예정 사이클 밖) 또는
 * 사이클 미할당" 을 표현한다. milestoneIds 는 OR 결합 — issue.milestone_id 직접 컬럼 매칭(M:N 아님). 비어 있으면 미적용.
 * watcherId 가 있으면 그 사용자가 워치 중인 이슈만(WP-356). pendingForUserId 가 있으면 그 사용자의 마지막 글(이슈 챗 글·댓글) 이후 다른 사람
 * 글(챗 글·댓글)이 있는 이슈만(WP-373·WP-719). mentionedUserId 가 있으면 그 사용자를 멘션한 다른 사람 글이 마지막 글 이후에 있는
 * 이슈만(WP-719). statusIds 는 OR 결합 — 프로젝트 상태(project_status) id 중 하나와 일치하는 이슈만(WP-807).
 * statuses(범주)와는 AND. componentIds·componentNone 은 OR 결합 — 지정 구성요소 중 하나라도 붙은 이슈 또는 구성요소가 없는
 * 이슈(WP-933).
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
    // 라벨 필터 — 토큰 하나가 그룹 하나. 이름 토큰은 횡단 조회에서 여러 프로젝트의 동명 라벨로 풀리므로 그룹 내 OR(#841).
    List<List<Long>> labelIdGroups,
    List<Long> typeIds,
    Integer parentNumber,
    Boolean topLevel,
    Boolean blocked,
    Long fieldId,
    String fieldValue,
    // 7-nav: reporter(이슈를 만든 사람) 필터. "me" 는 호출자로 치환. 비어 있으면 미적용.
    List<Long> reporterIds,
    // 사이클 필터 — OR 결합. 지정된 사이클 중 하나에라도 포함된 이슈만 매칭. 비어 있으면 미적용.
    List<Long> cycleIds,
    // 백로그 포함 — cycle=null 토큰. 진행 중(ACTIVE)·예정(PLANNED) 사이클에 연결되지 않은 이슈를 매칭하며 cycleIds 와 OR
    // 결합(#878). 완료 사이클에만 남은 이슈도 포함한다 — Jira 처럼 끝난 스프린트의 미완료 이슈가 백로그로 돌아오는 동작.
    boolean includeNoOpenCycle,
    // 마일스톤 필터 — OR 결합. issue.milestone_id 직접 컬럼 매칭. 비어 있으면 미적용.
    List<Long> milestoneIds,
    // 목록 화면 전용 — true 면 SUBTASK 유형 이슈를 제외한다(에픽 자식 등 비SUBTASK 는 그대로 노출).
    // topLevel(루트만) 과 직교하며, parentNumber 지정 시(특정 부모 자식 보기)에는 무시된다.
    Boolean excludeSubtasks,
    // 보드·목록 기본 뷰 전용 — true 면 EPIC 유형 이슈를 제외한다(Jira 관례: 에픽은 작업 카드가 아닌 묶음 단위).
    // excludeSubtasks 와 동일하게 parentNumber 지정 시 무시된다(특정 부모의 자식에는 에픽이 없으므로 의미 없음).
    Boolean excludeEpics,
    // 보드·목록 기본 뷰 전용 — true 면 종료(DONE·CANCELED) 이슈 중 ACTIVE 사이클에 연결되지 않은 것을 제외한다.
    // 진행 중 사이클의 완료분은 남겨 사이클 진척을 보이고, 그 외 종료 이슈는 보드·목록에 쌓이지 않게 한다(#876).
    Boolean hideInactiveClosed,
    // 사이클 미할당 포함 — cycle=none 토큰. 사이클 연결이 하나도 없는 이슈를 매칭하며 cycleIds·includeNoOpenCycle 과 OR 결합
    // (WP-176). 백로그(null)와 달리 완료 사이클에만 연결된 이슈는 제외한다 — "사이클이 할당되지 않은 이슈" 를 정확히 고르기 위함.
    boolean includeNoCycle,
    // 종료일(closed_at) 범위 — Asia/Seoul 날짜 기준 양끝 포함(WP-307). "이번 주 완료한 이슈" 같은 조회용. null 이면 미적용.
    LocalDate closedFrom,
    LocalDate closedTo,
    // 생성일(created_at) 범위 — Asia/Seoul 날짜 기준 양끝 포함(WP-307). null 이면 미적용.
    LocalDate createdFrom,
    LocalDate createdTo,
    // 워치 필터(WP-356) — 이 사용자가 워치 중인 이슈만. watching=true 면 호출자 id. null 이면 미적용.
    Long watcherId,
    // 새 글 필터(WP-373·WP-719) — 이 사용자의 마지막 글(이슈 챗 글·댓글) 이후 다른 사람이 글·댓글을 남긴 이슈만. pendingForMe=true 면
    // 호출자 id. null 이면 미적용.
    Long pendingForUserId,
    // 개별 상태 필터(WP-807) — statusId·statusName 을 해석한 프로젝트 상태 id 합집합, OR 결합. 비어 있으면 미적용.
    List<Long> statusIds,
    // 구성요소 필터(WP-933) — 지정 구성요소 중 하나라도 붙은 이슈(OR). 보관된 구성요소도 거를 수 있다. 비어 있으면 미적용.
    List<Long> componentIds,
    // 구성요소 없음 포함 — component=none 토큰(사이클 none 과 같은 규약). componentIds 와 OR 결합.
    boolean componentNone,
    // 수정 버전 필터(WP-888) — 지정 버전 중 하나라도 수정 버전(FIX)으로 붙은 이슈(OR). 보관된 버전도 거를 수 있다. 비어 있으면 미적용.
    List<Long> fixVersionIds,
    // 수정 버전 없음 포함 — fixVersion=none 토큰. fixVersionIds 와 OR 결합.
    boolean fixVersionNone,
    // 영향 버전 필터(WP-888) — 같은 규약, 종류만 AFFECTS. 수정 버전 필터와는 AND.
    List<Long> affectsVersionIds,
    boolean affectsVersionNone,
    // 멘션 필터(WP-719) — 이 사용자의 마지막 글 이후 이 사용자를 멘션한 다른 사람 글이 있는 이슈만. mentionsMe=true 면 호출자 id. null 이면
    // 미적용.
    Long mentionedUserId,
    // 원본 키 필터(WP-1239) — 가져올 때 받은 원본 시스템 키(issue.import_source_key)와 정확히 같은 이슈만. null 이면 미적용.
    String sourceKey,
    // 수정일(updated_at) 범위 — Asia/Seoul 날짜 기준 양끝 포함(WP-1238, 생성일 범위와 같은 규칙). null 이면 미적용.
    LocalDate updatedFrom,
    LocalDate updatedTo,
    // 시작일(start_date) 범위 — DATE 비교, 양끝 포함(WP-1238, 마감일 범위와 같은 규칙). 시작일 없는 이슈는 제외된다. null 이면 미적용.
    LocalDate startFrom,
    LocalDate startTo) {

  /** 원본 키 필터 없는 39-인자 호환 생성자 — 원본 키로 찾지 않는 호출부용(sourceKey·수정일·시작일 범위 null). */
  public IssueSearchQuery(
      String q,
      List<String> statuses,
      List<Long> assigneeIds,
      boolean includeUnassigned,
      List<String> priorities,
      LocalDate dueFrom,
      LocalDate dueTo,
      IssueCursor cursor,
      int size,
      List<List<Long>> labelIdGroups,
      List<Long> typeIds,
      Integer parentNumber,
      Boolean topLevel,
      Boolean blocked,
      Long fieldId,
      String fieldValue,
      List<Long> reporterIds,
      List<Long> cycleIds,
      boolean includeNoOpenCycle,
      List<Long> milestoneIds,
      Boolean excludeSubtasks,
      Boolean excludeEpics,
      Boolean hideInactiveClosed,
      boolean includeNoCycle,
      LocalDate closedFrom,
      LocalDate closedTo,
      LocalDate createdFrom,
      LocalDate createdTo,
      Long watcherId,
      Long pendingForUserId,
      List<Long> statusIds,
      List<Long> componentIds,
      boolean componentNone,
      List<Long> fixVersionIds,
      boolean fixVersionNone,
      List<Long> affectsVersionIds,
      boolean affectsVersionNone,
      Long mentionedUserId) {
    this(
        q,
        statuses,
        assigneeIds,
        includeUnassigned,
        priorities,
        dueFrom,
        dueTo,
        cursor,
        size,
        labelIdGroups,
        typeIds,
        parentNumber,
        topLevel,
        blocked,
        fieldId,
        fieldValue,
        reporterIds,
        cycleIds,
        includeNoOpenCycle,
        milestoneIds,
        excludeSubtasks,
        excludeEpics,
        hideInactiveClosed,
        includeNoCycle,
        closedFrom,
        closedTo,
        createdFrom,
        createdTo,
        watcherId,
        pendingForUserId,
        statusIds,
        componentIds,
        componentNone,
        fixVersionIds,
        fixVersionNone,
        affectsVersionIds,
        affectsVersionNone,
        mentionedUserId,
        null,
        null,
        null,
        null,
        null);
  }

  /** 버전 필터 없는 33-인자 호환 생성자 — 버전 필터를 쓰지 않는 호출부용. */
  public IssueSearchQuery(
      String q,
      List<String> statuses,
      List<Long> assigneeIds,
      boolean includeUnassigned,
      List<String> priorities,
      LocalDate dueFrom,
      LocalDate dueTo,
      IssueCursor cursor,
      int size,
      List<List<Long>> labelIdGroups,
      List<Long> typeIds,
      Integer parentNumber,
      Boolean topLevel,
      Boolean blocked,
      Long fieldId,
      String fieldValue,
      List<Long> reporterIds,
      List<Long> cycleIds,
      boolean includeNoOpenCycle,
      List<Long> milestoneIds,
      Boolean excludeSubtasks,
      Boolean excludeEpics,
      Boolean hideInactiveClosed,
      boolean includeNoCycle,
      LocalDate closedFrom,
      LocalDate closedTo,
      LocalDate createdFrom,
      LocalDate createdTo,
      Long watcherId,
      Long pendingForUserId,
      List<Long> statusIds,
      List<Long> componentIds,
      boolean componentNone) {
    this(
        q,
        statuses,
        assigneeIds,
        includeUnassigned,
        priorities,
        dueFrom,
        dueTo,
        cursor,
        size,
        labelIdGroups,
        typeIds,
        parentNumber,
        topLevel,
        blocked,
        fieldId,
        fieldValue,
        reporterIds,
        cycleIds,
        includeNoOpenCycle,
        milestoneIds,
        excludeSubtasks,
        excludeEpics,
        hideInactiveClosed,
        includeNoCycle,
        closedFrom,
        closedTo,
        createdFrom,
        createdTo,
        watcherId,
        pendingForUserId,
        statusIds,
        componentIds,
        componentNone,
        null,
        false,
        null,
        false,
        null,
        null,
        null,
        null,
        null,
        null);
  }

  /** 구성요소 필터 없는 31-인자 호환 생성자 — 구성요소 필터를 쓰지 않는 호출부용. */
  public IssueSearchQuery(
      String q,
      List<String> statuses,
      List<Long> assigneeIds,
      boolean includeUnassigned,
      List<String> priorities,
      LocalDate dueFrom,
      LocalDate dueTo,
      IssueCursor cursor,
      int size,
      List<List<Long>> labelIdGroups,
      List<Long> typeIds,
      Integer parentNumber,
      Boolean topLevel,
      Boolean blocked,
      Long fieldId,
      String fieldValue,
      List<Long> reporterIds,
      List<Long> cycleIds,
      boolean includeNoOpenCycle,
      List<Long> milestoneIds,
      Boolean excludeSubtasks,
      Boolean excludeEpics,
      Boolean hideInactiveClosed,
      boolean includeNoCycle,
      LocalDate closedFrom,
      LocalDate closedTo,
      LocalDate createdFrom,
      LocalDate createdTo,
      Long watcherId,
      Long pendingForUserId,
      List<Long> statusIds) {
    this(
        q,
        statuses,
        assigneeIds,
        includeUnassigned,
        priorities,
        dueFrom,
        dueTo,
        cursor,
        size,
        labelIdGroups,
        typeIds,
        parentNumber,
        topLevel,
        blocked,
        fieldId,
        fieldValue,
        reporterIds,
        cycleIds,
        includeNoOpenCycle,
        milestoneIds,
        excludeSubtasks,
        excludeEpics,
        hideInactiveClosed,
        includeNoCycle,
        closedFrom,
        closedTo,
        createdFrom,
        createdTo,
        watcherId,
        pendingForUserId,
        statusIds,
        null,
        false);
  }

  /** 워치 필터 없는 기존 28-인자 호환 생성자 — 리포지토리 테스트 시드가 그대로 쓴다. */
  public IssueSearchQuery(
      String q,
      List<String> statuses,
      List<Long> assigneeIds,
      boolean includeUnassigned,
      List<String> priorities,
      LocalDate dueFrom,
      LocalDate dueTo,
      IssueCursor cursor,
      int size,
      List<List<Long>> labelIdGroups,
      List<Long> typeIds,
      Integer parentNumber,
      Boolean topLevel,
      Boolean blocked,
      Long fieldId,
      String fieldValue,
      List<Long> reporterIds,
      List<Long> cycleIds,
      boolean includeNoOpenCycle,
      List<Long> milestoneIds,
      Boolean excludeSubtasks,
      Boolean excludeEpics,
      Boolean hideInactiveClosed,
      boolean includeNoCycle,
      LocalDate closedFrom,
      LocalDate closedTo,
      LocalDate createdFrom,
      LocalDate createdTo) {
    this(
        q,
        statuses,
        assigneeIds,
        includeUnassigned,
        priorities,
        dueFrom,
        dueTo,
        cursor,
        size,
        labelIdGroups,
        typeIds,
        parentNumber,
        topLevel,
        blocked,
        fieldId,
        fieldValue,
        reporterIds,
        cycleIds,
        includeNoOpenCycle,
        milestoneIds,
        excludeSubtasks,
        excludeEpics,
        hideInactiveClosed,
        includeNoCycle,
        closedFrom,
        closedTo,
        createdFrom,
        createdTo,
        null,
        null,
        null,
        null,
        false);
  }
}
