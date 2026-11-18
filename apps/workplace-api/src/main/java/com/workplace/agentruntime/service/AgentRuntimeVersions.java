package com.workplace.agentruntime.service;

import com.workplace.agentruntime.config.AgentRuntimeProperties;
import com.workplace.agentruntime.dto.AgentTemplate;
import com.workplace.agentruntime.dto.RuntimeVersion;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 지금 이 API 가 아는 작업 공간 버전(WP-1706) — 템플릿 레지스트리의 이미지와 릴리스가 넘긴 플러그인 버전. 저장 때 기록하는 쪽과 기동 때 비교하는 쪽이 같은
 * 값을 쓰도록 계산을 한 곳에 둔다.
 */
@Component
@RequiredArgsConstructor
public class AgentRuntimeVersions {

  private final AgentTemplateRegistry registry;
  private final AgentRuntimeProperties properties;

  /** 템플릿 이름 → 지금 버전. WORKSPACE 이고 이미지가 있는 템플릿만, 아니면 empty. */
  public Optional<RuntimeVersion> current(String templateName) {
    return registry.find(templateName).flatMap(this::versionOf);
  }

  /** 레지스트리의 모든 작업 공간 템플릿 → 지금 버전(이름순). */
  public Map<String, RuntimeVersion> currentAll() {
    Map<String, RuntimeVersion> out = new LinkedHashMap<>();
    for (AgentTemplate t : registry.list()) {
      versionOf(t).ifPresent(v -> out.put(t.name(), v));
    }
    return out;
  }

  private Optional<RuntimeVersion> versionOf(AgentTemplate t) {
    if (!"WORKSPACE".equals(t.kind()) || t.image() == null || t.image().isBlank()) {
      return Optional.empty();
    }
    return Optional.of(new RuntimeVersion(t.image(), properties.pluginVersion()));
  }
}
