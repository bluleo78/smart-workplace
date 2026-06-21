package com.workplace.drive.dto;

import java.util.List;

/** 벌크 이동 요청 — 파일/폴더 id 목록을 같은 공간 내 targetFolderId(null=루트)로 이동. */
public record BulkMoveRequest(List<Long> fileIds, List<Long> folderIds, Long targetFolderId) {}
