package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/**
 * 다운로드 전송 링크 발급 응답(WP-369). url 은 인증 없이 한 번 내려받을 수 있는 서명 링크이며 평문 토큰을 담으므로 이 응답에서만 볼 수 있다.
 *
 * @param url 공개 다운로드 주소({publicBaseUrl}/api/v1/public/drive/transfer/{token})
 * @param expiresAt 만료 시각(발급 후 10분)
 * @param name 내려받을 파일 이름(드라이브 이름)
 * @param sizeBytes 파일 크기
 * @param mimeType 파일 MIME
 * @param singleUse 항상 true — 첫 GET 이 링크를 소비하므로 다시 받으려면 새로 발급해야 한다
 */
public record DriveDownloadLinkResponse(
    String url,
    OffsetDateTime expiresAt,
    String name,
    long sizeBytes,
    String mimeType,
    boolean singleUse) {}
