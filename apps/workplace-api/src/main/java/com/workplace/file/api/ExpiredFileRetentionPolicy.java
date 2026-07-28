package com.workplace.file.api;

import java.util.Collection;
import java.util.Set;

/**
 * 만료 정리 스윕이 파일을 실제로 지우기 직전에 도메인에 되묻는 훅(#759).
 *
 * <p>왜 필요한가: 만료(`file.expires_at`)는 업로드 직후의 임시 파일뿐 아니라 "참조가 빠져 유예 중" 인 파일에도 붙는다(노트 첨부 강등). 그런데 참조
 * 판정은 판정한 도메인만 정확히 알 수 있고, 판정 시점과 삭제 시점 사이에는 유예 기간만큼의 간극이 있다. 그 사이에 참조가 되살아났는데 스윕이 그대로 지우면 살아 있는
 * 데이터가 사라진다.
 *
 * <p>{@code file} 코어가 {@code wiki} 를 직접 import 하면 의존 방향이 코어 → 도메인으로 뒤집히므로, 도메인이 구현하는 SPI 로
 * 둔다({@code drive.api.AttachmentSourceProvider} 와 같은 형태).
 */
public interface ExpiredFileRetentionPolicy {

  /**
   * 만료됐지만 <b>지우면 안 되는</b> fileId 를 돌려준다. 현재 테넌트 컨텍스트(GUC 주입된 트랜잭션) 안에서 호출된다.
   *
   * <p>구현 주의: 보존하기로 했다고 만료를 <b>해제</b>(NULL)하면 안 된다. 재무장 트리거가 도메인 저장 경로뿐이라면, 이후 참조가 모두 사라져도 다시 만료가
   * 붙지 않아 영구 고아가 된다. 만료를 다음 유예 뒤로 <b>미루는</b> 것이 맞다 — 그러면 참조가 사라진 뒤 다음 사이클에 정상 회수된다.
   */
  Set<Long> retain(Collection<Long> expiringFileIds);
}
