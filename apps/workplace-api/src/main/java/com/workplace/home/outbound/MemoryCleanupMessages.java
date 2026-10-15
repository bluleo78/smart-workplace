package com.workplace.home.outbound;

import com.workplace.global.ai.MemoryTextNormalizer;
import java.util.List;
import java.util.Objects;

/**
 * ai-agent POST /home/memory-cleanup 계약(WP-385 스펙 5.3) — 이름은 ai-agent run-memory-cleanup.ts 의 zod
 * 스키마와 같다. 날짜는 yyyy-MM-dd 문자열이다(AiMemoryLine 과 같은 이유 — 클라이언트 ObjectMapper 가 java.time 모듈을 모를 수 있다).
 * null 필드는 그대로 null 로 나가고 ai-agent 가 nullish 로 받는다.
 */
public final class MemoryCleanupMessages {

  /**
   * 요청 배열 상한 — ai-agent run-memory-cleanup.ts 의 zod 상한(utterances·assistantNotes .max(500))과 같은
   * 값이다. 넘겨 보내면 400 이 세 번 나 그 대화 정리를 잃는다.
   */
  public static final int LIST_MAX = 500;

  private MemoryCleanupMessages() {}

  /**
   * 정리 요청.
   *
   * @param model 비서의 추천 모델(null = ai-agent 가 비서 연결 모델을 쓴다)
   * @param utterances 사용자 발화(시간순) — 인덱스가 op 의 evidence 다. 배열로 보내 발화 안의 글자가 번호를 흉내 내지 못하게 한다
   * @param assistantNotes AI 답 앞 300자(참고만, 근거로 쓰지 않음) — after 는 바로 앞 사용자 발화 인덱스
   * @param memories 비교 대상 메모리(최대 30) — 사용자 저장분·고정분도 보이되 서버가 대상에서 거른다
   */
  public record Request(
      long agentId,
      String model,
      int timeoutMs,
      String today,
      List<String> utterances,
      List<AssistantNote> assistantNotes,
      List<MemoryRef> memories) {}

  /** AI 답 한 줄(참고). */
  public record AssistantNote(int after, String text) {}

  /**
   * 비교 대상 메모리 한 줄. scope null = 공통, expiresOn null = 기한 없음.
   *
   * @param undone 사용자가 이 대화의 결과 줄에서 되돌린 메모리 — ai-agent 가 「바꾸지 말 것」을 붙인다(서버도 대상에서 거른다). 구 ai-agent 는
   *     모르는 필드라 무시한다
   */
  public record MemoryRef(
      long id,
      String kind,
      String content,
      String scope,
      String expiresOn,
      String source,
      boolean pinned,
      boolean undone) {}

  /**
   * 정리 응답 — 할 일이 없거나 모델 출력이 깨졌으면 빈 목록. 받은 ops 는 여기서 한 번 거른다(Jackson 도 이 생성자를 거친다): null op·이름 없는
   * op·대상 id 에 null 이 섞인 op 는 그 op 만 버린다 — 적용기·결과 임베딩이 각자 null 을 가리지 않게. null 목록은 빈 목록.
   */
  public record Result(List<Op> ops) {
    public Result {
      ops =
          ops == null
              ? List.of()
              : ops.stream()
                  .filter(
                      o ->
                          o != null
                              && o.op() != null
                              && (o.targetIds() == null
                                  || o.targetIds().stream().allMatch(Objects::nonNull)))
                  .toList();
    }
  }

  /**
   * 모델이 낸 op 하나(서버가 모두 다시 검증한다). UPDATE·MERGE 의 kind·scope·expiresOn 은 ai-agent 가 첫 대상 값으로 채워 보낸다 —
   * 여기서는 받은 값이 그대로다(scope null = 공통, expiresOn null = 기한 없음).
   *
   * <p>content 의 제어 문자(NUL 등)는 만들 때 한 번 지운다 — 결과 임베딩의 키({@link #resultText})와 저장할 문장이 같은 정리된 문장이
   * 되게.
   *
   * @param op ADD·UPDATE·MERGE·FORGET
   * @param targetIds UPDATE·FORGET 1개, MERGE 2개 이상, ADD 없음
   * @param evidence 근거 사용자 발화 인덱스(0부터)
   */
  public record Op(
      String op,
      List<Long> targetIds,
      String content,
      String kind,
      String scope,
      String expiresOn,
      Integer evidence,
      String reason) {

    public Op {
      content = MemoryTextNormalizer.stripControl(content);
    }

    /** 결과 문장(앞뒤 공백 제거, 없으면 null) — 결과 임베딩 맵의 키이자 저장할 내용의 원문. */
    public String resultText() {
      return content == null ? null : content.strip();
    }
  }
}
