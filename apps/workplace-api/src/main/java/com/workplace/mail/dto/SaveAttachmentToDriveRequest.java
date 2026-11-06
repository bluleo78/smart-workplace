package com.workplace.mail.dto;

import jakarta.validation.constraints.NotNull;

/**
 * WP-1400 메일 첨부를 드라이브에 저장 요청 — 넣을 드라이브 공간과 폴더.
 *
 * @param spaceId 대상 드라이브 공간(EDITOR 이상이어야 한다)
 * @param folderId 대상 폴더(그 공간의 활성 폴더), null 이면 공간 루트
 */
public record SaveAttachmentToDriveRequest(@NotNull Long spaceId, Long folderId) {}
