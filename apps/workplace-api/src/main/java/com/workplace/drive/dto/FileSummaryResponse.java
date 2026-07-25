package com.workplace.drive.dto;

/**
 * 파일 콘텐츠 요약 응답. summary 는 파이프라인(#525)이 저장한 요약(없으면 null), status 는 추출
 * 상태(PENDING/EXTRACTING/TEXT_READY/SUMMARIZING/DONE/FAILED/SKIPPED, 행 없으면 null). reason 은
 * SKIPPED/FAILED 일 때만 채워지는 사용자 문구(#735) — 내부 error 원문(예: unsupported-mime:...)을 그대로 노출하지 않기 위해
 * DriveFileService.toReason 이 매핑한다.
 */
public record FileSummaryResponse(String summary, String status, String reason) {}
