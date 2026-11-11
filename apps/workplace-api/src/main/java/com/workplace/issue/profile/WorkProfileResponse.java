package com.workplace.issue.profile;

import com.workplace.issue.dto.MeOverviewPeriod;
import com.workplace.issue.metrics.MetricsPeriod;
import com.workplace.issue.profile.WorkProfileCalc.Count;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 업무 프로파일 카드 응답(WP-1485).
 *
 * @param period 고른 기간
 * @param status NONE(끝낸 이슈가 없어 행도 없음) / PENDING / READY / FAILED
 * @param periodFrom 분석한 기간 시작(서울 날짜). 아직 분석 전이면 null
 * @param periodTo 분석한 기간 끝
 * @param analyzedAt 마지막 분석 시각. 분석 전이면 null
 * @param totalCount 기간 안 끝낸 이슈 수
 * @param analyzedCount 실제로 AI 에 보낸 이슈 수(상한 100)
 * @param summary AI 요약. 없으면 null
 * @param tasks 일 종류별 건수
 * @param areas 영역별 건수
 * @param skills 역량 태그
 * @param error 마지막 실패 문구(FAILED 일 때)
 */
public record WorkProfileResponse(
    MeOverviewPeriod period,
    String status,
    LocalDate periodFrom,
    LocalDate periodTo,
    OffsetDateTime analyzedAt,
    int totalCount,
    int analyzedCount,
    String summary,
    List<Count> tasks,
    List<Count> areas,
    List<String> skills,
    String error) {

  /** 「행 없음」 상태 이름 — 끝낸 이슈가 없어 분석할 것이 없을 때. */
  public static final String NONE = "NONE";

  /** 저장 행 → 응답. */
  public static WorkProfileResponse of(WorkProfileRow row) {
    return new WorkProfileResponse(
        row.period(),
        row.status().name(),
        row.periodFrom(),
        row.periodTo(),
        row.analyzedAt(),
        row.totalCount(),
        row.analyzedCount(),
        row.summary(),
        row.tasks(),
        row.areas(),
        row.skills(),
        row.error());
  }

  /** 끝낸 이슈가 없어 행을 만들지 않았을 때 — 기간만 채우고 나머지는 빈 값. */
  public static WorkProfileResponse none(MeOverviewPeriod period, MetricsPeriod range) {
    return new WorkProfileResponse(
        period,
        NONE,
        range.from(),
        range.to(),
        null,
        0,
        0,
        null,
        List.of(),
        List.of(),
        List.of(),
        null);
  }
}
