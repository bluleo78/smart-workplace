package com.workplace.drive.service;

import java.time.OffsetDateTime;

/**
 * 채팅 앱 카드용 공유 링크 판정 결과(WP-1474) — 로그인한 <b>보는 사람</b> 기준으로 카드에 무엇을 보일지. 메신저 봇용 {@link
 * DriveSharePreview}(익명 기준)와 달리 보는 사람이 그 파일 공간의 구성원이면 링크 상태와 무관하게 드라이브의 파일로 안내한다.
 *
 * <p>비밀번호 결과는 파일 이름·크기·종류·공간·만료일을 담지 않는다 — 링크가 곧 권한이라, 열 수 없는 사람에게 잠긴 내용이 카드로 새면 안 된다. 열 수 없는
 * 링크(만료·폐기·없는 토큰·비활성 워크스페이스·휴지통/없는 파일)는 결과가 아니라 {@link
 * com.workplace.drive.exception.DriveShareLinkGoneException}(410)이다.
 */
public sealed interface DriveShareAppCard {

  /**
   * 보는 사람이 파일이 있는 공간의 구성원(VIEWER 이상, 부서 역할 포함) — 드라이브의 그 파일로 바로 간다.
   *
   * @param folderId 파일이 든 폴더(루트면 null)
   */
  record Member(
      String name, String mimeType, String spaceName, long spaceId, Long folderId, long fileId)
      implements DriveShareAppCard {}

  /** 구성원은 아니지만 링크로 열 수 있다(비밀번호 없음) — 이름·형식·크기·만료일을 보인다. */
  record Open(String name, String mimeType, long sizeBytes, OffsetDateTime expiresAt)
      implements DriveShareAppCard {}

  /**
   * 보는 사람이 공유 폴더가 있는 공간의 구성원(WP-1538) — 드라이브의 그 폴더로 바로 간다.
   *
   * @param audience EXTERNAL | INTERNAL
   */
  record FolderMember(
      String name,
      String spaceName,
      long spaceId,
      long folderId,
      String audience,
      int folderCount,
      int fileCount,
      String sharedBy)
      implements DriveShareAppCard {}

  /** 구성원은 아니지만 링크로 열 수 있는 폴더(WP-1538, 비밀번호 없음) — 이름·바로 아래 수·공유한 사람·만료일. */
  record FolderOpen(
      String name,
      String audience,
      int folderCount,
      int fileCount,
      String sharedBy,
      OffsetDateTime expiresAt)
      implements DriveShareAppCard {}

  /** 구성원이 아니고 비밀번호가 걸린 링크 — 이름·수 없이 잠금 안내만. target 으로 파일·폴더 제목을 가른다(WP-1538). */
  record PasswordProtected(DriveShareTarget target) implements DriveShareAppCard {}
}
