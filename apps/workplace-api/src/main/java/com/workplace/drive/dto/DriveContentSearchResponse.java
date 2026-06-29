package com.workplace.drive.dto;

import java.util.List;

/** 콘텐츠 검색 응답. semantic=true 면 벡터 랭커가 참여(false=키워드 전용 강등). */
public record DriveContentSearchResponse(List<DriveContentHit> hits, boolean semantic) {}
