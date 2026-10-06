package com.workplace.home.dto;

/** 메인 AI 채팅 첨부 선업로드 응답 한 건(WP-234) — 이슈 챗 업로드 응답과 같은 형태. 전송(fileIds)에 쓰기 전까지 임시 파일이다. */
public record HomeUploadedFile(long fileId, String originalName, String mimeType, long sizeBytes) {}
