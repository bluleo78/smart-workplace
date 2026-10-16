package com.workplace.home.outbound;

import java.util.List;

/**
 * ai-agent 공용 메모리 검사·추출 계약(WP-386 스펙 6.3·6.4) — 필드 이름은 ai-agent run-shared-memory.ts 의 zod 와 같다. 검사
 * 요청은 후보 문장과 공간 종류·이름뿐이고(원래 대화·사람 식별자 없음), 추출 요청도 발화 문장만 싣는다(누가 말했는지·세션·메시지 id 없음).
 */
public final class SharedMemoryMessages {

  private SharedMemoryMessages() {}

  /** 공용성 검사 요청 — candidates 최대 10. */
  public record CheckRequest(
      long agentId,
      String model,
      int timeoutMs,
      String spaceType,
      String spaceName,
      List<String> candidates) {}

  /** 후보 하나의 판정. */
  public record Verdict(boolean teamWide, boolean personal, String reason) {

    /** teamWide 이고 personal 이 아닐 때만 통과(스펙 6.4). */
    public boolean passed() {
      return teamWide && !personal;
    }
  }

  /** 검사 결과 — 후보 순서와 같은 순서. */
  public record CheckResult(List<Verdict> results) {

    /** index 번째 후보가 통과했는가 — 결과가 없거나 개수가 후보와 다르면(형식이 깨짐) 모두 불통과. */
    public boolean passed(int index, int candidateCount) {
      return results != null
          && results.size() == candidateCount
          && index >= 0
          && index < results.size()
          && results.get(index) != null
          && results.get(index).passed();
    }
  }

  /** 비교 대상 공용 메모리(그 공간 전체, 최대 50). */
  public record MemoryRef(long id, String content, String origin) {}

  /** 추출 요청 — utterances 는 그 공간 화면에서 한 사용자 발화만(시간순, 인덱스가 evidence). */
  public record ExtractRequest(
      long agentId,
      String model,
      int timeoutMs,
      String today,
      String spaceType,
      String spaceName,
      List<String> utterances,
      List<MemoryRef> memories) {}

  /** 추출 결과. */
  public record ExtractResult(List<Op> ops) {}

  /** op 하나 — ADD·UPDATE·MERGE·FORGET. */
  public record Op(
      String op, List<Long> targetIds, String content, Integer evidence, String reason) {

    /** 결과 문장(앞뒤 공백 제거, 없으면 null). */
    public String resultText() {
      return content == null ? null : content.strip();
    }
  }
}
