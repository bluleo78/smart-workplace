package com.workplace.fileai.inbound;

import java.util.List;

/**
 * 추출 행이 없는 기존 첨부를 fileai 에 알려 주는 SPI(WP-244 백필).
 *
 * <p>WP-242 이전에 올라간 이슈·챗 첨부는 file_extraction 행이 없어 AI 가 읽을 수 없다. fileai 코어가 도메인 테이블을 import 하면 의존
 * 방향이 뒤집히므로 도메인이 구현하는 SPI 로 둔다({@code file.api.ExpiredFileRetentionPolicy} 와 같은 형태). 스케줄러가 테넌트 GUC
 * 가 주입된 트랜잭션 안에서 호출한다.
 */
public interface ExtractionBackfillSource {

  /** 현재 테넌트에서 추출 행이 없는 이 소스의 첨부를 fileId 오름차순으로 최대 limit 건. */
  List<Target> findMissing(int limit);

  /** 백필 대상 — 파일 id 와 저장된 mime(추출 가능 판정 입력). */
  record Target(long fileId, String mime) {}
}
