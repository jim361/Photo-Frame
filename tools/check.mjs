import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('index.html의 인라인 스크립트를 찾지 못했습니다.');
new Function(script);

const checks = [
  [!/<script[^>]+src=|<link[^>]+(?:href|src)=["']https?:|url\(["']?https?:/i.test(html), '외부 실행 리소스가 없어야 합니다.'],
  [!/(?:fetch\s*\(|XMLHttpRequest|sendBeacon\s*\(|new\s+WebSocket)/.test(script), '사진을 외부로 보낼 수 있는 네트워크 코드가 없어야 합니다.'],
  [(script.match(/function\s+render\s*\(/g) || []).length === 1, '공통 render()는 한 곳이어야 합니다.'],
  [/refresh[\s\S]*?render\(/.test(script) && /exportShots[\s\S]*?render\(/.test(script), '미리보기와 내보내기는 render()를 함께 써야 합니다.'],
  [/mode === '3:4'/.test(script) && /value="3:4"/.test(html), '3:4 출력 옵션과 계산이 함께 있어야 합니다.'],
  [/PROJECT_VERSION\s*=\s*2/.test(script) && /new Set\(\[1, PROJECT_VERSION\]\)/.test(script), '프로젝트 v1 읽기·v2 저장 호환을 유지해야 합니다.'],
  [/배치 되돌리기/.test(html) && /id="undoDelete"/.test(html), '배치 되돌리기와 삭제 취소를 구분해야 합니다.'],
  [/id="addPhotos"/.test(html) && /id="loadExample"/.test(html), '사진 추가와 내장 예제 진입점을 유지해야 합니다.'],
  [/beforeunload/.test(script) && /projectDirty/.test(script), '미저장 프로젝트 이탈 경고를 유지해야 합니다.'],
  [/projectMismatchReasons/.test(script) && /파일명만 같습니다/.test(script) && /if \(!ok\) return null/.test(script), '파일명만 같은 프로젝트 원본은 이유와 연결 선택을 거쳐야 합니다.'],
  [/confirmed:true/.test(script) && /confirmed:false/.test(script) && /다운로드 요청/.test(script), '폴더 저장 완료와 다운로드 요청을 구분해야 합니다.'],
  [/--railw, 500px/.test(html) && /id="uiWidth"[^>]+value="500"/.test(html) && /\|\| 500/.test(script), '설정 패널의 새 기본 너비는 500px이어야 합니다.'],
  [/withoutLegacyGearSeed/.test(script) && /LEGACY_PRESET_NAMES/.test(script), '예전 번들 장비 시드 정리를 유지해야 합니다.'],
];
for (const [ok, message] of checks) if (!ok) throw new Error(message);

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const missing = [...script.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]).filter(id => !ids.has(id));
if (missing.length) throw new Error(`존재하지 않는 DOM id 참조: ${[...new Set(missing)].join(', ')}`);

const legacy = await readFile(new URL('../legacy/filmframe.html', import.meta.url));
const legacyHash = createHash('sha256').update(legacy).digest('hex');
if (legacyHash !== '45739c92d133e4749def777e725ab924ae45db1fc9a76903348dd8a78710c565')
  throw new Error('수정 금지인 legacy/filmframe.html이 변경되었습니다.');

console.log(`PhotoFrame 검사 통과 · DOM id ${ids.size}개 · 인라인 스크립트 ${script.length.toLocaleString()}자`);
