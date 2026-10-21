package com.workplace.wiki.dto;

import java.util.List;

/**
 * 관리자 공유 일괄 해제 요청(WP-579) — 해제할 공유가 걸린 페이지 id 목록. 공유가 없는 페이지는 건너뛴다.
 *
 * @param pageIds 공유를 해제할 페이지 id(비어 있거나 상한 초과면 400)
 */
public record WikiShareRevokeRequest(List<Long> pageIds) {}
