package com.workplace.drive.dto;

/** breadcrumb 세그먼트 — 폴더 id·이름. 루트→대상 순으로 반환된다. */
public record DriveFolderPathSegment(long id, String name) {}
