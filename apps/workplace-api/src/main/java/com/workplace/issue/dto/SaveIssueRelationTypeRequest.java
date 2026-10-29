package com.workplace.issue.dto;

import com.workplace.global.validation.VisibleText;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 사용자 정의 관계 유형 추가·편집 요청. 방향 있는 유형이면 {@code inwardLabel} 이 필수이고, 방향 없는 유형이면 무시한다(NULL 로 저장).
 *
 * <p>이름·말은 제로폭 공백(U+200B)·점자 빈칸(U+2800)처럼 보이지 않는 글자만으로는 안 된다(WP-1106) — 표의 이름 칸과 이슈 「관계」 묶음 제목이 빈칸이
 * 된다. B 쪽 말은 방향 있는 유형에서만 쓰여 서비스가 같은 기준으로 본다.
 *
 * @param outwardLabel A 쪽 말(방향 없으면 유일한 말)
 * @param inwardLabel B 쪽 말
 */
public record SaveIssueRelationTypeRequest(
    @NotBlank @VisibleText(message = "이름을 입력해 주세요") @Size(max = 30) String name,
    boolean directed,
    @NotBlank @VisibleText(message = "말을 입력해 주세요") @Size(max = 30) String outwardLabel,
    @Size(max = 30) String inwardLabel) {}
