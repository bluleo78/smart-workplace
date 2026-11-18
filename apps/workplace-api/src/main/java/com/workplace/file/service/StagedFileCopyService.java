package com.workplace.file.service;

import com.workplace.file.api.StagedCopySource;
import com.workplace.file.api.StagedCopySourceResolver;
import com.workplace.file.dto.StagedFileResponse;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 스테이징 복사(WP-1705) — 출처 도메인 리졸버로 읽기 권한을 확인한 뒤 원본 바이트를 호출자 소유 임시 첨부로 복사한다.
 *
 * <p>{@link StagedUploadService} 와 별도 클래스인 이유: 도메인 서비스 중에 {@code StagedUploadService} 에 기대는 경로가 있어,
 * 그쪽이 리졸버(도메인 구현)를 주입받으면 생성자 순환이 생길 수 있다.
 */
@Service
public class StagedFileCopyService {
  private final Map<String, StagedCopySourceResolver> resolvers;
  private final StagedUploadService staged;

  /** 리졸버를 source 키 맵으로 만든다 — 키가 겹치면 {@code toMap} 이 IllegalStateException 으로 기동을 막는다(의도). */
  public StagedFileCopyService(
      List<StagedCopySourceResolver> resolvers, StagedUploadService staged) {
    this.resolvers =
        resolvers.stream()
            .collect(Collectors.toMap(StagedCopySourceResolver::source, Function.identity()));
    this.staged = staged;
  }

  /**
   * 출처 첨부를 스테이징 파일로 복사한다. 읽을 수 없으면 리졸버가 도메인 가드 예외를 던지고, 그 경우 FILE 행·blob 이 남지 않는다.
   *
   * @throws IllegalArgumentException 처리할 리졸버가 없는 source(400)
   */
  @Transactional
  public StagedFileResponse copy(long callerId, StagedCopySource src, String name) {
    StagedCopySourceResolver resolver = resolvers.get(src.source());
    if (resolver == null) {
      throw new IllegalArgumentException("복사할 수 없는 source 입니다: " + src.source());
    }
    long srcFileId = resolver.resolveReadableFileId(callerId, src);
    return staged.createFromCopy(callerId, srcFileId, name, src.source());
  }
}
