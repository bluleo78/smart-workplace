package com.workplace.drive.dto;

import java.util.List;

/** 「최근」 한 쪽(WP-1699). nextCursor 는 다음 쪽이 없으면 null — 값은 불투명 문자열이니 그대로 되돌려 보낸다. */
public record DriveRecentPageResponse(List<DriveRecentFileResponse> items, String nextCursor) {}
