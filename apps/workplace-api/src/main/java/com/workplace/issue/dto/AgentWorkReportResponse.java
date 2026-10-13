package com.workplace.issue.dto;

/** 명시 보고 응답(WP-377). ENDED 보고면 work=null, ended=true. */
public record AgentWorkReportResponse(AgentWorkView work, boolean ended) {}
