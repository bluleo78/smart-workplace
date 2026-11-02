package com.workplace.issue.dto;

import java.util.Map;

/**
 * 반복 작업의 테스트 실행(「지금 실행」, WP-1313)이 실행하지 않고 멈춘 되돌릴 수 없는 쓰기 하나 — 메일 보내기·일정 만들기 같은 도구 호출이다.
 *
 * <p>ai-agent 가 도구 래퍼에서 기록해(모델이 쓴 글이 아니다) 결과 보고로 보내면, API 는 테스트 질문과 함께 그대로 보관했다가 사람이 답하면 이어 처리 이벤트에
 * 「허락된 쓰기」로 돌려준다. 이어 처리는 이 목록의 도구만(하나당 한 번) 실제로 실행할 수 있다. API 는 내용을 해석하지 않는다.
 *
 * @param tool 도구 이름(예: send_mail)
 * @param args 모델이 넘긴 인자 — 이어 처리 지시문이 같은 쓰기를 다시 하도록 보여 준다. 너무 크면 API 가 빼고 보관한다
 */
public record RecurringPausedAction(String tool, Map<String, Object> args) {}
