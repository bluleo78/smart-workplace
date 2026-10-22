package com.workplace.issue.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 대기열 이슈 가져가기 요청(WP-800). queueLabel 은 가져가며 떼어 낼 대기열 라벨의 이름 — 코드에 이름을 박지 않고 호출자가 정한다. 길이 상한은 라벨 이름
 * 상한(40, label.name VARCHAR(40))과 같다.
 */
public record ClaimIssueRequest(
    @NotBlank(message = "대기열 라벨 이름을 입력해 주세요") @Size(max = 40) String queueLabel) {}
