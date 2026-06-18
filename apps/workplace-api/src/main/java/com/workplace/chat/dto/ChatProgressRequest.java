package com.workplace.chat.dto;

import java.util.List;
import java.util.Map;

/** AI 진행(progress) 알림 요청 본문 — streamId/phase/steps. steps 는 자유형(label/status 등) Map 리스트. */
public record ChatProgressRequest(String streamId, String phase, List<Map<String, Object>> steps) {}
