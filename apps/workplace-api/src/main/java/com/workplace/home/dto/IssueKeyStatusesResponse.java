package com.workplace.home.dto;

import com.workplace.issue.service.IssueKeyStatus;
import java.util.List;

/**
 * 이슈 키 상태 일괄 조회 응답(WP-2102) — 볼 수 있는 이슈만 담긴다.
 *
 * @param items 키별 상태 이름·범주(issueKey·statusName·statusCategory)
 */
public record IssueKeyStatusesResponse(List<IssueKeyStatus> items) {}
