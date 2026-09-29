// src/sw-env.d.ts
// 서비스워커 전용 타입 — tsconfig.sw.json 은 vite/client(DOM 의존)를 쓰지 않으므로 필요한 import.meta.env 만 선언한다.
interface ImportMetaEnv {
  readonly PROD: boolean
  readonly DEV: boolean
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
