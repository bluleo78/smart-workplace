package com.workplace.wiki.dto;

import java.util.List;

/** 내가 즐겨찾기한 노트 id 전체(WP-1765). 읽기 권한으로 거르지 않고 순서도 의미 없다 — 화면의 별 표시 판정용. */
public record WikiStarredIdsResponse(List<Long> pageIds) {}
