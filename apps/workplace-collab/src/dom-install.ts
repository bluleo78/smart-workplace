// 다른 어떤 import 보다 먼저 DOM 전역을 설치하기 위한 부수효과 모듈 — 진입점·테스트 첫 줄에서 import 한다.
import { installServerDom } from './dom'

installServerDom()
