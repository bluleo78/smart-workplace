package com.workplace.home.service;

import com.workplace.global.util.TokenEstimates;
import java.util.List;

/**
 * 메인 AI 채팅 맥락 구성 정책(WP-232) — 스프링 의존 없는 순수 함수. 원문 이력 중 어디까지를 남기고 어디부터를 요약에 합칠지 정한다.
 *
 * <p>꼬리 불변식: 마지막 ASSISTANT 메시지와 그 이후 행(확인카드 결과 ACTION_* 포함)은 항상 원문으로 남긴다 — ai-agent 의 미확인 승인 결과
 * 재강조(#849)가 원문 안의 마지막 ASSISTANT 위치에 의존하기 때문.
 */
public final class HomeContextPolicy {

  /** 메시지 1건당 라벨·개행 오버헤드 근사. */
  static final int MESSAGE_OVERHEAD = 4;

  private HomeContextPolicy() {}

  /** 맥락 후보 메시지(id 는 요약 경계 저장용). */
  public record Msg(long id, String role, String content) {}

  /** 메시지 1건의 근사 비용. */
  public static int cost(Msg m) {
    return TokenEstimates.estimate(m.content()) + MESSAGE_OVERHEAD;
  }

  /** 요약 + 원문 전체의 근사 비용. */
  public static int total(String summary, List<Msg> raw) {
    int sum = TokenEstimates.estimate(summary);
    for (Msg m : raw) sum += cost(m);
    return sum;
  }

  /** 꼬리 시작 인덱스 — 마지막 ASSISTANT 위치. 없으면 raw.size()(보호 구간 없음). */
  static int tailStart(List<Msg> raw) {
    for (int i = raw.size() - 1; i >= 0; i--) {
      if ("ASSISTANT".equals(raw.get(i).role())) return i;
    }
    return raw.size();
  }

  /** 요약 경계: 최신부터 거꾸로 누적해 target 이내로 남기고, 앞 [0, 반환값) 을 요약 대상으로 돌린다. 꼬리 구간은 target 을 넘어도 항상 남긴다. */
  public static int boundary(List<Msg> raw, int target) {
    int tail = tailStart(raw);
    int kept = 0;
    int i = raw.size();
    while (i > 0) {
      int c = cost(raw.get(i - 1));
      if (i - 1 < tail && kept + c > target) break;
      kept += c;
      i--;
    }
    return i;
  }

  /** 요약 실패 폴백: 요약 포함 예산에 맞을 때까지 오래된 원문부터 버린 나머지(꼬리는 유지). */
  public static List<Msg> dropOldestToFit(String summary, List<Msg> raw, int budget) {
    int b = boundary(raw, budget - TokenEstimates.estimate(summary));
    return raw.subList(b, raw.size());
  }

  /** 본문이 cap 을 넘으면 앞부분만 남기고 생략 표식을 붙인다. */
  public static Msg capContent(Msg m, int cap) {
    String c = TokenEstimates.truncate(m.content(), cap);
    return c == m.content() ? m : new Msg(m.id(), m.role(), c);
  }
}
