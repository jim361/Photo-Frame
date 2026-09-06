import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const section = (start, end) => script.slice(script.indexOf(start), script.indexOf(end, script.indexOf(start)));
const listeners = new Map();
const zoom = { scale:0.5, x:20, y:30, mode:'fit' };
const pv = { width:1000, height:500, hidden:false };
let refreshes = 0, saves = 0, undos = 0;
const vp = {
  addEventListener:(type, fn) => listeners.set(type, fn), setPointerCapture(){},
  getBoundingClientRect:() => ({ left:10, top:20 }), classList:{ add(){}, remove(){} },
};
const state = { showBoxes:false, shots:[{ img:{ width:1000, height:500 } }], current:0,
  style:'bottom', _pv:{ boxes:[{ key:'body', x:1, y:1, w:40, h:20 }], renderW:1000 } };
const noop = () => {};
const env = { vp, pv, zoom, state, boxDrag:null, edgeDrag:null, applyZoom:noop,
  paintOverlay:noop, syncAdv:noop, refresh:() => refreshes++, startEdgeDrag:() => false,
  startBoxDrag:() => false, moveBoxDrag:noop, moveEdgeDrag:noop, endBoxDrag:noop, endEdgeDrag:noop };
const gestures = new Function(...Object.keys(env),
  section('// 두 손가락은 줌·팬', '// 키보드') +
  '; return { get:() => ({ pinch, activePointer, boxDrag, edgeDrag }), setDrag:d => { edgeDrag=d; } };')(...Object.values(env));
const pointer = (type, id, x, y) => listeners.get(type)({ pointerId:id, clientX:x, clientY:y, button:0, target:{ closest:() => null } });

pointer('pointerdown', 1, 100, 100);
const profile = { bandScale:'130' };
gestures.setDrag({ prof:profile, h:{ key:'bandScale' }, base:100 });
pointer('pointerdown', 2, 200, 100);
assert.equal(profile.bandScale, '100', '두 번째 손가락은 끝나지 않은 프레임 조정을 되돌린다');
assert.equal(refreshes, 1);
const anchor = gestures.get().pinch;
pointer('pointermove', 2, 300, 100);
assert.equal(zoom.scale, 1);
assert.equal(zoom.mode, 'free');
assert.equal(zoom.x + anchor.cx * pv.width * zoom.scale, 190, '핀치 중심의 사진 지점은 유지된다');
assert.equal(zoom.y + anchor.cy * pv.height * zoom.scale, 80);
pointer('pointermove', 2, 4000, 100);
assert.equal(zoom.scale, 4, '최대 줌 제한');
pointer('pointermove', 2, 101, 100);
assert.equal(zoom.scale, 0.03, '최소 줌 제한');
pointer('pointerup', 2, 101, 100);
const afterPinch = { ...zoom };
pointer('pointermove', 1, 150, 130);
assert.deepEqual(zoom, afterPinch, '손가락 하나가 남아도 요소 드래그나 팬을 재개하지 않는다');
pointer('pointercancel', 1, 150, 130);
assert.equal(gestures.get().activePointer, null);

const current = { bodyDX:'0', bodyDY:'0' };
const inputs = { moveElement:{ value:'body' }, moveStep:{ value:'0.001' } };
const moveEnv = { state, $:id => inputs[id], boxDrag:null, edgeDrag:null,
  profileFor:() => current, photoDir:() => 'land', layoutSnapshot:() => ({ ...current }),
  sameStyleLayout:(a,b) => JSON.stringify(a) === JSON.stringify(b),
  setLayoutUndo:() => undos++, saveSettings:() => saves++, refresh:noop, LABEL:{ body:'카메라' } };
const nudge = new Function(...Object.keys(moveEnv),
  section('function nudgeElement(', "$('moveButtons').onclick") + '; return nudgeElement;')(...Object.values(moveEnv));
nudge(1, 0);
assert.deepEqual(current, { bodyDX:'0.001', bodyDY:'0' });
inputs.moveStep.value = '0.005';
nudge(0, -1);
assert.deepEqual(current, { bodyDX:'0.001', bodyDY:'-0.005' }, '선택 축만 정확한 비율로 이동한다');
nudge(0, 0, true);
assert.deepEqual(current, { bodyDX:'0', bodyDY:'0' });
nudge(0, 0, true);
assert.equal(undos, 3, '변화 없는 초기화는 되돌리기 단계를 추가하지 않는다');
assert.equal(saves, 3);
state._pv.boxes = [];
nudge(1, 0);
assert.equal(saves, 3, '표시되지 않는 요소는 이동하지 않는다');

const handles = new Function('state', section('function edgeHandles(', 'function hitEdge(') + '; return edgeHandles;')(state);
state.style = 'matte';
state._pv = { area:{}, raw:{ width:1160, height:660 }, units:{ borderScale:80 }, photo:{ x:80,y:80,w:1000,h:500 } };
assert.deepEqual(handles().map(h => h.key), ['borderScale'], '균등 매트에는 잘못된 정보 띠 핸들을 만들지 않는다');
state._pv.units.bandScale = 160;
state._pv.areaSide = 'bottom';
assert.deepEqual(handles().map(h => h.key), ['borderScale','bandScale']);
assert.match(html, /body\.has-photo \.viewport\{\s*position:sticky/, '좁은 화면의 미리보기 고정 규칙');
console.log('모바일 동작 검사 통과 · 핀치 중심/범위/종료 · 정밀 이동/초기화/되돌리기 · 매트 핸들');
