package com.workplace.issue.dto;

import com.workplace.global.validation.VisibleText;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 코멘트 생성 요청. */
public record CreateCommentRequest(
    @NotBlank @VisibleText @Size(max = IssueTextLimits.BODY_MAX) String body) {}
