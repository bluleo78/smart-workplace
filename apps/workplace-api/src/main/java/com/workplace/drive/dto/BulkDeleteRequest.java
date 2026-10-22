package com.workplace.drive.dto;

import jakarta.validation.constraints.NotNull;
import java.util.List;

/** 벌크 삭제 요청 — 같은 공간 안의 파일/폴더 id 목록(둘 중 비어도 됨). */
// 원소 null 은 400 — 서비스의 long 언박싱에서 NPE(500)가 났다(WP-743).
public record BulkDeleteRequest(List<@NotNull Long> fileIds, List<@NotNull Long> folderIds) {}
