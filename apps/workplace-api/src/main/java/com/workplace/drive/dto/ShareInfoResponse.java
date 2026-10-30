package com.workplace.drive.dto;

/**
 * 공유 링크 정보 응답(GET /api/v1/public/drive/share/{token}, WP-1227). 받는 화면이 로그인 안내·비밀번호 잠금 카드·미리보기 중 무엇을
 * 보일지 정한다.
 *
 * <p>로그인·비밀번호가 먼저 필요하면 {@link Gate} 만 — 파일 이름·크기·공유한 사람 같은 필드를 싣지 않아, 열 수 없는 사람에게 파일 정보를 드러내지 않는다.
 * 통과하면 {@link Full}.
 */
public sealed interface ShareInfoResponse {

  /** 사내 링크를 비로그인으로 열었다 — 로그인 안내. */
  static ShareInfoResponse loginRequired() {
    return new Gate(false, true);
  }

  /** 비밀번호 링크인데 유효한 열람 토큰이 없다(잠긴 링크 포함) — 비밀번호 입력 카드. */
  static ShareInfoResponse passwordRequired() {
    return new Gate(true, false);
  }

  /** 열 수 있는 링크의 파일 정보. */
  static ShareInfoResponse full(
      String name,
      String mimeType,
      long sizeBytes,
      String sharedBy,
      boolean loginAvailable,
      DriveOpen driveOpen) {
    return new Full(false, false, name, mimeType, sizeBytes, sharedBy, loginAvailable, driveOpen);
  }

  /** 먼저 거쳐야 할 단계만 알리는 응답(파일 필드 없음). */
  record Gate(boolean passwordRequired, boolean loginRequired) implements ShareInfoResponse {}

  /**
   * 파일 정보.
   *
   * @param sharedBy 링크를 만든 사람 이름(찾을 수 없으면 null)
   * @param loginAvailable 비로그인 요청이면 true — 화면이 「로그인」 버튼을 보일지
   * @param driveOpen 로그인 + 같은 워크스페이스 + 공간 VIEWER 이상일 때만 위치, 아니면 null
   */
  record Full(
      boolean passwordRequired,
      boolean loginRequired,
      String name,
      String mimeType,
      long sizeBytes,
      String sharedBy,
      boolean loginAvailable,
      DriveOpen driveOpen)
      implements ShareInfoResponse {}

  /** 「드라이브에서 열기」 이동 위치. folderId 는 공간 루트면 null. */
  record DriveOpen(long spaceId, Long folderId, long driveFileId) {}
}
