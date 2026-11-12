package com.workplace.wiki.report.dto;

import java.time.LocalDate;
import java.time.OffsetDateTime;

/**
 * 개요 카드 리포트 줄의 최신 리포트(WP-1483). 배지·한 줄은 페이지 마크다운을 그때 읽는다 — 사람이 고치면 카드도 바뀐다.
 *
 * @param title 페이지의 지금 제목
 * @param periodStart 회차 시작일(KST, 포함)
 * @param periodEnd 회차 끝일(KST, 포함)
 * @param createdAt 리포트를 만든 시각(실행 시각)
 * @param badge ON_TRACK|WARN|RISK — 본문에서 못 읽으면 생성 때 저장한 배지, 그것도 없으면 null
 * @param line 「상태와 한 줄」 첫 문단(최대 200자), 없으면 null
 * @param edited AI 가 쓴 뒤 사람이 고쳤는지(페이지 수정 시각 &gt; AI 작성 시각)
 */
public record ReportCard(
    long pageId,
    String title,
    LocalDate periodStart,
    LocalDate periodEnd,
    OffsetDateTime createdAt,
    String badge,
    String line,
    boolean edited) {}
