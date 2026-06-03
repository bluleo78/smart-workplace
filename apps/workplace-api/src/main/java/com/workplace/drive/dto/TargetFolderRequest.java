package com.workplace.drive.dto;

/** 파일 이동/복사 대상 폴더. null = 공간 루트. */
public record TargetFolderRequest(Long targetFolderId) {}
