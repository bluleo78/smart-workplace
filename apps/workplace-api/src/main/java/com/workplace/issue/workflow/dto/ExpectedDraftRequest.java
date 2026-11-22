package com.workplace.issue.workflow.dto;

import com.workplace.global.time.SupportedDateTime;
import java.time.Instant;

/**
 * 게시·되돌리기가 함께 쓰는 선택 본문(본문 자체가 없어도 된다).
 *
 * @param expectedDraftUpdatedAt 게시하거나 되돌려 덮으려고 본 초안의 시각(밀리초로 비교, null 이면 충돌 검사 생략)
 */
public record ExpectedDraftRequest(@SupportedDateTime Instant expectedDraftUpdatedAt) {}
