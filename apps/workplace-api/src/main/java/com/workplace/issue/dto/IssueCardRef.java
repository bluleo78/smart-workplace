package com.workplace.issue.dto;

import com.workplace.global.dto.UserSummary;
import java.util.List;

/**
 * 채팅 앱 링크 카드용 이슈 요약(WP-896) — 키·제목·상태·우선순위·담당자만. 이슈 상세(코멘트·히스토리 등)를 읽지 않는 가벼운 조회 결과다.
 *
 * @param status 상태 범주(TODO·IN_PROGRESS·DONE·CANCELED)
 * @param statusName 프로젝트 상태 이름
 */
public record IssueCardRef(
    String projectKey,
    int number,
    String title,
    String status,
    String statusName,
    String priority,
    List<UserSummary> assignees) {}
