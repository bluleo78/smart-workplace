package com.workplace.issue.dto;

import com.workplace.global.validation.VisibleText;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 코멘트 수정 요청. */
public record UpdateCommentRequest(
    @NotBlank @VisibleText @Size(max = IssueTextLimits.BODY_MAX) String body) {}
