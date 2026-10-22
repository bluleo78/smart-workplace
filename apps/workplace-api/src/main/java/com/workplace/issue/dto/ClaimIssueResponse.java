package com.workplace.issue.dto;

import com.workplace.global.dto.UserSummary;
import com.workplace.label.dto.LabelSummary;
import java.util.List;

/** 가져간 뒤의 이슈 담당자(기존 담당자 + 호출 AI)와 라벨(대기열 라벨만 빠진 나머지). */
public record ClaimIssueResponse(List<UserSummary> assignees, List<LabelSummary> labels) {}
