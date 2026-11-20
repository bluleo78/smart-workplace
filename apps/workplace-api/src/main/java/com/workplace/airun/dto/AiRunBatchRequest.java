package com.workplace.airun.dto;

import java.util.List;

/** AI 처리 기록 묶음 수신 요청(WP-1827) — 한 요청 최대 500건. */
public record AiRunBatchRequest(List<AiRunRecord> runs) {}
