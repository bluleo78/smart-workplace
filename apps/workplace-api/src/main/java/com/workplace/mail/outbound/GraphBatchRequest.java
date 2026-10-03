package com.workplace.mail.outbound;

import java.util.Map;

/**
 * Graph JSON batch 요청 한 건(WP-187). body 는 JSON 객체로 직렬화된다.
 *
 * @param id 배치 안에서 응답을 짝짓는 키(역동기화는 메일 id 문자열)
 * @param method HTTP 메서드(예: PATCH)
 * @param url Graph 상대경로(예: /me/messages/{id}) — 배치 규약상 /v1.0 접두 없이
 * @param body 요청 본문
 */
public record GraphBatchRequest(String id, String method, String url, Map<String, Object> body) {}
