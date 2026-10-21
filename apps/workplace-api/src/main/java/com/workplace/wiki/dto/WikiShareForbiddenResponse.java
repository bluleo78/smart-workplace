package com.workplace.wiki.dto;

/**
 * 지정한 사람(PEOPLE) 공유 링크를 지정되지 않은 사람이 열 때의 403 응답(WP-579). 링크 자체는 유효해 이 응답이면 언제나 접근 요청을 보낼 수 있다. 표준
 * 오류 응답 필드에 받는 화면이 버튼을 고를 값을 더한다.
 *
 * @param requested 이미 보낸 대기 중 요청이 있다 — 버튼을 「요청함」으로
 * @param denied 같은 공유에 24시간 안에 요청이 거절됐다 — 「거절됨」으로(다시 요청해도 새 요청을 만들지 않는다)
 */
public record WikiShareForbiddenResponse(
    int status,
    String error,
    String message,
    String timestamp,
    String path,
    boolean requested,
    boolean denied) {}
