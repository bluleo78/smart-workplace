#!/usr/bin/env node
/**
 * 제품 소개 자료 화면 촬영 — 사용자 매뉴얼과 같은 촬영기(docs/manual/scripts/lib/run-scenes.mjs)로 운영 누리커머스 테넌트를 찍는다.
 *
 *   MANUAL_WEB=https://genia-works.iacloud.kr MANUAL_API=https://genia-works.iacloud.kr \
 *   MANUAL_PASS="$(security find-generic-password -s genia-works-manual-demo -w)" node docs/intro/scripts/capture.mjs
 *   MANUAL_SHOTS_ONLY=home,assignee ...   # 일부만 다시 찍기 (boxes.json 은 샷 단위로 합쳐진다)
 *
 * 그림과 좌표는 docs/intro/deck/shots/<id>.png · boxes.json 에 쓴다. 규격·읽기 전용 가드·장면 단위 확정·once 장면 규칙은 매뉴얼과 같다.
 */
import path from 'node:path';
import { BOOKS, ROOT } from '../../manual/scripts/lib/books.mjs';
import { runCapture } from '../../manual/scripts/lib/run-scenes.mjs';
import { scenes } from './scenes.mjs';

process.exit(await runCapture({
  label: 'intro',
  scenes,
  capture: BOOKS.user.capture, // 같은 사용자 앱·같은 로그인 화면
  recorder: { dir: path.join(ROOT, 'docs/intro/deck/shots') },
}));
