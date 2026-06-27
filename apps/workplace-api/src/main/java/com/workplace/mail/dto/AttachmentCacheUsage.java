package com.workplace.mail.dto;

/** 첨부 캐시 사용량 메터링. physicalBytes=실제 저장(distinct blob), logicalBytes=dedup 전 논리 합. */
public record AttachmentCacheUsage(long physicalBytes, long logicalBytes, long blobCount) {}
