package com.workplace.issue.dto;

import java.util.Map;

/**
 * 사이클 진행 집계. total = 연결된 비삭제 이슈 수, done = status DONE 수, byStatus = 상태별 분포. 진행률은 프론트에서 done/total 로
 * 계산.
 */
public record CycleProgress(Long cycleId, int total, int done, Map<String, Integer> byStatus) {}
