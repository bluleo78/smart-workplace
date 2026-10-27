package com.workplace.issue.service;

import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.ParentRef;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 조회자가 읽을 수 없는 프로젝트의 부모 요약을 가리는 도우미(WP-1038). 에픽 부모는 다른 프로젝트에 있을 수 있는데, 하위 이슈를 볼 수 있다고 그 에픽 프로젝트를 볼
 * 수 있는 것은 아니다 — 가리지 않으면 비공개 프로젝트의 에픽 제목·번호가 하위 응답으로 새어 나간다.
 *
 * <p>같은 프로젝트 부모는 하위를 읽는 조회자가 늘 읽을 수 있어 검사하지 않는다. 다른 프로젝트는 한 번의 조립 동안 프로젝트마다 한 번만 판정한다({@link
 * Visibility} 캐시).
 */
@Component
@RequiredArgsConstructor
public class ParentRefReader {

  private final ProjectAccessGuard accessGuard;
  private final ProjectRepository projectRepository;

  /** 한 조회자의 프로젝트별 읽기 판정 캐시 — 한 응답 조립 동안만 쓴다(권한이 바뀌어도 다음 요청은 새로 판정). */
  public Visibility forViewer(Long viewerId) {
    return new Visibility(viewerId);
  }

  /** 자식 id → 부모 요약 맵에서 조회자가 읽을 수 없는 부모를 {@link ParentRef#hiddenRef()} 로 바꾼 사본. */
  public Map<Long, ParentRef> redact(
      Long viewerId, List<IssueRow> children, Map<Long, ParentRef> refsByChild) {
    if (refsByChild.isEmpty()) return refsByChild;
    Visibility v = forViewer(viewerId);
    Map<Long, ParentRef> out = new HashMap<>(refsByChild.size());
    for (IssueRow child : children) {
      ParentRef ref = refsByChild.get(child.id());
      if (ref != null) out.put(child.id(), v.redact(ref, child.projectId()));
    }
    return out;
  }

  /** 조회자 한 명의 읽기 판정 — 프로젝트 id 별로 캐시한다. */
  public final class Visibility {
    private final Long viewerId;
    private final Map<Long, Boolean> readable = new HashMap<>();

    private Visibility(Long viewerId) {
      this.viewerId = viewerId;
    }

    /**
     * 프로젝트를 이 조회자가 읽을 수 있는가 — 규칙은 {@link ProjectAccessGuard#canReadForViewer}(관계 이력 가림과 같은 한 곳).
     * 없는(삭제된) 프로젝트는 읽을 수 없다.
     */
    public boolean canRead(long projectId) {
      return readable.computeIfAbsent(
          projectId,
          id ->
              projectRepository
                  .findById(id)
                  .map(p -> accessGuard.canReadForViewer(p, viewerId))
                  .orElse(false));
    }

    /** 부모가 자식과 다른 프로젝트이고 그 프로젝트를 읽을 수 없으면 가린 요약, 아니면 그대로. */
    public ParentRef redact(ParentRef ref, long childProjectId) {
      if (ref == null || ref.hidden() || ref.projectId() == null) return ref;
      if (ref.projectId() == childProjectId || canRead(ref.projectId())) return ref;
      return ParentRef.hiddenRef();
    }
  }
}
