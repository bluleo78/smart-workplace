package com.workplace.drive.dto;

import jakarta.validation.constraints.NotNull;
import java.util.List;

/** 벌크 이동 요청 — 파일/폴더 id 목록을 같은 공간 내 targetFolderId(null=루트)로 이동. */
// 원소 null 은 400 — 서비스의 long 언박싱에서 NPE(500)가 났다(WP-743).
public record BulkMoveRequest(
    List<@NotNull Long> fileIds, List<@NotNull Long> folderIds, Long targetFolderId) {}
