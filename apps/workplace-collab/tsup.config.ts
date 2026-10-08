import { defineConfig } from 'tsup';

// 운영 번들 — 스키마 패키지는 TS 소스로 export 되므로 번들에 포함하고(noExternal),
// 나머지 dependencies(@tiptap/*·yjs·y-prosemirror 등)는 tsup 기본대로 external 로 남겨
// 런타임에 앱 node_modules 의 단일 인스턴스를 쓰게 한다(yjs·prosemirror 이중 로드 방지).
// mergeWorker 는 병합 워커 스레드 진입점(WP-289) — mergeRunner 가 `dist/mergeWorker.js` 를 같은 폴더에서 찾는다.
export default defineConfig({
  entry: ['src/index.ts', 'src/mergeWorker.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  noExternal: ['@smart-workplace/wiki-editor-schema'],
});
