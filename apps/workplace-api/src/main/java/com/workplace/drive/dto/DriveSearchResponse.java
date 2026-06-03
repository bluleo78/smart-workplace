package com.workplace.drive.dto;

import java.util.List;

/** 공간 이름 검색 결과 — 폴더 먼저, 파일 다음. */
public record DriveSearchResponse(List<DriveFolderHit> folders, List<DriveFileHit> files) {}
