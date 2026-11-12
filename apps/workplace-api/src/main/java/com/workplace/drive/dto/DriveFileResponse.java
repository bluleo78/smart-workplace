package com.workplace.drive.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.OffsetDateTime;

/**
 * 파일 응답. fileId 는 file core FILE.id, mimeType/sizeBytes/category 는 FILE 메타. versionCount 는 총 버전
 * 수(#79).
 */
public record DriveFileResponse(
    long id,
    Long folderId,
    long fileId,
    String name,
    String mimeType,
    long sizeBytes,
    String category,
    OffsetDateTime createdAt,
    // 목록 3열(이름/크기/수정일, #799) 노출용 — 버전 업로드/이름변경/이동 시 갱신됨(drive_file.updated_at).
    OffsetDateTime updatedAt,
    int versionCount,
    // 컬럼 아님 — 조회 시점에 FileStore.exists() 로 계산되는 파생 필드(원본 blob 유실 가시화, #739).
    // 플래그를 두지 않는 이유는 설계 문서 참조: 로컬 디스크 stat 비용이 무시할 수준이라 캐시/컬럼화의
    // 불일치 위험을 감수할 이유가 없다.
    boolean available,
    // 화면 주소(WP-1523) — 웹 driveFilePath 와 같은 {공개 웹
    // 주소}/drive/spaces/{spaceId}?folderId=…&preview={id}.
    // AI 가 본문에 주소를 지어내지 않고 이 값을 쓴다. 공개 웹 주소가 비었으면 null 이라 JSON 에서 빠진다.
    @JsonInclude(JsonInclude.Include.NON_NULL) String url) {

  /**
   * 화면 주소를 뺀 사본 — 로그인 없이 쓰는 공개 전송 업로드 응답용(WP-1523). 화면 주소에는 내부 공간 id 가 들어가고 링크로 올리는 쪽은 그 화면을 열 사람이
   * 아닐 수 있다.
   */
  public DriveFileResponse withoutUrl() {
    return new DriveFileResponse(
        id,
        folderId,
        fileId,
        name,
        mimeType,
        sizeBytes,
        category,
        createdAt,
        updatedAt,
        versionCount,
        available,
        null);
  }
}
