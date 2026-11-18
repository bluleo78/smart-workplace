package com.workplace.drive.dto;

import java.util.List;

/**
 * 「별표」 목록 한 페이지(WP-1698). 별표한 순(최근 먼저). nextCursor 가 null 이면 마지막 페이지 — 다음 요청의 cursor 로 그대로 돌려보낸다.
 */
public record DriveStarredPage(List<DriveStarredItemResponse> items, String nextCursor) {}
