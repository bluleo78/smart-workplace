package com.workplace.version.dto;

/** 이슈 응답·이력에 싣는 버전 요약(id·이름·상태). 상태는 UNRELEASED|RELEASED|ARCHIVED. */
public record VersionSummary(long id, String name, String status) {}
