package com.workplace.wiki.dto;

/**
 * 프로젝트 노트 공간 요약(WP-1480) — 프로젝트 화면의 노트 탭·설정이 「이 프로젝트의 노트 공간」을 찾을 때 쓴다.
 *
 * @param id 노트 공간 id
 * @param name 공간 이름
 * @param projectKey 이어진 프로젝트 key
 */
public record WikiProjectSpaceResponse(long id, String name, String projectKey) {}
