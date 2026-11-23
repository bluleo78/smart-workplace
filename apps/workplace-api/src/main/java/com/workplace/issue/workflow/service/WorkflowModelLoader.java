package com.workplace.issue.workflow.service;

import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.exception.WorkflowException;
import com.workplace.issue.workflow.repository.WorkflowRepository;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 게시 버전 id → 모델 사본(WP-1986). 캐시({@link WorkflowModelCache})에 없으면 버전 행의 모델 JSON 을 읽어 담는 같은 로더를
 * 실행·조회·다리·챗 답 재개가 저마다 적지 않게 한곳에 둔다. 캐시 규칙은 그대로다 — RLS 로 그 실행(또는 정의)과 버전이 보인 것을 확인한 뒤에만 부른다.
 *
 * <p>왜 {@code @Transactional} 을 달지 않나: 버전이 없을 때의 예외가 트랜잭션 프록시를 거치면 부르는 쪽이 잡아도 트랜잭션이 롤백 전용이 된다.
 * {@link #find} 로 예외를 삼키는 챗 답 재개가 사람의 챗 글까지 되돌리지 않게 프록시 없는 부품으로 둔다(부르는 쪽 트랜잭션에서 돈다).
 */
@Component
@RequiredArgsConstructor
public class WorkflowModelLoader {

  private final WorkflowModelCache modelCache;
  private final WorkflowRepository workflowRepository;

  /** 버전의 모델 사본. 버전 행이 없으면 404({@link WorkflowException#notFound}). */
  public WorkflowModel get(long versionId) {
    return modelCache.get(
        versionId,
        () ->
            workflowRepository
                .findVersionById(versionId)
                .orElseThrow(WorkflowException::notFound)
                .modelJson());
  }

  /** {@link #get} 과 같되 버전 행이 없으면(깨진 저장 상태) 던지지 않고 empty. */
  public Optional<WorkflowModel> find(long versionId) {
    try {
      return Optional.of(get(versionId));
    } catch (WorkflowException e) {
      return Optional.empty();
    }
  }
}
