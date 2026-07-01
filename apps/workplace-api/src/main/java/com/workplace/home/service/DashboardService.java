package com.workplace.home.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.home.dto.DashboardResponse;
import com.workplace.home.dto.DashboardWidgetConfig;
import com.workplace.home.repository.DashboardRepository;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 홈 대시보드 레이아웃 조회/저장. 위젯은 두 종류다 — 시스템 위젯(고정 5종, 타입당 1개, count 기반)과 카탈로그 위젯(9종, 인스턴스 다중 허용, id +
 * params 기반). 알 수 없는 위젯 키는 GET 에서 폐기, PUT 에서 거부하여 프론트가 안전하게 렌더하도록 보장한다.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class DashboardService {

  /** 기본 레이아웃 위젯 키 — 미설정 사용자에게 반환. 순서가 곧 표시 순서. */
  static final List<String> DEFAULT_WIDGETS =
      List.of("my_tasks", "calendar_today", "notifications", "recent_chats", "unread_mail");

  /** 시스템 위젯 — 타입당 1개(싱글턴), count 기반. */
  static final Set<String> SYSTEM_WIDGETS = Set.copyOf(DEFAULT_WIDGETS);

  /** 카탈로그 위젯 — AI 챗 위젯 컴포넌트를 재사용하는 다중 인스턴스 위젯. 키는 프론트 chatWidgetRegistry 의 WidgetType 과 일치해야 한다. */
  static final Set<String> CATALOG_WIDGETS =
      Set.of(
          "issue_list",
          "mail_list",
          "calendar",
          "activity",
          "wiki",
          "contacts",
          "projects",
          "drive",
          "channels");

  /** 허용 위젯 키 전체 집합 — 저장/조회 시 화이트리스트 필터. */
  static final Set<String> KNOWN_WIDGETS =
      Stream.concat(SYSTEM_WIDGETS.stream(), CATALOG_WIDGETS.stream())
          .collect(Collectors.toUnmodifiableSet());

  /** 위젯 항목 수 허용값(시스템 위젯 전용). 기타 값은 400 으로 거부. */
  static final Set<Integer> ALLOWED_COUNTS = Set.of(3, 5, 10);

  /** count 기본값(미지정/0, 시스템 위젯 전용). */
  static final int DEFAULT_COUNT = 5;

  /** 사용자 1인당 저장 가능한 총 위젯 인스턴스 상한(시스템 + 카탈로그 합산). */
  static final int MAX_WIDGETS = 12;

  private final DashboardRepository repository;
  private final ObjectMapper objectMapper;

  /**
   * 사용자의 대시보드 레이아웃. 미설정이면 기본 레이아웃, 있으면 알 수 없는 위젯을 제거하고 시스템 위젯 type 중복 및 id 중복을 정리해 반환한다. 레거시(문자열
   * 배열) 저장본도 기본 설정 객체로 변환해 호환한다. GET 은 관용적(tolerant) — 깨진/구버전 행도 렌더 가능하게 한다.
   */
  @Transactional(readOnly = true)
  public DashboardResponse get(long userId) {
    Optional<String> json = repository.findWidgetsJson(userId);
    if (json.isEmpty()) {
      return new DashboardResponse(defaultConfigs());
    }
    List<DashboardWidgetConfig> stored;
    try {
      stored = parse(json.get());
    } catch (RuntimeException e) {
      // GET 은 관용적 — 손상된 한 행이 대시보드를 깨뜨리지 않도록 기본 레이아웃으로 폴백한다.
      log.warn("대시보드 위젯 파싱 실패(userId={}), 기본 레이아웃으로 폴백", userId, e);
      return new DashboardResponse(defaultConfigs());
    }
    List<DashboardWidgetConfig> filtered = new ArrayList<>();
    Set<String> seenSystemTypes = new LinkedHashSet<>();
    Set<String> seenIds = new LinkedHashSet<>();
    for (DashboardWidgetConfig w : stored) {
      if (w.type() == null || !KNOWN_WIDGETS.contains(w.type())) {
        continue;
      }
      if (SYSTEM_WIDGETS.contains(w.type()) && !seenSystemTypes.add(w.type())) {
        continue;
      }
      DashboardWidgetConfig normalized = normalize(w);
      if (!seenIds.add(normalized.id())) {
        continue;
      }
      filtered.add(normalized);
    }
    return new DashboardResponse(filtered);
  }

  /**
   * 레이아웃 저장(전체 교체). PUT 은 엄격(strict) — 알 수 없는 type / 허용 외 count / 시스템 위젯 type 중복 / 위젯 id 중복 /
   * params 형식 오류 / 총 개수 초과는 400 으로 거부한다. 카탈로그 위젯은 동일 type 다중 인스턴스를 허용한다. 숨김(hidden) 위젯도 순서·설정 보존을
   * 위해 그대로 영속한다.
   *
   * @return 실제 저장된 위젯 목록
   */
  @Transactional
  public DashboardResponse save(long userId, List<DashboardWidgetConfig> widgets) {
    if (widgets.isEmpty()) {
      // GlobalExceptionHandler 에서 IllegalArgumentException → 400 으로 매핑된다.
      throw new IllegalArgumentException("유효한 위젯이 하나도 없습니다.");
    }
    if (widgets.size() > MAX_WIDGETS) {
      throw new IllegalArgumentException("위젯은 최대 " + MAX_WIDGETS + "개까지 추가할 수 있습니다.");
    }
    List<DashboardWidgetConfig> validated = new ArrayList<>();
    Set<String> seenSystemTypes = new LinkedHashSet<>();
    Set<String> seenIds = new LinkedHashSet<>();
    for (DashboardWidgetConfig w : widgets) {
      if (w.type() == null || !KNOWN_WIDGETS.contains(w.type())) {
        throw new IllegalArgumentException("알 수 없는 위젯 타입입니다: " + w.type());
      }
      if (SYSTEM_WIDGETS.contains(w.type()) && !seenSystemTypes.add(w.type())) {
        throw new IllegalArgumentException("중복된 위젯 타입입니다: " + w.type());
      }
      DashboardWidgetConfig v = validate(w);
      if (!seenIds.add(v.id())) {
        throw new IllegalArgumentException("중복된 위젯 id 입니다: " + v.id());
      }
      validated.add(v);
    }
    repository.upsert(userId, write(validated));
    return new DashboardResponse(validated);
  }

  /**
   * PUT 검증 — 시스템 위젯은 count 를 검증(미지정/0 은 기본값 보정, 허용 외 값은 거부), 카탈로그 위젯은 count 를 무시(0 저장)하고 params 가
   * null 이 아니면 JSON 객체인지만 검증한다. id 미지정 시 시스템 위젯은 type 을, 카탈로그 위젯은 신규 UUID 를 부여한다.
   */
  private DashboardWidgetConfig validate(DashboardWidgetConfig w) {
    boolean isCatalog = CATALOG_WIDGETS.contains(w.type());
    int count = w.count() <= 0 ? DEFAULT_COUNT : w.count();
    if (!isCatalog && !ALLOWED_COUNTS.contains(count)) {
      throw new IllegalArgumentException("허용되지 않는 위젯 항목 수입니다: " + w.count());
    }
    // Jackson 은 JsonNode 필드에 JSON null 이 오면 Java null 이 아니라 NullNode 인스턴스로 역직렬화한다.
    // "params 미지정"으로 취급하려면 NullNode 도 null 과 동일하게 다뤄야 한다.
    JsonNode params = (w.params() == null || w.params().isNull()) ? null : w.params();
    if (isCatalog && params != null && !params.isObject()) {
      throw new IllegalArgumentException("위젯 설정(params)은 객체여야 합니다: " + w.type());
    }
    String id =
        (w.id() == null || w.id().isBlank())
            ? (isCatalog ? UUID.randomUUID().toString() : w.type())
            : w.id();
    return new DashboardWidgetConfig(
        id, w.type(), isCatalog ? 0 : count, w.hidden(), isCatalog ? params : null, w.label());
  }

  /** GET 정규화 — id 미지정 보정, count 는 시스템 위젯만 허용 외/0 이면 기본값으로 보정(읽기는 거부하지 않음). */
  private DashboardWidgetConfig normalize(DashboardWidgetConfig w) {
    boolean isCatalog = CATALOG_WIDGETS.contains(w.type());
    String id = (w.id() == null || w.id().isBlank()) ? w.type() : w.id();
    int count = ALLOWED_COUNTS.contains(w.count()) ? w.count() : DEFAULT_COUNT;
    JsonNode params = (w.params() == null || w.params().isNull()) ? null : w.params();
    return new DashboardWidgetConfig(
        id, w.type(), isCatalog ? 0 : count, w.hidden(), isCatalog ? params : null, w.label());
  }

  /** 기본 레이아웃을 기본 설정(count 5, hidden false, id=type) 객체 목록으로. */
  private List<DashboardWidgetConfig> defaultConfigs() {
    return DEFAULT_WIDGETS.stream()
        .map(t -> new DashboardWidgetConfig(t, DEFAULT_COUNT, false))
        .toList();
  }

  /**
   * 저장된 JSON → List&lt;DashboardWidgetConfig&gt;. 두 가지 형태를 모두 허용한다: 신규(객체 배열) 와 레거시(문자열 배열). 첫 노드
   * 타입으로 형태를 판별하고, 레거시 문자열은 기본 설정 객체로 변환한다. 파싱 실패는 입력 오류로 간주.
   */
  private List<DashboardWidgetConfig> parse(String json) {
    try {
      JsonNode root = objectMapper.readTree(json);
      if (!root.isArray() || root.isEmpty()) {
        return List.of();
      }
      JsonNode first = root.get(0);
      List<DashboardWidgetConfig> result = new ArrayList<>();
      if (first.isTextual()) {
        // 레거시: ["my_tasks", ...] → {type, count:5, hidden:false}
        for (JsonNode node : root) {
          if (node.isTextual()) {
            result.add(new DashboardWidgetConfig(node.asText(), DEFAULT_COUNT, false));
          }
        }
      } else {
        // 신규: [{id, type, count, hidden, params, label}, ...]
        for (JsonNode node : root) {
          result.add(objectMapper.treeToValue(node, DashboardWidgetConfig.class));
        }
      }
      return result;
    } catch (Exception e) {
      throw new IllegalArgumentException("대시보드 위젯 데이터를 해석할 수 없습니다.", e);
    }
  }

  /** List&lt;DashboardWidgetConfig&gt; → JSON 객체 배열 문자열. */
  private String write(List<DashboardWidgetConfig> widgets) {
    try {
      return objectMapper.writeValueAsString(widgets);
    } catch (Exception e) {
      throw new IllegalStateException("대시보드 위젯 직렬화에 실패했습니다.", e);
    }
  }
}
