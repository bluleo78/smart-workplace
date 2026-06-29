package com.workplace.drive.dto;

/**
 * 파일 콘텐츠 요약 응답. summary 는 파이프라인(#525)이 저장한 요약(없으면 null), status 는 추출
 * 상태(PENDING/EXTRACTING/TEXT_READY/SUMMARIZING/DONE/FAILED/SKIPPED, 행 없으면 null).
 */
public record FileSummaryResponse(String summary, String status) {}
