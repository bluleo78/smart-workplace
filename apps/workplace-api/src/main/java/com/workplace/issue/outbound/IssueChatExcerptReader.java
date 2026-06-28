package com.workplace.issue.outbound;

import com.workplace.issue.outbound.dto.ChatExcerpt;
import java.util.List;

/**
 * 이슈 채팅 메시지를 AI 요약 입력으로 읽는 포트. issue→chat 직접 의존(순환)을 피하기 위해 issue 모듈이 인터페이스를 소유하고 chat 모듈이
 * 구현한다(chat→issue 는 기존 의존).
 */
public interface IssueChatExcerptReader {
  /** 이슈의 채팅 스레드 최근 메시지(시간 오름차순, 삭제 제외). 스레드 없으면 빈 리스트. */
  List<ChatExcerpt> recentForIssue(long issueId, int limit);
}
