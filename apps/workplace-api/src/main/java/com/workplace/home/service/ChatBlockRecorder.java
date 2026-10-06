package com.workplace.home.service;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * WP-158: AI 응답 스트림의 표시 블록 순서(텍스트·도구 그룹·위젯)를 도착순으로 기록한다.
 *
 * <p>웹 useChatSession 의 라이브 누적 규칙(chatBlocks.ts 의 pushTextBlock/pushToolsBlock/pushWidgetBlock)과 같은
 * 규칙으로 블록을 쌓아 home_message.content_blocks 로 영속한다 — 세션 복원 시 스트리밍 때와 같은 순서로 풍선을 재현하기 위함. 규칙을 바꾸면 웹 쪽도
 * 함께 바꾼다.
 *
 * <ul>
 *   <li>text: 직전 블록이 text 가 아닐 때만 새 블록. textStart 는 그 시점까지 누적된 delta 문자 수.
 *   <li>tools: 직전 블록이 tools 가 아닐 때만 새 블록. stepStart 는 영속 steps(tool_calls) 인덱스.
 *   <li>widget: show_* 도구마다 1블록(웹 WidgetSpec 과 같은 {type, params, layout?}).
 * </ul>
 *
 * <p>펌프 스레드에서 쓰고 done 핸들러에서 읽으므로 메서드를 동기화한다(호출 빈도가 낮아 경합 비용 무시 가능).
 */
class ChatBlockRecorder {

  /**
   * 영속 블록 — JSON 은 웹 ContentBlock 과 같은 {kind, ...} 형태로 직렬화된다. kind 는 각 record 가 직접 내보낸다(목록을
   * List&lt;?&gt; 로 직렬화하면 Jackson 다형 타입 정보가 붙지 않으므로 @JsonTypeInfo 대신 명시 프로퍼티를 쓴다).
   */
  @JsonPropertyOrder("kind")
  sealed interface Block permits Text, Tools, Widget {
    @JsonProperty("kind")
    String kind();
  }

  /** 텍스트 구간 시작(content 문자 오프셋). */
  record Text(int textStart) implements Block {
    @Override
    public String kind() {
      return "text";
    }
  }

  /** 연속 도구/위임 단계 그룹 시작(steps 인덱스). */
  record Tools(int stepStart) implements Block {
    @Override
    public String kind() {
      return "tools";
    }
  }

  /** 위젯 1개(웹 WidgetSpec). */
  record Widget(Map<String, Object> widget) implements Block {
    @Override
    public String kind() {
      return "widget";
    }
  }

  private final List<Block> blocks = new ArrayList<>();
  private final StringBuilder streamed = new StringBuilder();

  /** 텍스트 delta 도착. */
  synchronized void onDelta(String delta) {
    if (!(last() instanceof Text)) blocks.add(new Text(streamed.length()));
    streamed.append(delta);
  }

  /**
   * 영속 대상 단계(위임·표시 가능 도구)가 steps 에 추가되기 직전에 호출한다.
   *
   * @param stepIndex 추가될 단계의 steps 인덱스(= 추가 전 steps 크기)
   */
  synchronized void onStep(int stepIndex) {
    if (!(last() instanceof Tools)) blocks.add(new Tools(stepIndex));
  }

  /** show_* 위젯 도구 시작. widget 은 웹 WidgetSpec 과 같은 형태({type, params, layout?}). */
  synchronized void onWidget(Map<String, Object> widget) {
    blocks.add(new Widget(widget));
  }

  /**
   * 영속할 블록 목록. 저장 본문(fullText)과 스트리밍 텍스트를 맞춰 textStart 를 본문 기준으로 보정한다.
   *
   * <p>ai-agent 는 최종 답도 delta 로 내보내므로 스트리밍 텍스트 = (위임 전 라우터 안내 문장) + fullText 이다(run-ai-chat.ts 의 답
   * 결정 우선순위). 위임 답이면 앞의 안내 문장은 본문에 저장되지 않으므로, 그 길이만큼 textStart 를 당기고 안내 문장에만 해당하던 text 블록은 버린다. 이
   * 관계가 깨지면 오프셋을 신뢰할 수 없어 null(웹 폴백 렌더)을 돌려준다 — 텍스트를 엉뚱한 곳에서 자르는 것보다 기존 표시가 낫다.
   *
   * @return 영속할 블록(없으면 null)
   */
  synchronized List<Block> finish(String fullText) {
    String content = fullText == null ? "" : fullText;
    if (!streamed.toString().endsWith(content)) return null;
    int prefix = streamed.length() - content.length();
    List<Block> out = new ArrayList<>();
    for (int i = 0; i < blocks.size(); i++) {
      Block b = blocks.get(i);
      if (b instanceof Text t) {
        // 이 text 블록의 끝 = 다음 text 블록 시작(없으면 스트리밍 끝). 안내 문장 구간에 다 들어가면 버린다.
        if (textEnd(i) <= prefix) continue;
        b = new Text(Math.max(0, t.textStart() - prefix));
      }
      // text 블록을 버려 tools 가 연속되면 앞 그룹으로 합친다(앞 그룹 범위가 다음 tools 시작까지 늘어나 단계 유실 없음).
      if (b instanceof Tools && !out.isEmpty() && out.get(out.size() - 1) instanceof Tools)
        continue;
      out.add(b);
    }
    return out.isEmpty() ? null : out;
  }

  /** 지금까지 스트리밍된 텍스트 전체(WP-190) — 정지·오류로 끝난 턴의 부분 답변 본문. */
  synchronized String streamedText() {
    return streamed.toString();
  }

  /** i 번째 text 블록의 끝 오프셋 — 다음 text 블록의 시작, 없으면 스트리밍 끝. */
  private int textEnd(int i) {
    for (int j = i + 1; j < blocks.size(); j++) {
      if (blocks.get(j) instanceof Text t) return t.textStart();
    }
    return streamed.length();
  }

  private Block last() {
    return blocks.isEmpty() ? null : blocks.get(blocks.size() - 1);
  }
}
