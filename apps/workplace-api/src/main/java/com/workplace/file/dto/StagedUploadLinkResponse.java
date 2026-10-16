package com.workplace.file.dto;

import java.time.OffsetDateTime;

/**
 * 스테이징 업로드 링크(WP-421) — 로그인 없이 한 번 쓰는 PUT URL. 평문 토큰은 이 응답에서만 나온다({@code curl -T 파일 URL}).
 *
 * @param url {publicBaseUrl}/api/v1/public/staged-files/su_…
 * @param method 늘 {@code PUT}
 * @param expiresAt 링크 만료(발급 뒤 10분)
 * @param maxBytes 받을 수 있는 최대 바이트(25MB) — 목적지 상한은 클레임에서 다시 본다
 * @param name 링크에 묶인(정리된) 파일 이름
 * @param singleUse 늘 true(일회용)
 */
public record StagedUploadLinkResponse(
    String url,
    String method,
    OffsetDateTime expiresAt,
    long maxBytes,
    String name,
    boolean singleUse) {}
