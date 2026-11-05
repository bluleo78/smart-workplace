package com.workplace.search.dto;

import java.util.List;

/**
 * 통합 검색 드라이브 한 페이지 — 이름 일치 다음에 본문만 일치한 파일이 이어진다(WP-1353, WP-1356). hasMore 는 size 보다 한 건 더 읽어 판정한다.
 */
public record DriveNamePage(List<DriveNameHit> items, boolean hasMore) {}
