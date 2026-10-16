package com.workplace.global.ai;

/**
 * 대화에 싣는 공용 메모리 한 줄(WP-386) — space 는 라벨(「조직」·「이름(키)」·스페이스 이름), content 는 내용. ai-agent 가 `- [space]
 * content` 로 그린다.
 */
public record SharedMemoryLine(String space, String content) {}
