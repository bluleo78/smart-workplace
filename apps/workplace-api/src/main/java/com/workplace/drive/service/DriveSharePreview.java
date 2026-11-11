package com.workplace.drive.service;

import java.time.OffsetDateTime;

/**
 * 공유 링크 미리보기 카드 판정 결과(WP-1473) — 메신저 봇(익명, 열람 토큰·로그인 없음) 기준으로 무엇을 보여줄지.
 *
 * <p>비밀번호·사내 링크는 파일 이름·크기·종류를 담지 않는다(링크가 곧 권한이라 잠긴 내용이 카드로 새면 안 된다).
 */
public sealed interface DriveSharePreview {

  /** 누구나 열 수 있는 링크 — 파일 이름·형식·크기·만료일을 카드에 보인다. */
  record Open(String name, String mimeType, long sizeBytes, OffsetDateTime expiresAt)
      implements DriveSharePreview {}

  /** 비밀번호가 걸린 링크 — 파일 정보 없이 잠금 안내만. */
  record PasswordProtected() implements DriveSharePreview {}

  /** 사내(INTERNAL) 링크 — 파일 정보 없이 로그인 안내만. */
  record InternalOnly() implements DriveSharePreview {}
}
