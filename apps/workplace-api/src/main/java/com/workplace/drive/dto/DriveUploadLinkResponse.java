package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/**
 * 업로드 전송 링크 발급 응답(WP-369). url 은 인증 없이 한 번 PUT 할 수 있는 서명 링크이며 평문 토큰을 담으므로 이 응답에서만 볼 수 있다.
 *
 * @param url 공개 업로드 주소({publicBaseUrl}/api/v1/public/drive/transfer/{token}) — {@code curl -T 파일
 *     URL}
 * @param method 항상 "PUT"
 * @param expiresAt 만료 시각(발급 후 10분)
 * @param maxBytes 받을 수 있는 최대 바이트 — 이름의 확장자로 정한 범주 상한과 멀티파트 상한(100MB) 중 작은 값
 * @param name 저장될 파일 이름(정리된 값). 파일 지정 링크는 발급 시점의 파일 이름 — 그 뒤 이름이 바뀌면 새 버전은 바뀐 이름의 같은 파일에 들어간다
 * @param singleUse 항상 true — 첫 PUT 이 링크를 소비한다(실패해도 다시 쓸 수 없다)
 */
public record DriveUploadLinkResponse(
    String url,
    String method,
    OffsetDateTime expiresAt,
    long maxBytes,
    String name,
    boolean singleUse) {}
