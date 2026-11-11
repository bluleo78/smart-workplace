package com.workplace.issue.metrics;

import java.time.LocalDate;
import java.time.OffsetDateTime;

/**
 * 완료 이슈 한 건의 계산 결과(WP-1476). 화면이 「늦은 이슈 상위」「끝낸 일 목록」을 그릴 때 쓴다 — 키·제목 같은 표시 정보는 화면 이슈가 issueId 로 따로
 * 채운다(지표 모듈은 이슈 표현을 소유하지 않는다).
 *
 * @param issueId 이슈 id
 * @param projectId 이슈의 프로젝트 id(사람 기준에서 여러 프로젝트가 섞일 때 묶음용)
 * @param closedAt 닫힌 시각(마지막 닫힘)
 * @param closedDate 닫힌 서울 날짜
 * @param dueAtClose 닫힐 당시 마감일. 없었으면 null
 * @param outcome 기한 내/초과/마감 없음
 * @param lateDays 초과면 늦은 날수(≥1), 아니면 null
 * @param leadTimeDays 소요 일수(생성→닫힘, 초/86400 — 반올림 없음). 닫힌 시각이 생성보다 앞선 잘못된 데이터면 null(집계 제외)
 * @param withAi 「AI와 함께」 여부
 */
public record ClosedIssueFact(
    long issueId,
    long projectId,
    OffsetDateTime closedAt,
    LocalDate closedDate,
    LocalDate dueAtClose,
    DueOutcome outcome,
    Integer lateDays,
    Double leadTimeDays,
    boolean withAi) {}
