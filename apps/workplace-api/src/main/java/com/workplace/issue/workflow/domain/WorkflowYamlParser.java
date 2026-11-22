package com.workplace.issue.workflow.domain;

import com.workplace.issue.workflow.dto.WorkflowProblem;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.composer.Composer;
import org.yaml.snakeyaml.error.Mark;
import org.yaml.snakeyaml.error.MarkedYAMLException;
import org.yaml.snakeyaml.error.YAMLException;
import org.yaml.snakeyaml.events.AliasEvent;
import org.yaml.snakeyaml.events.CollectionStartEvent;
import org.yaml.snakeyaml.events.DocumentStartEvent;
import org.yaml.snakeyaml.events.Event;
import org.yaml.snakeyaml.events.NodeEvent;
import org.yaml.snakeyaml.events.ScalarEvent;
import org.yaml.snakeyaml.nodes.MappingNode;
import org.yaml.snakeyaml.nodes.Node;
import org.yaml.snakeyaml.nodes.NodeId;
import org.yaml.snakeyaml.nodes.ScalarNode;
import org.yaml.snakeyaml.nodes.Tag;
import org.yaml.snakeyaml.parser.ParserImpl;
import org.yaml.snakeyaml.reader.ReaderException;
import org.yaml.snakeyaml.reader.StreamReader;
import org.yaml.snakeyaml.resolver.Resolver;

/**
 * 워크플로우 YAML 파서: 글 → {@link ParseResult}(모델·문제·위치표).
 *
 * <p>왜: 문서는 신뢰할 수 없는 프로젝트 구성원이 쓴다. 그래서 객체 생성 없이 SnakeYAML {@code Composer} 로 Node 트리만 만들고, 크기를 먼저
 * 재고(256 KiB), 별칭 수와 중첩 깊이를 제한하며, 어떤 예외도 밖으로 던지지 않고 문제로 바꾼다. 흐름: 크기·BOM 처리 → 작성(Node 트리) →
 * 점검·위치표({@link YamlInspector}) → 스키마 형태 검사({@link SchemaChecker}) → 값 검사 → 모델 만들기({@link
 * WorkflowModelBuilder}). ERROR 가 있으면 model 은 null 이다.
 */
public final class WorkflowYamlParser {

  private static final Logger log = LoggerFactory.getLogger(WorkflowYamlParser.class);

  /** YAML 상한(UTF-8 바이트). */
  static final int MAX_BYTES = 256 * 1024;

  /** 허용하는 컬렉션 중첩 단계(최상위 컬렉션이 1단계). */
  private static final int MAX_DEPTH = 50;

  /**
   * 작성기 자체의 안전 중첩 한도. 정식 상한(50)은 {@link #scanEvents} 가 정확히 판정하고, 이 값은 아주 깊은 문서가 작성 단계에서 재귀를 키우는 것만
   * 막는다(작성기는 마지막 빈 컬렉션 한 단계를 세지 않아 여유를 둔다).
   */
  private static final int COMPOSER_DEPTH_LIMIT = MAX_DEPTH + 5;

  /** 스키마 검사기(스키마는 불변이라 공유한다). */
  private static final SchemaChecker CHECKER = new SchemaChecker(WorkflowSchema.root());

  private WorkflowYamlParser() {}

  /** YAML 글을 읽는다. 어떤 입력에서도 예외를 던지지 않는다. */
  public static ParseResult parse(String yaml) {
    try {
      return doParse(yaml);
    } catch (RuntimeException | StackOverflowError e) {
      // 예상 밖 실패도 500 이 아니라 문제로 알린다(문서가 원인이거나 파서 결함 — 어느 쪽이든 모델은 없다).
      // 그러나 조용히 삼키면 결함이 안 보이므로 error 로 남긴다. 예외 문구에는 문서 조각이 들어갈 수 있어 종류와 스택만 싣는다.
      Throwable bare = new RuntimeException(e.getClass().getName());
      bare.setStackTrace(e.getStackTrace());
      log.error("워크플로우 YAML 파서 내부 오류(문서 내용은 기록하지 않음)", bare);
      return single("YAML_SYNTAX", "YAML 을 읽는 중 알 수 없는 문제가 생겼습니다. 문서를 확인해 주세요.");
    }
  }

  /**
   * 문서가 크기 상한(256 KiB, UTF-8 바이트)을 넘는지. {@link #parse} 와 같은 규칙이라 저장 API 가 400 을 낼 때도 이것을 쓴다. null 은
   * 크지 않다.
   */
  public static boolean isTooLarge(String yaml) {
    return yaml != null && (yaml.length() > MAX_BYTES || utf8Length(yaml) > MAX_BYTES);
  }

  /** 크기·BOM·줄 구분자를 거르고 작성·점검·스키마·값·모델 순으로 읽는다(예외는 {@link #parse} 가 문제로 바꾼다). */
  private static ParseResult doParse(String yaml) {
    if (yaml == null) {
      return single("YAML_EMPTY", "내용이 비어 있습니다.");
    }
    if (isTooLarge(yaml)) {
      return single("YAML_TOO_LARGE", "문서가 너무 큽니다(최대 256 KiB).");
    }
    // 맨 앞 BOM 은 내용이 아니다. 지워야 첫 줄의 열이 편집기와 같다.
    String text = yaml.startsWith("\uFEFF") ? yaml.substring(1) : yaml;

    ParseSession s = new ParseSession(text);
    if (rejectHiddenLineBreaks(text, s)) {
      return result(null, s);
    }
    Node root = compose(text, s);
    if (root == null) {
      return result(null, s);
    }

    new YamlInspector(s).inspect(root);
    CHECKER.check(root, WorkflowSchema.root(), List.of(), s::errorAt);
    WorkflowModelBuilder.checkValues(root, s);

    WorkflowModel model = null;
    if (!s.hasError() && root instanceof MappingNode map) {
      model = WorkflowModelBuilder.build(map, s);
    }
    return result(s.hasError() ? null : model, s);
  }

  /**
   * 편집기에는 줄 바꿈으로 보이지 않지만 YAML 은 줄 바꿈으로 읽는 U+0085·U+2028·U+2029 를 막는다. 막지 않으면 사람이 주석으로 보는 줄 뒤의 글이 실제
   * 값이 된다. 하나라도 있으면 true.
   */
  private static boolean rejectHiddenLineBreaks(String text, ParseSession s) {
    int[] index = {0};
    boolean[] found = {false};
    text.codePoints()
        .forEach(
            c -> {
              if (c == 0x85 || c == 0x2028 || c == 0x2029) {
                found[0] = true;
                s.error(
                    "YAML_INVALID_TEXT",
                    "편집기에서 줄 바꿈으로 보이지 않는 문자(U+0085, U+2028, U+2029)가 들어 있습니다. 지워 주세요.",
                    s.lines.at(index[0]),
                    null);
              }
              index[0]++;
            });
    return found[0];
  }

  /**
   * Node 트리를 만든다. 먼저 파서 이벤트만 훑어 별칭·앵커·태그·TAG 지시문·깊이 초과·둘 이상의 문서를 그 이벤트의 정확한 줄·열에서 막는다 — Node 를 하나도
   * 만들기 전에 멈추므로 별칭이나 TAG 접두사로 메모리·시간을 키울 수 없다. 통과한 문서만 Composer 로 트리를 만든다. 비었거나 읽기 실패면 문제를 세션에 담고
   * null.
   */
  private static Node compose(String text, ParseSession s) {
    LoaderOptions options = new LoaderOptions();
    options.setMaxAliasesForCollections(0);
    options.setNestingDepthLimit(COMPOSER_DEPTH_LIMIT);
    options.setAllowRecursiveKeys(false);
    try {
      if (!scanEvents(text, options, s)) {
        return null;
      }
      Composer composer =
          new Composer(
              new ParserImpl(new StreamReader(text), options), new TextResolver(), options);
      // checkNode 가 스트림 시작 이벤트를 먼저 소비해야 getNode 가 문서를 읽는다(훑기를 통과했으므로 문서는 하나다).
      composer.checkNode();
      Node root = composer.getNode();
      if (root instanceof ScalarNode scalar && YamlScalars.kind(scalar) == YamlScalars.Kind.NULL) {
        s.error("YAML_EMPTY", "내용이 비어 있습니다.", new SourceMap.Pos(1, 1), null);
        return null;
      }
      return root;
    } catch (ReaderException e) {
      s.error(
          "YAML_INVALID_TEXT", "읽을 수 없는 문자(제어 문자 등)가 들어 있습니다.", s.lines.at(e.getPosition()), null);
    } catch (MarkedYAMLException e) {
      Mark mark = e.getProblemMark() != null ? e.getProblemMark() : e.getContextMark();
      s.error(
          "YAML_SYNTAX",
          "YAML 문법이 올바르지 않습니다. 들여쓰기·따옴표·콜론·괄호를 확인해 주세요.",
          mark == null ? new SourceMap.Pos(1, 1) : s.pos(mark),
          null);
    } catch (IllegalArgumentException e) {
      // 스캐너가 잘못된 이스케이프(\\U80000000·\\U00110000 등)의 숫자를 풀다 던지는
      // NumberFormatException·IllegalArgumentException 은
      // 예상한 문법 오류다(compose 단계 한정 — 로그하지 않는다). 점검·스키마·값·모델 단계의 예외는 parse 가 error 로 남긴다.
      s.error(
          "YAML_SYNTAX",
          "YAML 문법이 올바르지 않습니다. 들여쓰기·따옴표·콜론·괄호·이스케이프를 확인해 주세요.",
          new SourceMap.Pos(1, 1),
          null);
    } catch (YAMLException e) {
      s.error(
          "YAML_SYNTAX",
          "YAML 문법이 올바르지 않습니다. 들여쓰기·따옴표·콜론·괄호를 확인해 주세요.",
          new SourceMap.Pos(1, 1),
          null);
    }
    return null;
  }

  /**
   * 이벤트를 훑어 첫 위반에서 멈춘다. 문제가 없으면 true. 이벤트는 재귀 없이 하나씩 나오므로 깊은 문서도 안전하고, 위반은 이벤트 시작 표시의 정확한 위치로 알린다.
   */
  private static boolean scanEvents(String text, LoaderOptions options, ParseSession s) {
    ParserImpl parser = new ParserImpl(new StreamReader(text), options);
    int documents = 0;
    int depth = 0;
    while (!parser.checkEvent(Event.ID.StreamEnd)) {
      Event e = parser.getEvent();
      SourceMap.Pos pos = s.pos(e.getStartMark());
      if (e instanceof DocumentStartEvent doc) {
        if (++documents > 1) {
          s.error("YAML_MULTIPLE_DOCUMENTS", "문서가 둘 이상입니다. '---' 로 나뉜 첫 문서만 남겨 주세요.", pos, null);
          return false;
        }
        if (doc.getTags() != null && !doc.getTags().isEmpty()) {
          s.error("YAML_CUSTOM_TAG", "%TAG 지시문과 태그(!이름)는 쓸 수 없습니다.", pos, null);
          return false;
        }
        continue;
      }
      if (e instanceof AliasEvent || e instanceof NodeEvent node && node.getAnchor() != null) {
        s.error("YAML_ALIAS", "별칭(&이름, *이름)은 쓸 수 없습니다. 같은 내용을 직접 적어 주세요.", pos, null);
        return false;
      }
      String tag =
          e instanceof ScalarEvent scalar
              ? scalar.getTag()
              : e instanceof CollectionStartEvent coll ? coll.getTag() : null;
      if (tag != null) {
        s.error("YAML_CUSTOM_TAG", "태그(!이름, !!이름)는 쓸 수 없습니다.", pos, null);
        return false;
      }
      if (e instanceof CollectionStartEvent && ++depth > MAX_DEPTH) {
        s.error("YAML_TOO_DEEP", "들여쓰기·중첩이 너무 깊습니다(최대 " + MAX_DEPTH + "단계).", pos, null);
        return false;
      }
      if (e.is(Event.ID.SequenceEnd) || e.is(Event.ID.MappingEnd)) {
        depth--;
      }
    }
    if (documents == 0) {
      s.error("YAML_EMPTY", "내용이 비어 있습니다.", new SourceMap.Pos(1, 1), null);
      return false;
    }
    return true;
  }

  /** 결과를 만든다(문제는 줄·열 순). */
  private static ParseResult result(WorkflowModel model, ParseSession s) {
    return new ParseResult(model, s.sortedProblems(), s.source);
  }

  /** 트리를 만들기 전에 끝나는 단일 문제 결과(위치 1행 1열). */
  private static ParseResult single(String code, String message) {
    return new ParseResult(
        null,
        List.of(new WorkflowProblem(WorkflowProblem.ERROR, code, message, 1, 1, null)),
        SourceMap.empty());
  }

  /** 문자열의 UTF-8 바이트 수(할당 없이 센다. 짝 없는 서로게이트는 3 으로 넉넉히 센다). */
  private static int utf8Length(String s) {
    int bytes = 0;
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      if (c < 0x80) {
        bytes += 1;
      } else if (c < 0x800) {
        bytes += 2;
      } else if (Character.isHighSurrogate(c)
          && i + 1 < s.length()
          && Character.isLowSurrogate(s.charAt(i + 1))) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  /**
   * 모든 스칼라를 글로 해석하는 Resolver. 기본 Resolver 는 yes/no/2026/날짜를 불리언·수·시각으로 바꾸지만 이 정의는 적힌 글 그대로가 필요하다.
   * 타입이 필요한 몇 칸은 {@link YamlScalars} 가 직접 판정한다. 또 이렇게 하면 스칼라의 태그가 STR 이 아닐 때는 사용자가 태그를 명시한 경우뿐이라 태그
   * 점검이 단순해진다.
   */
  private static final class TextResolver extends Resolver {
    @Override
    public Tag resolve(NodeId kind, String value, boolean implicit) {
      return kind == NodeId.scalar ? Tag.STR : super.resolve(kind, value, implicit);
    }
  }
}
