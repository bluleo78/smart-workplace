package com.workplace.mail.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/** #520 메일→이슈 승격 요청(사용자 최종 수정값). projectKey/담당은 사용자가 모달에서 확정. */
public record PromoteToIssueRequest(
    @NotBlank String projectKey,
    @NotBlank @Size(max = 200) String title,
    @Size(max = 10000) String body,
    @Pattern(regexp = "LOW|MID|HIGH") String priority,
    List<Long> assigneeIds) {}
