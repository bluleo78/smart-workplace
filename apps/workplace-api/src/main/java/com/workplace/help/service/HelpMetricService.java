package com.workplace.help.service;

import com.workplace.global.util.SecretTextMasker;
import com.workplace.global.util.Texts;
import com.workplace.help.dto.HelpMetricKind;
import com.workplace.help.dto.HelpMetricRow;
import com.workplace.help.repository.HelpMetricRepository;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 도움말 지표 기록·조회(WP-1512). 저장 전에 값을 정규화(비밀값·이메일 가리기, 길이 제한, null 은 '')해 같은 키가 한 행으로 모이고 열 길이를 넘지 않게
 * 한다.
 */
@Service
@RequiredArgsConstructor
public class HelpMetricService {

  /** help_id 열 길이 한도(코드포인트). */
  private static final int HELP_ID_MAX = 100;

  /**
   * 받는 도움말 id 꼴 — 매뉴얼 id(소문자·숫자·.·_·-) 와, 명시 id 가 없는 절의 대체 id(장 slug + '#' + 제목 앵커 — 앵커는 소문자로 맞춘
   * 글자·숫자·_·-, 한글 포함). 그 밖(대문자·공백·기호, 붙여 넣은 토큰 등)은 지표에 남기지 않는다.
   */
  private static final Pattern HELP_ID_SHAPE =
      Pattern.compile("^[a-z0-9._-]*(#[\\p{Ll}\\p{Lo}\\p{Lm}\\p{M}\\p{N}_-]+)?$");

  /** 경로 조각 분리 전에 미리 자르는 길이(코드포인트). */
  private static final int ROUTE_PRE_CUT = 2000;

  /** 조회 건수 상한. */
  private static final int TOP_LIMIT = 100;

  /** 조회 가능한 기간(일). */
  private static final Set<Integer> ALLOWED_DAYS = Set.of(7, 30, 90);

  private final HelpMetricRepository repository;

  /** 도움말 열기를 센다 — 화면 경로와 도움말 id 단위. */
  @Transactional
  public void recordOpen(String route, String helpId) {
    repository.increment(HelpMetricKind.OPEN, normalizeRoute(route), normalizeHelpId(helpId), "");
  }

  /** 0건 검색어를 센다. 가린 뒤 비면(공백뿐) 기록하지 않는다. */
  @Transactional
  public void recordSearchMiss(String query, String route, String helpId) {
    recordTerm(HelpMetricKind.SEARCH_MISS, normalizeRoute(route), helpId, query);
  }

  /** AI 가 매뉴얼로 답하지 못한 질문을 센다 — 화면 경로는 없으므로 ''. */
  @Transactional
  public void recordAiGap(String question, String helpId) {
    recordTerm(HelpMetricKind.AI_GAP, "", helpId, question);
  }

  /** 검색어·질문을 가려 센다 — 가린 뒤 비면(공백뿐) 기록하지 않는다. route 는 이미 정규화된 값. */
  private void recordTerm(HelpMetricKind kind, String route, String helpId, String text) {
    String term = SecretTextMasker.mask(text);
    if (term.isEmpty()) {
      return;
    }
    repository.increment(kind, route, normalizeHelpId(helpId), term);
  }

  /** 기간(7·30·90일) 안의 지표 상위 목록. 그 밖의 기간은 거절한다. */
  @Transactional(readOnly = true)
  public List<HelpMetricRow> top(HelpMetricKind kind, int days) {
    if (!ALLOWED_DAYS.contains(days)) {
      throw new IllegalArgumentException("기간은 7·30·90일 중 하나입니다");
    }
    return repository.top(kind, days, TOP_LIMIT);
  }

  /**
   * 도움말 id 를 앞뒤 공백 제거·100자 제한한 뒤 id 꼴({@link #HELP_ID_SHAPE})이 아니면 ''. null 도 ''. 자유 텍스트가 지표 키로 들어와
   * 행이 흩어지거나 비밀값이 남는 것을 막는다.
   */
  static String normalizeHelpId(String helpId) {
    if (helpId == null) {
      return "";
    }
    String id = Texts.headCodePoints(helpId.strip(), HELP_ID_MAX);
    return HELP_ID_SHAPE.matcher(id).matches() ? id : "";
  }

  /**
   * 화면 경로를 조각('/')별로 가린 뒤 다시 잇고 200 코드포인트로 자른다. 통째로 가리면 긴 덩어리 규칙(24자+ 대소문자·숫자 섞임)이 '/' 를 넘어 경로 전체를
   * 삼켜 서로 다른 화면이 [가림] 한 줄로 합쳐지므로, 조각 하나하나만 판정한다(공유 링크 토큰 조각은 여전히 가려진다).
   */
  static String normalizeRoute(String route) {
    if (route == null) {
      return "";
    }
    // 거대한 경로로 조각 분리·가리기를 돌리지 않게 먼저 자른다.
    String[] segs = Texts.headCodePoints(route.strip(), ROUTE_PRE_CUT).split("/", -1);
    for (int i = 0; i < segs.length; i++) {
      // 빈 조각(맨 앞 '/' 앞, '//' 사이)은 그대로 둬 원래 꼴을 지킨다.
      if (!segs[i].isEmpty()) {
        segs[i] = SecretTextMasker.mask(segs[i]);
      }
    }
    return Texts.headCodePoints(String.join("/", segs), SecretTextMasker.MAX_CODE_POINTS);
  }
}
