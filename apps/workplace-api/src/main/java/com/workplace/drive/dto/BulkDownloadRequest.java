package com.workplace.drive.dto;

import java.util.List;

/** ZIP 다운로드 요청 — 같은 공간 안의 파일/폴더 id 목록. */
public record BulkDownloadRequest(List<Long> fileIds, List<Long> folderIds) {}
