package com.workplace.home.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

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
 *   <li>memory: 메모리 도구 결과 줄(WP-55) — 도착순으로 따로 모아 finish 결과 끝에 붙인다(판정 4·5).
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
  sealed interface Block permits Text, Tools, Widget, Memory {
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

  /**
   * 메모리 결과 줄 1개(WP-55) — 웹 MemoryBlock. 블록 판별자 kind 와 겹치지 않게 메모리 종류는 memoryKind(판정 6). undone 은
   * 되돌리기가 같은 트랜잭션에서 true 로 바꾼다(AiMemoryUndoService — 레코드가 아니라 JSON 트리로 고친다). previousKind 는 updated
   * 의 고치기 전 종류 — 있으면 되돌리기가 종류도 돌려놓는다(없으면 JSON 에서 빠지고 지금 종류를 유지한다).
   *
   * <p>WP-379: scope(결과의 범위)·previousScope(updated 의 이전 범위)는 앱 범위일 때만 남는다 — null 은 공통이라 JSON 에서
   * 빠지고, 필드가 없는 구 블록과 같은 해석이 된다(판정 6).
   */
  record Memory(
      String action,
      long memoryId,
      String memoryKind,
      String content,
      @JsonInclude(JsonInclude.Include.NON_NULL) String previousContent,
      @JsonInclude(JsonInclude.Include.NON_NULL) String previousKind,
      String source,
      boolean undone,
      @JsonInclude(JsonInclude.Include.NON_NULL) String scope,
      @JsonInclude(JsonInclude.Include.NON_NULL) String previousScope)
      implements Block {
    private static final Set<String> ACTIONS = Set.of("saved", "updated", "forgotten");

    @Override
    public String kind() {
      return "memory";
    }

    /**
     * tool 이벤트의 memory 필드 → 블록. 모양이 틀리면 null(결과 줄을 만들지 않는다). updated 는 되돌릴 이전 내용(공백만은 안 됨)이 있어야 하고,
     * source 가 없으면 AI(판정 7). previousKind 는 updated 이고 알려진 종류일 때만 남긴다(모르는 값은 버리고 줄은 만든다). 범위는
     * 없거나(공통) 앱 6개 중 하나여야 한다 — 모르는 범위면 되돌리기가 엉뚱한 범위로 복원하므로 줄을 만들지 않는다.
     */
    static Memory from(JsonNode m) {
      if (m == null || !m.isObject()) return null;
      String action = m.path("action").asText("");
      String kind = m.path("kind").asText("");
      String content = m.path("content").asText("");
      JsonNode id = m.path("memoryId");
      JsonNode prev = m.path("previousContent");
      if (!ACTIONS.contains(action) || !AiMemoryService.KINDS.contains(kind) || content.isBlank())
        return null;
      if (!id.isIntegralNumber() || !id.canConvertToLong() || id.asLong() <= 0) return null;
      // 빈 이전 내용은 되돌릴 수 없다(복원이 1~300자 검증에 걸린다) — 되돌리기 버튼만 남는 줄을 만들지 않는다.
      if ("updated".equals(action) && (!prev.isTextual() || prev.asText().isBlank())) return null;
      if (!isScopeOrAbsent(m.path("scope")) || !isScopeOrAbsent(m.path("previousScope")))
        return null;
      String source =
          AiMemoryService.SOURCE_USER.equals(m.path("source").asText())
              ? AiMemoryService.SOURCE_USER
              : AiMemoryService.SOURCE_AI;
      String prevKind = m.path("previousKind").asText("");
      return new Memory(
          action,
          id.asLong(),
          kind,
          content,
          prev.isTextual() ? prev.asText() : null,
          "updated".equals(action) && AiMemoryService.KINDS.contains(prevKind) ? prevKind : null,
          source,
          false,
          textOrNull(m.path("scope")),
          "updated".equals(action) ? textOrNull(m.path("previousScope")) : null);
    }

    /** 범위 값이 없거나(키 없음·null = 공통) 앱 6개 중 하나인가. */
    private static boolean isScopeOrAbsent(JsonNode n) {
      return n.isMissingNode() || n.isNull() || (n.isTextual() && AiMemoryScope.isApp(n.asText()));
    }

    private static String textOrNull(JsonNode n) {
      return n.isTextual() ? n.asText() : null;
    }
  }

  private final List<Block> blocks = new ArrayList<>();
  private final StringBuilder streamed = new StringBuilder();
  private final List<Memory> memories = new ArrayList<>();

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

  /** 메모리 도구 결과 줄(WP-55) — 표시 블록과 따로 모은다(위임 답 보정·오프셋 불일치에도 버려지지 않게, 판정 5). */
  synchronized void onMemory(Memory memory) {
    memories.add(memory);
  }

  /** 메모리 결과 줄이 하나라도 있는가 — 텍스트 없이 끝난 턴도 결과 줄 때문에 저장할지 가른다(WP-55). */
  synchronized boolean hasMemory() {
    return !memories.isEmpty();
  }

  /**
   * 영속할 블록 목록 — 표시 블록(displayBlocks) 뒤에 메모리 블록을 도착순으로 붙인다. 표시 블록을 신뢰할 수 없어 null 이어도 메모리 블록은 돌려준다 —
   * 되돌리기의 순번(blockIndex)이 이 목록의 memory 순번이다(판정 4·5).
   *
   * @return 영속할 블록(없으면 null)
   */
  synchronized List<Block> finish(String fullText) {
    List<Block> display = displayBlocks(fullText);
    if (memories.isEmpty()) return display;
    List<Block> out = display == null ? new ArrayList<>() : new ArrayList<>(display);
    out.addAll(memories);
    return out;
  }

  /**
   * 표시 블록 목록. 저장 본문(fullText)과 스트리밍 텍스트를 맞춰 textStart 를 본문 기준으로 보정한다.
   *
   * <p>ai-agent 는 최종 답도 delta 로 내보내므로 스트리밍 텍스트 = (위임 전 라우터 안내 문장) + fullText 이다(run-ai-chat.ts 의 답
   * 결정 우선순위). 위임 답이면 앞의 안내 문장은 본문에 저장되지 않으므로, 그 길이만큼 textStart 를 당기고 안내 문장에만 해당하던 text 블록은 버린다. 이
   * 관계가 깨지면 오프셋을 신뢰할 수 없어 null(웹 폴백 렌더)을 돌려준다 — 텍스트를 엉뚱한 곳에서 자르는 것보다 기존 표시가 낫다.
   *
   * @return 영속할 블록(없으면 null)
   */
  private List<Block> displayBlocks(String fullText) {
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
