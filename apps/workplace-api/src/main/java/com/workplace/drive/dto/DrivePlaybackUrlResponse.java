package com.workplace.drive.dto;

import java.time.OffsetDateTime;

/**
 * 재생 주소 발급 응답(WP-1532). url 은 인증 없이 Range 로 받을 수 있는 봉인 주소라 이 응답에서만 볼 수 있다.
 *
 * @param url 같은 출처 상대 경로({@code /api/v1/public/drive/playback/{token}}) — 웹이 {@code <video src>} 에
 *     그대로 넣는다
 * @param expiresAt 만료 시각(발급 후 4시간). 만료 전이라도 권한을 잃거나 휴지통·새 버전이면 404
 * @param mimeType 현재 버전 MIME
 */
public record DrivePlaybackUrlResponse(String url, OffsetDateTime expiresAt, String mimeType) {}
