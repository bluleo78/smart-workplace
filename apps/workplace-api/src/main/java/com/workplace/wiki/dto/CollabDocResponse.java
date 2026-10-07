package com.workplace.wiki.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 동기화 서버 문서 로드 응답(WP-286).
 *
 * @param state Yjs 문서 상태(base64). 아직 동시 편집으로 저장된 적 없는 페이지면 null → 키 생략
 * @param body 현재 마크다운 본문(wiki_page.body)
 * @param version 현재 wiki_page.version
 * @param bodyVersion state 로부터 파생 저장된 body 의 version. null(키 생략)이면 state 없음. version 보다 작으면 collab
 *     밖에서 body 가 바뀐 것이라 동기화 서버가 body 기준으로 문서를 다시 맞춘다
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record CollabDocResponse(String state, String body, int version, Integer bodyVersion) {}
