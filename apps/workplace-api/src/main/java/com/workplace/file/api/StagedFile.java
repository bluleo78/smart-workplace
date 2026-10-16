package com.workplace.file.api;

/**
 * 클레임된 스테이징 파일(WP-421) — 호출 도메인이 정션 행을 만들고 추출 이벤트·응답을 꾸리는 데 필요한 FILE 열만 담는다.
 *
 * @param fileId file.id
 * @param originalName 원본 파일명
 * @param mimeType 저장 MIME
 * @param sizeBytes 크기(바이트) — 목적지 상한(이슈 25MB·노트 이미지 10MB 등)을 호출 도메인이 다시 본다
 * @param storagePath 저장소 상대 경로
 */
public record StagedFile(
    long fileId, String originalName, String mimeType, long sizeBytes, String storagePath) {}
