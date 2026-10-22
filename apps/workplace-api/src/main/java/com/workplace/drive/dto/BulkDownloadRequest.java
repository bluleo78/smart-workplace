package com.workplace.drive.dto;

import jakarta.validation.constraints.NotNull;
import java.util.List;

/** ZIP 다운로드 요청 — 같은 공간 안의 파일/폴더 id 목록. */
// 원소 null 은 400 — 서비스의 long 언박싱에서 NPE(500)가 났다(WP-743).
public record BulkDownloadRequest(List<@NotNull Long> fileIds, List<@NotNull Long> folderIds) {}
