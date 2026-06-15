package com.workplace.home.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.home.dto.DashboardResponse;
import com.workplace.home.repository.DashboardRepository;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 홈 대시보드 레이아웃 조회/저장. 알 수 없는 위젯 키는 항상 폐기하여 프론트가 안전하게 렌더하도록 보장한다. */
@Service
@RequiredArgsConstructor
public class DashboardService {

  /** 기본 레이아웃 — 미설정 사용자에게 반환. 순서가 곧 표시 순서. */
  static final List<String> DEFAULT_WIDGETS =
      List.of("my_tasks", "calendar_today", "notifications", "recent_chats", "unread_mail");

  /** 허용 위젯 키 집합 — 저장/조회 시 화이트리스트 필터. */
  static final Set<String> KNOWN_WIDGETS = Set.copyOf(DEFAULT_WIDGETS);

  private final DashboardRepository repository;
  private final ObjectMapper objectMapper;

  /** 사용자의 대시보드 레이아웃. 미설정이면 기본 레이아웃, 있으면 알 수 없는 위젯을 제거해 반환. */
  @Transactional(readOnly = true)
  public DashboardResponse get(long userId) {
    Optional<String> json = repository.findWidgetsJson(userId);
    if (json.isEmpty()) {
      return new DashboardResponse(DEFAULT_WIDGETS);
    }
    List<String> stored = parse(json.get());
    List<String> filtered = stored.stream().filter(KNOWN_WIDGETS::contains).distinct().toList();
    return new DashboardResponse(filtered);
  }

  /**
   * 레이아웃 저장. 알 수 없는 위젯을 제거하고 중복을 제거한 뒤 영속한다. 필터 후 비면 잘못된 요청(400)으로 거부한다.
   *
   * @return 실제 저장된(필터링된) 위젯 목록
   */
  @Transactional
  public DashboardResponse save(long userId, List<String> widgets) {
    List<String> filtered = widgets.stream().filter(KNOWN_WIDGETS::contains).distinct().toList();
    if (filtered.isEmpty()) {
      // GlobalExceptionHandler 에서 IllegalArgumentException → 400 으로 매핑된다.
      throw new IllegalArgumentException("유효한 위젯이 하나도 없습니다.");
    }
    repository.upsert(userId, write(filtered));
    return new DashboardResponse(filtered);
  }

  /** 저장된 JSON 배열 → List<String>. 파싱 실패는 입력 오류로 간주. */
  private List<String> parse(String json) {
    try {
      return objectMapper.readValue(json, new TypeReference<List<String>>() {});
    } catch (Exception e) {
      throw new IllegalArgumentException("대시보드 위젯 데이터를 해석할 수 없습니다.", e);
    }
  }

  /** List<String> → JSON 배열 문자열. */
  private String write(List<String> widgets) {
    try {
      return objectMapper.writeValueAsString(widgets);
    } catch (Exception e) {
      throw new IllegalStateException("대시보드 위젯 직렬화에 실패했습니다.", e);
    }
  }
}
