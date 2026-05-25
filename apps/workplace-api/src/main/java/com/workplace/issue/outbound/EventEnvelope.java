package com.workplace.issue.outbound;

import java.util.Map;

/** ai-agent 로 전송하는 외부 페이로드. ai-agent 스캐폴딩의 POST /events 가 받는 {type, payload} envelope. */
public record EventEnvelope(String type, Map<String, Object> payload) {}
