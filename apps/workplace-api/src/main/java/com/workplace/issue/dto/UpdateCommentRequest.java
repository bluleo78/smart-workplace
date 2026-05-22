package com.workplace.issue.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 코멘트 수정 요청. */
public record UpdateCommentRequest(@NotBlank @Size(max = 10000) String body) {}
