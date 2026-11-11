package com.workplace.issue.profile;

import com.workplace.issue.dto.MeOverviewPeriod;
import com.workplace.issue.profile.WorkProfileCalc.Count;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * work_profile 한 행(WP-1485) — 사람×기간의 최신 업무 프로파일.
 *
 * <p>{@code pendingSince} 는 PENDING 점유 시각, {@code manualDate}/{@code manualCount} 는 「다시 분석」 하루 호출
 * 계수다. 분석이 한 번도 끝나지 않은 행은 기간·분석 시각·내용이 비어 있다(요약 null, 목록 빈 리스트).
 */
public record WorkProfileRow(
    long userId,
    MeOverviewPeriod period,
    WorkProfileStatus status,
    LocalDate periodFrom,
    LocalDate periodTo,
    OffsetDateTime analyzedAt,
    String fingerprint,
    int totalCount,
    int analyzedCount,
    String summary,
    List<Count> tasks,
    List<Count> areas,
    List<String> skills,
    String error,
    OffsetDateTime pendingSince,
    LocalDate manualDate,
    int manualCount) {}
