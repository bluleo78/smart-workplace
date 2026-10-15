package com.workplace.home.dto;

/**
 * 직접 추가(spaceType·spaceId·content)·고치기(content 만) 요청. 형식 검증은 서비스가 400 SHARED_MEMORY_INVALID 로 한다.
 */
public record SaveSharedAiMemoryRequest(String spaceType, Long spaceId, String content) {}
