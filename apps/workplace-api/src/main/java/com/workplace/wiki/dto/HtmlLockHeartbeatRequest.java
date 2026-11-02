package com.workplace.wiki.dto;

import java.util.UUID;

/**
 * 편집 중 신호(WP-1308) — 입력이 있는 동안 화면이 주기적으로 보낸다. 잠금의 마지막 입력 시각을 새로 하고, 고치던 소스를 임시 저장본으로 남긴다.
 *
 * @param token 「편집」으로 얻은 편집 세션 표지 — 다르거나 없으면(남·다른 창이 가져감, 저장·취소·강제 풀기로 풀림) 아무것도 바꾸지 않고 mine=false
 * @param html 지금까지 고친 소스(null 이면 임시 저장본은 그대로). 크기 상한(5MB)은 서비스가 지킨다
 * @param baseVersion 고치기 시작한 판 — html 과 함께 준다(그사이 다른 저장이 있었는지 다음에 알리려고)
 */
public record HtmlLockHeartbeatRequest(UUID token, String html, Integer baseVersion) {}
