package com.workplace.home.service;

import com.workplace.auth.service.AssistantSpec;
import com.workplace.home.repository.AiMemoryRepository.Row;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 한 세션의 배경 정리 입력(WP-385 스펙 5.2) — 개인 정리와 WP-386 공용 추출(SessionCleanupParticipant)이 같은 값을 받는다.
 *
 * @param processedId 수집 때의 경계(NULL = 처음) — 적용 트랜잭션이 이 값일 때만 경계를 올린다
 * @param uptoId 수집 때의 마지막 메시지 id — 적용이 경계를 이 값으로 올린다(정리 중 온 메시지는 다음 회차)
 * @param utterances 사용자 발화(시간순, 각 4,000자·합계 16,000자) — 인덱스가 op 의 evidence 다. messageId 로
 *     home_message 의 다른 열(WP-386 의 space_type·space_id)을 찾을 수 있다
 * @param assistantNotes AI 답 앞 300자(참고만) — after 는 바로 앞 발화 인덱스
 * @param memories 개인 정리의 비교 대상(최대 30, 수집 때의 행 — updated_at 동등 비교로 적용 시점 변경을 가른다)
 * @param spec 이 사용자의 비서(개인 → 공용) — 모델·자격 증명
 * @param today 오늘(Asia/Seoul)
 * @param lastMessageAt 구간 마지막 메시지(uptoId)의 created_at(DB 시각) — 그 뒤에 다른 경로(설정·다른 대화)에서 고친 메모리는 이 대화가
 *     근거가 될 수 없어 개인 정리 대상에서 뺀다
 * @param protectedIds 사용자가 이 구간 채팅 결과 줄에서 되돌린 메모리 id — 개인 정리가 다시 고치거나 지우지 않는다(프롬프트에도 「바꾸지 말 것」으로
 *     싣는다)
 */
public record SessionCleanupInput(
    long tenantId,
    long userId,
    UUID sessionId,
    Long processedId,
    long uptoId,
    List<Utterance> utterances,
    List<AssistantNote> assistantNotes,
    List<Row> memories,
    AssistantSpec spec,
    LocalDate today,
    Instant lastMessageAt,
    Set<Long> protectedIds) {

  /** 불변 사본으로 둔다(null 이면 빈 집합). */
  public SessionCleanupInput {
    protectedIds = protectedIds == null ? Set.of() : Set.copyOf(protectedIds);
  }

  /** 사용자 발화 한 줄. */
  public record Utterance(long messageId, String text) {}

  /** AI 답 한 줄(참고, 근거로 쓰지 않음). */
  public record AssistantNote(int after, String text) {}
}
