package com.workplace.issue.report;

/**
 * 「지난 리포트 이후」 표 한 줄(WP-1483) — 시스템이 계산해 표에 그대로 쓰는 값. AI 가 쓴 표 몸통은 이 행들로 다시 만든다.
 *
 * @param label 행 이름(완료·새로 생김·열린 이슈·기한 지남·「사이클 M/d~d」·「{버전} (M/d)」)
 * @param current 「이번」 칸 글자(숫자 또는 「done / total」)
 * @param change 「변화」 칸 글자({@code +n} / {@code −n}(U+2212) / {@code 0} / 「—」, 사이클·버전은 「예상 M/d」 또는
 *     「—」)
 */
public record ReportTableRow(String label, String current, String change) {}
