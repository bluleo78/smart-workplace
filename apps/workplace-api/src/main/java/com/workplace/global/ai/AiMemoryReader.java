package com.workplace.global.ai;

import java.util.List;

/**
 * 홈 AI 비서 밖의 AI 진입점(노트 작성·메일 초안·드라이브 개요·채널 따라잡기)이 사용자 메모리를 읽는 SPI(WP-381). 구현은 home 모듈에 있다 — home 이
 * 이미 mail·messaging 을 import 하므로(PriorityClassificationScheduler) 반대로 그 모듈들이 home 을 import 하면 패키지
 * 순환이 생긴다. global/realtime/AudienceResolver 와 같은 뒤집은 의존이다.
 *
 * <p>읽기 전용 — 저장 도구는 홈 AI 비서에만 있다. 메모리는 부가 기능이라 꺼짐·조회 실패면 빈 목록을 돌려주고 예외를 던지지 않는다(기능은 메모리 없이 그대로 동작).
 */
public interface AiMemoryReader {

  /** 노트 AI 작성. */
  String WIKI = "WIKI";

  /** 메일 답장 초안·초안 코칭·메일 → 이슈 초안. */
  String MAIL = "MAIL";

  /** 드라이브 개요. */
  String DRIVE = "DRIVE";

  /** 채널 따라잡기 요약. */
  String MESSAGING = "MESSAGING";

  /**
   * 공통 + app 범위의 유효(만료 안 된) 메모리 중 관련 있는 것 — 홈 채팅과 같은 선택 규칙(30줄 이하면 전부, 많으면 고정 + 순위 상위 20, 토큰 예산,
   * WP-383). 꺼짐·조회 실패면 빈 목록. "더 있음" 수는 돌려주지 않는다(진입점에 검색 도구가 없다).
   *
   * <p>늘 <b>새</b> 읽기 전용 트랜잭션(REQUIRES_NEW)에서 읽는다 — 바깥 트랜잭션에 참여한 채 조회가 실패하면 바깥이 rollback-only 가 되고,
   * 리더는 예외를 삼키므로 바깥 커밋이 UnexpectedRollbackException 으로 기능 전체를 실패시킨다. 그 대가로 바깥 트랜잭션 안에서 부르면 바깥 커넥션을
   * 쥔 채 하나를 더 잡으므로(풀이 포화되면 요청끼리 서로를 기다릴 수 있다) 호출자는 가능하면 트랜잭션 밖에서 부른다 — 지금 호출자는 모두 그렇다(메일 초안·코칭·이슈
   * 초안·채널 따라잡기는 읽기 트랜잭션을 끝낸 뒤, 노트 작성은 펌프 스레드, 드라이브 개요는 트랜잭션 없는 요청 스레드). 질의 임베딩(최대 1.5초)도 트랜잭션 밖에서
   * 기다린다.
   *
   * @param queryText 관련도를 매길 텍스트(노트 = 지시문, 메일 = 제목 + 요약 앞부분, 메일→이슈 = 제목) — null 이면 고정 + 최신
   */
  List<AiMemoryLine> readForEntry(long userId, String app, String queryText);
}
