package com.workplace.wiki.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 인에디터 /ai 스트리밍 요청 본문. 페이지 본문·제목은 서버가 DB 에서 채우므로 클라이언트는 액션과 선택/지시문만 보낸다.
 *
 * @param action 수행 액션(요약·초안·이어쓰기). 소문자 와이어로 바인딩.
 * @param prompt draft 액션의 지시문(선택)
 * @param selection 요약 대상 선택 영역(선택)
 */
public record WikiAiRequest(@NotNull WikiAiAction action, String prompt, String selection) {}
