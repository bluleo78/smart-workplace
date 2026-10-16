package com.workplace.global.ai;

/**
 * 진입점이 대화에 실을 공용 메모리를 읽는 계약(WP-386 스펙 5.1) — 노트·메일·드라이브·채널·이슈 이벤트 모듈이 home 에 의존하지 않게 global 에 둔다.
 * 구현은 늘 새 읽기 전용 트랜잭션에서 읽고 실패하면 빈 묶음을 돌려준다(공용 메모리 때문에 본 기능을 막지 않는다). 「메모리 사용」 스위치와 무관하다.
 */
public interface SharedAiMemoryReader {

  /** 조직 + 그 공간(사용자가 읽을 수 있을 때만). spaceType 이 null 이면 조직만. */
  SharedMemories readForUser(long userId, String spaceType, Long spaceId);

  /** 이슈 AI 담당자·이슈 채팅 — 조직 + 그 프로젝트(TEAM·OPEN 이고 대행 에이전트가 읽을 수 있을 때만). */
  SharedMemories readForProjectAgent(String projectKey, long agentUserId);
}
