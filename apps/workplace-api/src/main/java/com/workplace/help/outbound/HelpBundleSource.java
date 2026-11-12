package com.workplace.help.outbound;

import java.io.IOException;

/** 도움말 묶음을 가져오는 곳(WP-1509). 장 하나라도 못 읽으면 예외를 던진다 — 부분 묶음을 돌려주면 색인기가 빠진 장의 절을 "삭제됨"으로 오해해 지운다. */
public interface HelpBundleSource {

  /** 전체 묶음을 가져온다. 일부라도 실패하면 {@link IOException}. */
  HelpBundle fetch() throws IOException;
}
