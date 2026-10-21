package com.workplace.wiki.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 인에디터 /ai 스트리밍 요청 본문. 페이지 본문·제목은 서버가 DB 에서 채우므로 클라이언트는 액션과 선택/지시문만 보낸다.
 *
 * @param action 수행 액션(요약·초안·이어쓰기). 소문자 와이어로 바인딩.
 * @param prompt draft 액션의 지시문(선택)
 * @param selection 요약 대상 선택 영역(선택)
 */
public record WikiAiRequest(
    @NotNull WikiAiAction action,
    // WP-674: 지시문 상한 — 웹 「AI 초안 작성」 창은 짧게 막지만 API 를 바로 부르면 무제한이었다. 메일 초안 지시(4000)와 같은 값,
    // ai-agent 검증도 같다. selection 은 페이지 본문 상한(WP-625)을 따르므로 두지 않는다.
    @Size(max = 4000, message = "지시문은 4000자 이하로 입력해 주세요") String prompt,
    String selection) {}
