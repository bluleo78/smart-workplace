package com.workplace.wiki.dto;

import java.util.List;

/** 노트 「즐겨찾기」 한 쪽(WP-1765). nextCursor 는 다음 쪽이 없으면 null — 값은 불투명 문자열이니 그대로 되돌려 보낸다. */
public record WikiStarredPageResponse(List<WikiStarredPageItem> items, String nextCursor) {}
