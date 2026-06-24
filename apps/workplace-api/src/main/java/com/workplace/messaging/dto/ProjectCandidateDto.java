package com.workplace.messaging.dto;

/** L3 위임 시 이슈를 만들 수 있는 후보 프로젝트(카드 드롭다운·AI 추측 소스). key=프로젝트 키, name=표시명. */
public record ProjectCandidateDto(String key, String name) {}
