package com.workplace.issue.dto;

import com.workplace.version.dto.VersionSummary;
import java.util.List;

/** 이슈 버전 교체 뒤 응답(WP-888) — 두 종류 모두 버전 목록 순서. */
public record IssueVersionsResponse(
    List<VersionSummary> fixVersions, List<VersionSummary> affectsVersions) {}
