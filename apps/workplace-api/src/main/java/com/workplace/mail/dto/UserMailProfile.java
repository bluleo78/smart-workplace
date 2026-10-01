package com.workplace.mail.dto;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * "나" 프로필(WP-150) — 메일 개인 분석이 LLM 에 넘기는 [나] 정보이자 ⑤ 규칙의 "나" 주소 집합. AI 대화 등에서도 재사용하도록 순수 DTO + 텍스트
 * 렌더러로 둔다(메일 분석은 구조화 값을 보내고 ai-agent 가 렌더한다).
 *
 * @param name 표시 이름(user.name, 비었으면 첫 계정 표시 이름). 프로필 조회에 실패하면 null
 * @param otherNames 다른 이름(계정 표시 이름 중 name 과 다른 것) — CC 로 받은 메일의 "직접 지칭" 판정에 쓴다
 * @param title 직함(user.title)
 * @param addresses 모든 주소(계정 주소 → user.email 순, 소문자·중복 제거). ⑤ 규칙 입력이라 프로필 조회가 실패해도 채운다
 * @param groups 소속 조직 — 공유(SHARED) 조직도에서 MEMBER 로 직접 속한 그룹 이름
 */
public record UserMailProfile(
    long userId,
    String name,
    List<String> otherNames,
    String title,
    List<String> addresses,
    List<String> groups) {

  public UserMailProfile {
    otherNames = otherNames == null ? List.of() : List.copyOf(otherNames);
    addresses = addresses == null ? List.of() : List.copyOf(addresses);
    groups = groups == null ? List.of() : List.copyOf(groups);
  }

  /** 주소만 있는 프로필 — 이름·직함·소속 조회에 실패했거나 사용자 행이 없을 때. */
  public static UserMailProfile addressesOnly(long userId, List<String> addresses) {
    return new UserMailProfile(userId, null, List.of(), null, addresses, List.of());
  }

  /** ⑤ 규칙용 주소 집합(입력 순서 유지, 수정 불가). */
  public Set<String> addressSet() {
    return Collections.unmodifiableSet(new LinkedHashSet<>(addresses));
  }

  /**
   * [나] 블록 텍스트. 이름이 있으면 "이름 (다른 이름: …) · 직함 · 소속: …" + 들여쓴 주소 줄, 없으면 "[나] 주소: …" 한 줄, 아무것도 없으면 빈
   * 문자열. ⚠️ ai-agent run-mail-ai.ts meLines 와 같은 형식(양쪽 테스트로 고정).
   */
  public String render() {
    List<String> addressList = oneLines(addresses);
    String addressText = addressList.isEmpty() ? null : "주소: " + String.join(", ", addressList);
    String n = oneLine(name);
    if (n.isEmpty()) {
      return addressText == null ? "" : "[나] " + addressText;
    }
    List<String> head = new ArrayList<>();
    List<String> others = oneLines(otherNames);
    head.add(others.isEmpty() ? n : n + " (다른 이름: " + String.join(", ", others) + ")");
    String t = oneLine(title);
    if (!t.isEmpty()) {
      head.add(t);
    }
    List<String> g = oneLines(groups);
    if (!g.isEmpty()) {
      head.add("소속: " + String.join(", ", g));
    }
    String first = "[나] " + String.join(" · ", head);
    return addressText == null ? first : first + "\n     " + addressText;
  }

  /** 한 줄 값 — 줄바꿈을 공백으로 접어 이름 등으로 블록 줄을 위조하지 못하게 한다. null → 빈 문자열. */
  public static String oneLine(String s) {
    return s == null ? "" : s.replaceAll("\\s*[\\r\\n]+\\s*", " ").trim();
  }

  private static List<String> oneLines(List<String> list) {
    return list.stream().map(UserMailProfile::oneLine).filter(v -> !v.isEmpty()).toList();
  }
}
