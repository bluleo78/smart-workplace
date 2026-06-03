package com.workplace.drive.dto;

/** 폴더 이동/복사 대상 부모 폴더. null = 공간 루트. */
public record TargetParentRequest(Long targetParentId) {}
