package com.workplace.drive.dto;

import java.util.List;

/** 한 폴더(또는 루트)의 하위 폴더 + 파일 합본 목록. */
public record DriveItemListResponse(
    List<DriveFolderResponse> folders, List<DriveFileResponse> files) {}
