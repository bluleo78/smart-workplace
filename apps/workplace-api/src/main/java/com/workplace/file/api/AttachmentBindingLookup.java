package com.workplace.file.api;

import java.util.Collection;
import java.util.Set;

/**
 * 첨부 바인딩 조회 SPI(WP-421) — 주어진 파일 id 가운데 이 도메인의 첨부 정션에 이미 묶인 것을 돌려준다.
 *
 * <p>{@link StagedFileClaimer} 가 "아직 어디에도 묶이지 않은 임시 파일"만 클레임하게 하려고 쓴다. 대부분의 도메인은 묶을 때 만료를 지워 "임시"
 * 조건만으로 거를 수 있지만, 노트처럼 업로드 때 묶고도 임시로 두는(강등 파일 포함) 도메인이 있어 정션을 직접 봐야 한다. core {@code file} 은 도메인
 * 패키지를 import 하지 않으므로 {@link AttachmentBindingConfig} 가 생성된 jOOQ 정션 열로 구현을 등록한다.
 *
 * <p><b>업로드·바인딩 뒤에도 파일을 임시(expires_at 있음)로 두는 도메인은 반드시 등록해야 한다</b> — 빠뜨리면 그 도메인에 묶인 파일이 다른 도메인에 다시
 * 묶여 한 파일이 두 곳에 걸린다. 같은 트랜잭션에서 FILE 행을 잠근 뒤 불리므로 커밋된 바인딩은 모두 보인다.
 */
public interface AttachmentBindingLookup {

  /**
   * {@code fileIds} 중 이 도메인 정션에 행이 있는 id. 빈 입력이면 쿼리 없이 빈 집합.
   *
   * @param fileIds 확인할 파일 id(중복 없음)
   * @return 묶인 파일 id 의 부분집합
   */
  Set<Long> boundAmong(Collection<Long> fileIds);
}
