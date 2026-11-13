package com.workplace.drive.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 폴더 공유 링크의 하위 목록(GET /api/v1/public/drive/share/{token}/children, WP-1538).
 *
 * <p>공개 응답 전용이다 — {@link DriveFileResponse} 의 storagePath·spaceId 같은 내부 칸을 싣지 않으려고 따로 둔다.
 *
 * @param folderId 지금 보는 폴더 id(공유 폴더 또는 그 자손)
 * @param path 공유 폴더 → 지금 폴더 순서의 경로(둘 다 포함). 공유 폴더 위는 싣지 않는다
 * @param folders 바로 아래 살아 있는 폴더(이름순)
 * @param files 바로 아래 살아 있는 파일(이름순)
 * @param truncated 상한(1,000개)을 넘어 일부만 실었으면 true
 */
public record ShareFolderListing(
    long folderId,
    List<PathItem> path,
    List<FolderItem> folders,
    List<FileItem> files,
    boolean truncated) {

  /** 경로 한 칸. */
  public record PathItem(long id, String name) {}

  /** 하위 폴더 한 줄. */
  public record FolderItem(long id, String name, OffsetDateTime updatedAt) {}

  /** 하위 파일 한 줄 — 미리보기·다운로드 판단에 필요한 형식·크기만. */
  public record FileItem(
      long id, String name, String mimeType, long sizeBytes, OffsetDateTime updatedAt) {}
}
