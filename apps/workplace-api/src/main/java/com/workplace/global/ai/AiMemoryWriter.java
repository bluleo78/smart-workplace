package com.workplace.global.ai;

import java.util.Optional;

/**
 * 홈 AI 비서 밖의 진입점(메일 분류 교정 학습, WP-1341)이 사용자 메모리를 쓰는 SPI. 구현은 home 모듈에 있다 — {@link AiMemoryReader} 와
 * 같은 뒤집은 의존이다(home 이 이미 mail 을 import 하므로 mail 이 home 을 import 하면 패키지 순환이 생긴다).
 *
 * <p>메모리는 부가 기능이라 꺼짐·가득 참(409)·없음(404)·검증 실패는 예외 대신 {@link Optional#empty()} 로 돌려준다 — 호출자는 "기억하지
 * 않음"으로 처리한다. 쓰기는 AI 대행(internal) 규칙(꺼짐이면 거절, 출처 AI)을 따른다. 쓰기 트랜잭션은 구현이 연다 — 호출자는 트랜잭션 밖에서 부른다(실패가
 * 바깥 트랜잭션을 rollback-only 로 만들지 않게).
 */
public interface AiMemoryWriter {

  /** 사용자가 AI 기억을 켜 두었는지(설정 › AI 기억). */
  boolean enabled(long userId);

  /** 메일 범위(scope MAIL)·종류 선호(PREFERENCE)·출처 AI 로 새 기억 한 줄을 만든다. */
  Optional<Saved> createMailRule(long userId, String content);

  /** 내 기억 한 줄의 문장만 고친다(범위·종류·기한은 그대로). previousContent 에 고치기 전 문장을 싣는다. */
  Optional<Saved> updateContent(long userId, long memoryId, String content);

  /**
   * 저장한 기억.
   *
   * @param previousContent 고치기 전 문장(새로 만들었으면 null) — 웹 [기억 취소]가 되돌릴 값
   */
  record Saved(long id, String content, String previousContent) {}
}
