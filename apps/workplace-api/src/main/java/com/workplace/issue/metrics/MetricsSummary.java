package com.workplace.issue.metrics;

/**
 * 한 기간의 성과 요약(WP-1476). 현재 기간과 지난 기간에 같은 모양으로 쓴다.
 *
 * <p>값이 정의되지 않는 지표(분모 0)는 0 이 아니라 null 이다 — 화면이 「—」 로 그리고, 0% 와 「데이터 없음」을 구분하게.
 *
 * @param completed 완료 수(DONE, 취소 제외)
 * @param completedWithAi 완료 중 「AI와 함께」 한 수
 * @param created 새로 생긴 수(사람 기준이면 내가 보고자). 상태 무관 — 만든 수라 취소도 센다
 * @param onTime 완료 중 닫힐 당시 마감일 이내에 닫힌 수
 * @param overdue 완료 중 닫힐 당시 마감일을 넘겨 닫힌 수
 * @param noDue 완료 중 닫힐 당시 마감일이 없던 수
 * @param overdueLateDaysAvg 초과분의 늦은 날수 평균. 초과 0건이면 null
 * @param onTimeRate 마감 있는 완료 중 기한 내 비율(0~1). 마감 있는 완료가 0건이면 null
 * @param leadTimeDaysAvg 소요(생성→닫힘) 일수 평균(반올림 없음). 소요가 있는 완료 0건이면 null(음수 소요는 제외)
 * @param leadTimeDaysMedian 소요 일수 중간값(짝수면 가운데 두 값의 평균). 소요가 있는 완료 0건이면 null(음수 소요는 제외)
 */
public record MetricsSummary(
    int completed,
    int completedWithAi,
    int created,
    int onTime,
    int overdue,
    int noDue,
    Double overdueLateDaysAvg,
    Double onTimeRate,
    Double leadTimeDaysAvg,
    Double leadTimeDaysMedian) {}
