package com.workplace.drive.dto;

import com.workplace.drive.service.DriveShareTarget;

/**
 * 공유 링크 정보 응답(GET /api/v1/public/drive/share/{token}, WP-1227). 받는 화면이 로그인 안내·비밀번호 잠금 카드·미리보기 중 무엇을
 * 보일지 정한다.
 *
 * <p>로그인·비밀번호가 먼저 필요하면 {@link Gate} 만 — 파일 이름·크기·공유한 사람 같은 필드를 싣지 않아, 열 수 없는 사람에게 파일 정보를 드러내지 않는다.
 * 통과하면 파일 링크는 {@link Full}, 폴더 링크(WP-1538)는 {@link FolderFull}.
 */
public sealed interface ShareInfoResponse {

  /** 사내 링크를 비로그인으로 열었다 — 로그인 안내. 대상 종류만 싣는다(WP-1538, 잠금 카드 문구용 — P9). */
  static ShareInfoResponse loginRequired(DriveShareTarget target) {
    return new Gate(false, true, target);
  }

  /** 비밀번호 링크인데 유효한 열람 토큰이 없다(잠긴 링크 포함) — 비밀번호 입력 카드. 대상 종류만 싣는다(WP-1538). */
  static ShareInfoResponse passwordRequired(DriveShareTarget target) {
    return new Gate(true, false, target);
  }

  /** 열 수 있는 링크의 파일 정보. */
  static ShareInfoResponse full(
      String name,
      String mimeType,
      long sizeBytes,
      String sharedBy,
      boolean loginAvailable,
      DriveOpen driveOpen) {
    return new Full(
        DriveShareTarget.FILE,
        false,
        false,
        name,
        mimeType,
        sizeBytes,
        sharedBy,
        loginAvailable,
        driveOpen);
  }

  /** 열 수 있는 폴더 링크의 정보(WP-1538). */
  static ShareInfoResponse folderFull(
      String name,
      int folderCount,
      int fileCount,
      String sharedBy,
      boolean loginAvailable,
      FolderDriveOpen driveOpen) {
    return new FolderFull(
        false,
        false,
        DriveShareTarget.FOLDER,
        name,
        folderCount,
        fileCount,
        sharedBy,
        loginAvailable,
        driveOpen);
  }

  /**
   * 먼저 거쳐야 할 단계만 알리는 응답(이름·수·크기 없음). target 은 잠금 카드가 「파일」/「폴더」 문구를 고르게 하는 대상 종류뿐이다(WP-1538, P9 —
   * OG·앱 카드도 이미 종류는 드러낸다).
   */
  record Gate(boolean passwordRequired, boolean loginRequired, DriveShareTarget target)
      implements ShareInfoResponse {}

  /**
   * 파일 정보.
   *
   * @param kind 늘 FILE(JSON "FILE") — 받는 화면이 파일·폴더 화면을 가른다(WP-1538)
   * @param sharedBy 링크를 만든 사람 이름(찾을 수 없으면 null)
   * @param loginAvailable 비로그인 요청이면 true — 화면이 「로그인」 버튼을 보일지
   * @param driveOpen 로그인 + 같은 워크스페이스 + 공간 VIEWER 이상일 때만 위치, 아니면 null
   */
  record Full(
      DriveShareTarget kind,
      boolean passwordRequired,
      boolean loginRequired,
      String name,
      String mimeType,
      long sizeBytes,
      String sharedBy,
      boolean loginAvailable,
      DriveOpen driveOpen)
      implements ShareInfoResponse {}

  /**
   * 폴더 정보(WP-1538).
   *
   * @param kind 늘 FOLDER(JSON "FOLDER")
   * @param folderCount 공유 폴더 바로 아래 살아 있는 폴더 수(P5)
   * @param fileCount 공유 폴더 바로 아래 살아 있는 파일 수(P5)
   * @param driveOpen 로그인 + 같은 워크스페이스 + 공간 실효 역할일 때만 위치, 아니면 null
   */
  record FolderFull(
      boolean passwordRequired,
      boolean loginRequired,
      DriveShareTarget kind,
      String name,
      int folderCount,
      int fileCount,
      String sharedBy,
      boolean loginAvailable,
      FolderDriveOpen driveOpen)
      implements ShareInfoResponse {}

  /** 「드라이브에서 열기」 이동 위치. folderId 는 공간 루트면 null. */
  record DriveOpen(long spaceId, Long folderId, long driveFileId) {}

  /** 폴더 링크의 「드라이브에서 열기」 위치 — 공유 폴더(WP-1538). */
  record FolderDriveOpen(long spaceId, long folderId) {}
}
