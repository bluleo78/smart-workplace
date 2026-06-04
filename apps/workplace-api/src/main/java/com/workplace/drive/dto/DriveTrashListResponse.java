package com.workplace.drive.dto;

import java.util.List;

/** 한 공간의 휴지통 목록(trash_root 항목만). */
public record DriveTrashListResponse(List<DriveTrashItemResponse> items) {}
