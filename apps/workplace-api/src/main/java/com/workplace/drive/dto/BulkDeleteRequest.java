package com.workplace.drive.dto;

import java.util.List;

/** 벌크 삭제 요청 — 같은 공간 안의 파일/폴더 id 목록(둘 중 비어도 됨). */
public record BulkDeleteRequest(List<Long> fileIds, List<Long> folderIds) {}
