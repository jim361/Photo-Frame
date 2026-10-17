// Development-only browser QA. Uses an existing Playwright install; no app dependency.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(tmpdir(), `photoframe-persistence-${Date.now()}`);
await mkdir(output, { recursive:true });
const report = { output, passed:[], failed:[], evidence:{}, limitations:[
  '합성 PNG 사진만 사용. 실제 카메라 JPEG·모바일·Safari는 검사하지 않음.',
  '폴더 충돌·권한·쓰기 오류는 메모리 File System Access mock. 실제 권한 대화상자·디스크 폴더 검사는 아님.',
  'PC 글꼴은 API 존재·초기 권한 상태만 확인. 실제 권한 허용·목록 열람은 검사하지 않음.',
  '다운로드 완료는 미검증. 생성 Blob을 수집해 내용만 검증함. 작성 시 이 Windows 샌드박스의 Chrome download.saveAs가 두 번 canceled로 실패함.',
] };
const browser = await chromium.launch({ headless:true, downloadsPath:output,
  ...(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : {}) });
const context = await browser.newContext({ acceptDownloads:true, viewport:{ width:1440, height:1000 } });
const page = await context.newPage();
const errors = [], external = [];
let promptValue = 'QA';
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (['error','assert'].includes(m.type())) errors.push(m.text()); });
page.on('request', r => { if (/^https?:/.test(r.url())) external.push(r.url()); });
page.on('dialog', d => d.accept(d.type() === 'prompt' ? promptValue : undefined));
const tick = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
async function test(name, run){
  try { await run(); report.passed.push(name); console.log(`PASS ${name}`); }
  catch (e) {
    report.failed.push({ name, error:e.stack }); console.error(`FAIL ${name}: ${e.message}`);
    await page.screenshot({ path:join(output, `failure-${report.failed.length}.png`), fullPage:true });
  }
}
const edit = (id, value, event='input') => page.evaluate(({id,value,event}) => {
  $(id).value = value; $(id).dispatchEvent(new Event(event, { bubbles:true }));
}, {id,value,event});
async function press(selector){
  const target=page.locator(selector);
  await target.evaluate(el=>{for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
  await target.click();
}
async function jsonInput(id, data){
  await page.locator(`#${id}`).setInputFiles({ name:'qa.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(data)) });
  await tick();
}
async function download(action){
  const waiting = page.waitForEvent('download');
  await action();
  const item = await waiting;
  const path = join(output, item.suggestedFilename());
  // shortcut: 샌드박스 Chrome 다운로드가 취소되어 생성 Blob을 검증, 실 다운로드는 샌드박스 밖 수동 확인 필요.
  const encoded=await page.evaluate(async()=>{
    const blob=qa.downloadBlob;const bytes=new Uint8Array(await blob.arrayBuffer());
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(binary);
  });
  const bytes=Buffer.from(encoded,'base64');await writeFile(path,bytes);
  return { name:item.suggestedFilename(), path, bytes };
}
try {
  // Reuse existing state-machine coverage instead of duplicating its mock assertions.
  report.evidence.existingRegression = execFileSync(process.execPath, [join(root,'tools/check-recovery-export.mjs')],
    { cwd:root, encoding:'utf8' }).trim();
  await page.goto(pathToFileURL(join(root,'index.html')).href + '?v=persistence-' + Date.now());
  await tick();
  await test('빈 저장소 초기화 완료·콘솔 오류 0·외부 요청 0', async () => {
    assert.equal(await page.evaluate(() => state.shots.length), 0);
    assert.equal(await page.locator('#appearanceRow .gearadd').count(), 1);
    assert.equal(await page.locator('#layoutRow .gearadd').count(), 1);
    assert.equal(await page.locator('#logoRow button').count(), 2);
    assert.equal(await page.locator('#body').getAttribute('aria-label'), '카메라');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    report.evidence.pcFonts = await page.evaluate(async () => ({
      api:typeof window.queryLocalFonts, buttonDisabled:$('pcFontLoad').disabled,
      permission:await navigator.permissions.query({name:'local-fonts'}).then(x=>x.state).catch(()=> 'unsupported'),
    }));
    assert.equal(report.evidence.pcFonts.buttonDisabled, report.evidence.pcFonts.api !== 'function');
  });
  await page.evaluate(async () => {
    window.qa = { files:[], writes:[], aborts:0, closes:0, failName:'', failKind:'', cancel:false };
    const createURL=URL.createObjectURL.bind(URL);
    URL.createObjectURL=blob=>{qa.downloadBlob=blob;return createURL(blob);};
    for (const [index,w,h] of [[1,600,900],[2,900,600],[3,600,900]]){
      const c=document.createElement('canvas'); c.width=w;c.height=h;
      const ctx=c.getContext('2d'); ctx.fillStyle=['#258495','#c15a38','#657e38'][index-1];ctx.fillRect(0,0,w,h);
      // Texture gives JPEG quality a visible encoding workload.
      for(let y=0;y<h;y+=7) for(let x=0;x<w;x+=7){ctx.fillStyle=`rgb(${x%255},${y%255},${(x*y)%255})`;ctx.fillRect(x,y,3,3);}
      const blob=await new Promise(r=>c.toBlob(r));
      qa.files.push(new File([blob],`qa-${index}.png`,{type:'image/png',lastModified:1700000000000+index}));
    }
    qa.pick = async (id, files) => {
      const dt=new DataTransfer();files.forEach(f=>dt.items.add(f));const input=$(id);input.files=dt.files;
      await input.onchange({target:input});
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    };
    qa.pixels = async (canvas=state._pv.cv) => {
      const bytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      const hash=await crypto.subtle.digest('SHA-256',bytes);
      return {w:canvas.width,h:canvas.height,hash:[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('')};
    };
    qa.memory = () => {
      qa.writes=[];qa.closes=0;qa.aborts=0;qa.failName='';qa.failKind='';qa.cancel=false;
      qa.names=new Set();
      state.dirHandle={name:'QA-MOCK-NOT-DISK',async getFileHandle(name,options){
        if(!options?.create){if(qa.names.has(name))return {};throw new DOMException('absent','NotFoundError');}
        return {async createWritable(){return {
          async write(blob){
            if(name===qa.failName)throw new DOMException('injected write failure',qa.failKind||'UnknownError');
            qa.writes.push({name,blob});
            if(qa.cancel)$('exportCancel').click();
          },async close(){qa.closes++;qa.names.add(name);},async abort(){qa.aborts++;},
        };}};
      }};
    };
    qa.open = data => qa.pick('projectPicker',[new File([JSON.stringify(data)],'qa.photoframe.json',{type:'application/json'})]);
    await qa.pick('picker',qa.files);
  });
  await page.waitForFunction(() => state.shots.length===3 && state._pv);
  await press('#styleSeg [data-style="bottom"]');
  await edit('body','QA CAMERA'); await edit('lens','QA LENS'); await edit('film','QA FILM');
  await edit('caption','QA 메모');await edit('sigText','QA signature');await tick();

  await test('장비 3항목 저장·중복·빈값·적용 범위·삭제·새로고침 복원', async () => {
    for(const [key,label] of [['body','카메라'],['lens','렌즈'],['film','필름·기타']]){
      await press(`#gearGrid button[aria-label="${label} 프리셋 저장"]`);
      await press(`#gearGrid button[aria-label="${label} 프리셋 저장"]`);
      assert.equal(await page.evaluate(key=>gear[key].length,key),1);
    }
    await edit('body','');await press('#gearGrid button[aria-label="카메라 프리셋 저장"]');
    assert.equal(await page.evaluate(()=>gear.body.length),1);
    const before=await page.evaluate(()=>({lens:gInfo.lens,film:gInfo.film,own:state.shots.map(s=>s.own)}));
    await press('#gearGrid button[title="QA CAMERA"]');await tick();
    assert.equal(await page.locator('#body').inputValue(),'QA CAMERA');
    assert.deepEqual(await page.evaluate(()=>({lens:gInfo.lens,film:gInfo.film,own:state.shots.map(s=>s.own)})),before);
    const palette=await page.evaluate(()=>JSON.parse(localStorage.getItem('frame.gear')));
    assert.deepEqual(palette,{body:['QA CAMERA'],lens:['QA LENS'],film:['QA FILM']});
    await press('#gearGrid button[aria-label="QA FILM 삭제"]');
    assert.deepEqual(await page.evaluate(()=>gear.film),[]);
    // Keep fixture objects across this check; a separate context verifies saved initialization below.
    const restored=await context.newPage();
    restored.on('pageerror',e=>errors.push(e.message));
    await restored.goto(pathToFileURL(join(root,'index.html')).href+'?v=restored-'+Date.now());
    await restored.waitForFunction(()=>document.querySelector('#appearanceRow .gearadd'));
    assert.deepEqual(await restored.evaluate(()=>gear),{body:['QA CAMERA'],lens:['QA LENS'],film:[]});
    await restored.close();
  });
  await test('레이아웃 세로·가로 저장·적용·타 스타일 보존·삭제', async () => {
    const other=await page.evaluate(()=>JSON.stringify(adv.film));
    await edit('fontScale','125');await press('#advTab [data-t="land"]');await edit('bandScale','130');
    promptValue='QA 배치';await press('#layoutRow .gearadd');
    const pair=await page.evaluate(()=>JSON.parse(JSON.stringify(adv.bottom)));
    await edit('bandScale','100');await press('#layoutRow button[title="QA 배치"]');
    assert.deepEqual(await page.evaluate(()=>adv.bottom),pair);
    assert.equal(await page.evaluate(()=>JSON.stringify(adv.film)),other);
    await press('#layoutRow button[aria-label="QA 배치 삭제"]');
    assert.equal(await page.evaluate(()=>layouts.length),0);
    promptValue='QA 배치';await press('#layoutRow .gearadd');await tick();
  });
  await test('디자인 저장·적용은 촬영값·장별값·제목·장비 보존, 실제 픽셀 복원', async () => {
    await edit('ratio','1:1','change');await edit('fmt','jpeg','change');await edit('quality','78','change');
    await edit('title','원본 제목');await edit('fontEn','serif','change');await edit('fontKo','myeongjo','change');
    await tick();const pixels=await page.evaluate(()=>qa.pixels());
    promptValue='QA 디자인';await press('#appearanceRow .gearadd');
    assert.equal(await page.evaluate(()=> 'body' in appearances[0].settings || 'title' in appearances[0].settings),false);
    await edit('fontEn','mono','change');await edit('ratio','none','change');await edit('fmt','png','change');
    await edit('title','보존 제목');
    await page.evaluate(()=>{state.shots[1].own={lens:'장별 렌즈',film:null,show:{date:false}};});
    const scopes=await page.evaluate(()=>({info:{...gInfo},own:state.shots.map(s=>s.own),gear:JSON.stringify(gear)}));
    await press('#appearanceRow button[title="QA 디자인"]');await tick();
    assert.deepEqual(await page.evaluate(()=>({info:{...gInfo},own:state.shots.map(s=>s.own),gear:JSON.stringify(gear)})),scopes);
    assert.equal(await page.locator('#title').inputValue(),'보존 제목');
    assert.deepEqual(await page.evaluate(()=>qa.pixels()),pixels);
    assert.equal(await page.locator('#fmt').inputValue(),'jpeg');assert.equal(await page.locator('#quality').inputValue(),'78');
    await press('#appearanceRow button[aria-label="QA 디자인 삭제"]');
    assert.equal(await page.evaluate(()=>appearances.length),0);
  });
  await test('프리셋 JSON 다운로드 요청 Blob·병합·동명이름 보존·잘못된 입력 무변경', async () => {
    await page.evaluate(()=>state.dirHandle=null);
    const item=await download(()=>press('#presetExport'));
    const data=JSON.parse(item.bytes);report.evidence.presetDownload=item.path;
    assert.equal(data.kind,'photoframe-presets');
    assert.deepEqual(Object.keys(data).sort(),['exportedAt','gear','kind','layouts','version']);
    const before=await page.evaluate(()=>JSON.stringify({gear,layouts,settings:settingsSnapshot(),shots:state.shots.map(s=>s.name)}));
    await jsonInput('presetPicker',data);
    assert.equal(await page.evaluate(()=>JSON.stringify({gear,layouts,settings:settingsSnapshot(),shots:state.shots.map(s=>s.name)})),before);
    data.layouts[0].port.fontScale='150';await jsonInput('presetPicker',data);
    assert.deepEqual(await page.evaluate(()=>layouts.map(l=>l.name)),['QA 배치','QA 배치 (2)']);
    const merged=await page.evaluate(()=>JSON.stringify({gear,layouts}));
    data.gear.body=[42];await jsonInput('presetPicker',data);
    assert.equal(await page.evaluate(()=>JSON.stringify({gear,layouts})),merged);
  });
  await test('로고 실제 이미지 추가·중복 이름·선택·없음·삭제 및 픽셀 변화', async () => {
    await page.evaluate(async()=>{
      const c=document.createElement('canvas');c.width=800;c.height=160;
      c.getContext('2d').fillStyle='#ff00ee';c.getContext('2d').fillRect(0,0,800,160);
      const b=await new Promise(r=>c.toBlob(r));qa.logo=new File([b],'qa-logo.png',{type:'image/png'});
      await qa.pick('logoPicker',[qa.logo]);
    });
    await page.waitForFunction(()=>logoState.img && logoState.img.width===400);await tick();
    const active=await page.evaluate(()=>qa.pixels());
    await page.evaluate(()=>qa.pick('logoPicker',[qa.logo]));await page.waitForFunction(()=>logoState.img && logoState.name==='qa-logo(2)');
    await press('#logoRow button[aria-label="qa-logo(2) 삭제"]');await press('#logoRow button[title="qa-logo"]');
    await page.waitForFunction(()=>logoState.img);await tick();assert.deepEqual(await page.evaluate(()=>qa.pixels()),active);
    await press('#logoRow > button.gear');await tick();assert.notEqual((await page.evaluate(()=>qa.pixels())).hash,active.hash);
    await press('#logoRow button[title="qa-logo"]');await page.waitForFunction(()=>logoState.img);await tick();
    assert.equal(await page.evaluate(()=>logos.length),1);
  });
  await test('기본 영문 5종·한글 3종 선택 저장과 실제 렌더 차이', async () => {
    const hashes=[];
    for(const value of ['auto','mono','sans','serif','script']){
      await edit('fontEn',value,'change');await tick();hashes.push((await page.evaluate(()=>qa.pixels())).hash);
      assert.equal(await page.evaluate(()=>store.read('frame.settings').fontEn),value);
    }
    assert(new Set(hashes).size>=3,'영문 글꼴이 실제 합성 픽셀을 바꿔야 함');
    const ko=[];
    for(const value of ['gothic','myeongjo','script']){
      await edit('fontKo',value,'change');await tick();ko.push((await page.evaluate(()=>qa.pixels())).hash);
      assert.equal(await page.evaluate(()=>store.read('frame.settings').fontKo),value);
    }
    assert(new Set(ko).size>=2,'한글 글꼴이 실제 합성 픽셀을 바꿔야 함');
    report.evidence.defaultFontDistinctPixels={en:new Set(hashes).size,ko:new Set(ko).size};
  });
  let fontPath=process.env.QA_FONT_PATH;
  if(!fontPath){for(const candidate of ['C:/Windows/Fonts/arial.ttf','C:/Windows/Fonts/AGENCYR.TTF']){
    try{await access(candidate);fontPath=candidate;break;}catch{}
  }}
  if(fontPath) await test('설치된 로컬 글꼴 파일 실제 FontFace·중복 방지·양 언어 선택', async () => {
    await page.locator('#fontPicker').setInputFiles(fontPath);
    await page.waitForFunction(()=>state.fontBusy===0 && [...FONT_ENTRIES.values()].some(e=>e.source==='file'&&e.loaded));
    const value=await page.evaluate(()=>[...FONT_ENTRIES.values()].find(e=>e.source==='file').value);
    await page.locator('#fontPicker').setInputFiles(fontPath);await tick();
    assert.equal(await page.locator('#fontEnFile option').count(),1);
    await edit('fontEn',value,'change');await edit('fontKo',value,'change');await tick();
    assert.equal(await page.evaluate(()=>document.fonts.check(`16px "${FONT_ENTRIES.get($('fontEn').value).alias}"`)),true);
    report.evidence.fileFont={path:fontPath,value};
    const before=await page.evaluate(()=>[...FONT_ENTRIES.keys()]);
    await page.locator('#fontPicker').setInputFiles({name:'invalid.ttf',mimeType:'font/ttf',buffer:Buffer.from('invalid-font')});await tick();
    assert.deepEqual(await page.evaluate(()=>[...FONT_ENTRIES.keys()]),before);
  }); else report.limitations.push('사용 가능한 로컬 글꼴 파일 없음: 파일 글꼴 검사 미실행.');

  await test('프로젝트 다운로드 요청 Blob·사진 바이트 제외·활성 리소스·dirty·전체 복원 픽셀', async () => {
    await edit('title','QA:/프로젝트');await page.evaluate(()=>{state.current=1;drawStrip();syncFields();refresh();});await tick();
    const before=await page.evaluate(()=>qa.pixels());
    await page.evaluate(()=>state.dirHandle=null);
    const item=await download(()=>press('#projectSave'));
    const project=JSON.parse(item.bytes);report.evidence.projectDownload=item.path;
    assert.equal(item.name,'QA프로젝트.photoframe.json');assert.equal(project.photos.length,3);assert.equal(project.current,1);
    assert.equal(project.fonts.length,fontPath?1:0);assert.equal(project.activeLogo.name,'qa-logo');
    assert(project.photos.every(p=>!JSON.stringify(p).includes('data:')),'사진 manifest에는 원본 바이트가 없어야 함');
    assert.match(await page.locator('#projectStatus').textContent(),/저장 확인 필요/);
    assert.equal(await page.evaluate(()=>state.projectDirty),true);
    await page.evaluate(project=>{qa.project=project;},project);
    await page.evaluate(()=>qa.open(qa.project));
    assert.equal(await page.evaluate(()=>state.shots.length),0);
    assert.equal(await page.evaluate(()=>pendingProject.photos.length),3);
    await page.evaluate(()=>qa.pick('picker',[qa.files[2],qa.files[0],qa.files[1]]));
    await page.waitForFunction(()=>state.shots.length===3&&pendingProject===null&&logoState.img);await tick();
    assert.deepEqual(await page.evaluate(()=>state.shots.map(s=>s.name)),['qa-1.png','qa-2.png','qa-3.png']);
    assert.equal(await page.evaluate(()=>state.current),1);
    assert.deepEqual(await page.evaluate(()=>qa.pixels()),before);
    assert.equal(await page.evaluate(()=>state.projectDirty),false);
    report.evidence.projectPixelRoundTrip=before;
  });
  await test('부분 원본 0장·1장 저장 보존, 편집 dirty는 마지막 연결 뒤 유지', async () => {
    await page.evaluate(async()=>{await qa.open(qa.project);qa.memory();await $('projectSave').onclick();qa.zero=JSON.parse(await qa.writes[0].blob.text());});
    assert.equal(await page.evaluate(()=>qa.zero.photos.length),3);
    await page.evaluate(()=>qa.pick('picker',[qa.files[0]]));
    await press('#infoScope [data-scope="shot"]');await edit('caption','부분 편집 메모');
    await page.evaluate(async()=>{qa.memory();await $('projectSave').onclick();qa.partial=JSON.parse(await qa.writes[0].blob.text());});
    assert.equal(await page.evaluate(()=>qa.partial.photos[0].own.caption),'부분 편집 메모');
    assert.equal(await page.evaluate(()=>qa.partial.photos[1].own.film),null);
    assert.equal(await page.evaluate(()=>qa.partial.photos[1].own.show.date),false);
    assert.match(await page.locator('#projectNote').textContent(),/미연결 2장 정보 포함/);
    assert.equal(await page.evaluate(()=>state.projectDirty),false);
    await edit('lens','부분 편집 렌즈');
    await page.evaluate(()=>qa.pick('picker',[qa.files[2],qa.files[1]]));await tick();
    assert.equal(await page.evaluate(()=>state.projectDirty),true);
    assert.equal(await page.evaluate(()=>pendingProject),null);
    assert.equal(await page.evaluate(()=>state.shots[0].own.lens),'부분 편집 렌즈');
  });
  await test('새 브라우저 컨텍스트 프로젝트 복원·파일 글꼴 재등록·동명 로고 병합·픽셀 일치', async () => {
    const freshContext=await browser.newContext({viewport:{width:1440,height:1000}});
    const restored=await freshContext.newPage();
    restored.on('pageerror',e=>errors.push(e.message));
    restored.on('console',m=>{if(['error','assert'].includes(m.type()))errors.push(m.text());});
    restored.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
    restored.on('dialog',d=>d.accept());
    try {
      await restored.goto(pathToFileURL(join(root,'index.html')).href+'?v=clean-project-'+Date.now());
      assert.equal(await restored.evaluate(()=>FONT_ENTRIES.size),0);
      const project=await page.evaluate(()=>qa.project);
      // An existing personal logo with the same name must survive opening another project.
      await restored.evaluate(()=>{
        const c=document.createElement('canvas');c.width=50;c.height=20;
        c.getContext('2d').fillStyle='#0022ff';c.getContext('2d').fillRect(0,0,50,20);
        logos.push({name:'qa-logo',data:c.toDataURL()});store.write('frame.logos',logos);
      });
      await restored.locator('#projectPicker').setInputFiles({name:'clean.photoframe.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
      await restored.waitForFunction(()=>pendingProject!==null&&state.fontBusy===0);
      assert.equal(await restored.evaluate(()=>logos.length),2);
      assert.equal(await restored.evaluate(()=>logoState.name),'qa-logo (프로젝트)');
      if(fontPath)assert.equal(await restored.evaluate(()=>FONT_ENTRIES.get($('fontEn').value)?.loaded),true);
      for(const id of ['fontEn','fontKo','sigText','ratio','fmt','quality','title'])
        assert.equal(await restored.locator(`#${id}`).inputValue(),project.settings[id],id);
      const files=await page.evaluate(async()=>Promise.all(qa.files.map(async f=>({name:f.name,type:f.type,lastModified:f.lastModified,bytes:[...new Uint8Array(await f.arrayBuffer())]}))));
      await restored.evaluate(async files=>{
        const dt=new DataTransfer();for(const f of files)dt.items.add(new File([new Uint8Array(f.bytes)],f.name,{type:f.type,lastModified:f.lastModified}));
        $('picker').files=dt.files;$('picker').onchange({target:$('picker')});
      },files);
      await restored.waitForFunction(()=>state.shots.length===3&&pendingProject===null&&logoState.img&&state._pv);
      await restored.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      const actual=await restored.evaluate(async()=>{
        const c=state._pv.cv;const hash=await crypto.subtle.digest('SHA-256',c.getContext('2d').getImageData(0,0,c.width,c.height).data);
        return {w:c.width,h:c.height,hash:[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('')};
      });
      assert.deepEqual(actual,report.evidence.projectPixelRoundTrip);
      await restored.screenshot({path:join(output,'clean-project-restored.png'),fullPage:true});
    } finally {await freshContext.close();}
  });
  await test('잘못된 프로젝트는 현재 사진·장별값·설정 무변경', async () => {
    const before=await page.evaluate(()=>JSON.stringify({settings:settingsSnapshot(),photos:state.shots.map(s=>({name:s.name,own:s.own}))}));
    await jsonInput('projectPicker',{kind:'photoframe-project',version:2,photos:[{file:null}]});
    assert.equal(await page.evaluate(()=>JSON.stringify({settings:settingsSnapshot(),photos:state.shots.map(s=>({name:s.name,own:s.own}))})),before);
  });
  await test('PNG 다운로드 요청 Blob·현재 순번·사전검사 무저장·미리보기와 동일 픽셀', async () => {
    await edit('fmt','png','change');await edit('ratio','none','change');await edit('title','QA:/출력');
    await page.evaluate(()=>{state.dirHandle=null;state.current=1;state.batch=new Set([state.shots[0]]);drawStrip();syncFields();refresh();});await tick();
    assert.equal(await page.locator('#qualityField').evaluate(el=>el.hidden),true);
    await press('#exportOne');await page.waitForFunction(()=>state.exportPlan!==null);
    assert.equal(await page.locator('#exportItems li').count(),1);
    assert.match(await page.locator('#exportItems').textContent(),/QA출력\(2\).png/);
    const before=await page.evaluate(()=>qa.pixels());
    const item=await download(()=>press('#exportStart'));
    await page.waitForFunction(()=>!state.exportBusy);assert.equal(item.name,'QA출력(2).png');
    assert.deepEqual([...item.bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    const actual=await page.evaluate(async base64=>{
      const b=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'image/png'});const im=await createImageBitmap(b);
      const c=document.createElement('canvas');c.width=im.width;c.height=im.height;c.getContext('2d').drawImage(im,0,0);return qa.pixels(c);
    },item.bytes.toString('base64'));
    assert.deepEqual(actual,before);
    assert.match(await page.locator('#exportStatus').textContent(),/1장 다운로드 요청/);
    report.evidence.pngPixelEquality={path:item.path,...actual};
  });
  await test('모든 비율·JPEG 품질 양끝·PNG/JPEG 헤더·제목 없을 때 원본명', async () => {
    await page.evaluate(()=>{qa.memory();state.batch.clear();});await edit('title','');
    const dimensions=[];
    for(const [ratio,target] of [['none',null],['3:4',.75],['4:5',.8],['1:1',1],['1.91:1',1.91],['9:16',9/16]]){
      await edit('ratio',ratio,'change');await press('#exportOne');await page.waitForFunction(()=>state.exportPlan);
      const expected=(await page.locator('#exportItems li').textContent()).match(/약 (\d+) × (\d+)px/);
      await press('#exportStart');await page.waitForFunction(()=>!state.exportBusy);
      const result=await page.evaluate(async()=>{const w=qa.writes.at(-1),im=await createImageBitmap(w.blob);return {name:w.name,w:im.width,h:im.height,type:w.blob.type};});
      assert.deepEqual([result.w,result.h],[Number(expected[1]),Number(expected[2])],'사전검사 예상 크기와 실제 출력 크기');
      if(target)assert(Math.abs(result.w/result.h-target)<.004,ratio);
      assert.match(result.name,/qa-2_framed/);assert.equal(result.type,'image/png');dimensions.push({ratio,...result});
    }
    await edit('fmt','jpeg','change');assert.equal(await page.locator('#qualityField').evaluate(el=>el.hidden),false);
    const bytes=[];
    for(const quality of ['50','100']){
      await edit('quality',quality,'change');await press('#exportOne');await page.waitForFunction(()=>state.exportPlan);
      await press('#exportStart');await page.waitForFunction(()=>!state.exportBusy);
      bytes.push(await page.evaluate(async()=>{const x=qa.writes.at(-1);return {size:x.blob.size,type:x.blob.type,header:[...new Uint8Array(await x.blob.slice(0,3).arrayBuffer())],name:x.name};}));
    }
    assert.deepEqual(bytes[0].header,[255,216,255]);assert.equal(bytes[0].type,'image/jpeg');
    assert.match(bytes[0].name,/\.jpg$/);assert(bytes[1].size>bytes[0].size);
    report.evidence.outputRatios=dimensions;report.evidence.jpegQuality=bytes;
  });
  await test('이전 출력 크기·사용자 패딩색은 프로젝트에 보존되고 실제 출력에 적용', async () => {
    await edit('fmt','png','change');await edit('ratio','9:16','change');
    await edit('ratioBg','custom','change');await edit('ratioCustom','#123456');await edit('size','1440','change');
    await page.evaluate(()=>qa.memory());await press('#exportOne');await page.waitForFunction(()=>state.exportPlan);
    await press('#exportStart');await page.waitForFunction(()=>!state.exportBusy);
    const result=await page.evaluate(async()=>{
      const im=await createImageBitmap(qa.writes.at(-1).blob);const c=document.createElement('canvas');c.width=im.width;c.height=im.height;
      c.getContext('2d').drawImage(im,0,0);return {w:c.width,h:c.height,corner:[...c.getContext('2d').getImageData(0,0,1,1).data]};
    });
    assert.equal(result.h,1440);assert.equal(result.w,810);assert.deepEqual(result.corner,[18,52,86,255]);
    await press('#projectSave');await page.waitForFunction(()=>qa.writes.at(-1)?.blob.type==='application/json');
    const saved=await page.evaluate(async()=>JSON.parse(await qa.writes.at(-1).blob.text()));
    assert.equal(saved.settings.size,'1440');assert.equal(saved.settings.ratioBg,'custom');assert.equal(saved.settings.ratioCustom,'#123456');
    report.evidence.legacyExport=result;
    await edit('size','2048','change');await edit('ratioBg','frame','change');
  });
  await test('전체 범위·모의 폴더 이름 충돌·일반 오류 지속·권한 단절 중단·사진 간 취소', async () => {
    await edit('title','폴더검사');await edit('fmt','png','change');await edit('ratio','none','change');
    await page.evaluate(()=>{qa.memory();qa.names.add('폴더검사(1).png');qa.names.add('폴더검사(1) (2).png');});
    await press('#exportAll');await page.waitForFunction(()=>state.exportPlan);assert.equal(await page.locator('#exportItems li').count(),3);
    await press('#exportStart');await page.waitForFunction(()=>!state.exportBusy);
    assert.deepEqual(await page.evaluate(()=>qa.writes.map(x=>x.name)),['폴더검사(1) (3).png','폴더검사(2).png','폴더검사(3).png']);
    assert.match(await page.locator('#exportStatus').textContent(),/3장 저장 확인.*1개 이름 변경/);
    await page.evaluate(()=>{qa.memory();qa.failName='폴더검사(2).png';});
    await press('#exportAll');await page.waitForFunction(()=>state.exportPlan);await press('#exportStart');await page.waitForFunction(()=>!state.exportBusy);
    assert.deepEqual(await page.evaluate(()=>qa.writes.map(x=>x.name)),['폴더검사(1).png','폴더검사(3).png']);
    assert.equal(await page.evaluate(()=>qa.aborts),1);assert.equal(await page.evaluate(()=>state.lastExportMetrics.failed),1);
    await page.evaluate(()=>{qa.memory();qa.failName='폴더검사(1).png';qa.failKind='NotAllowedError';});
    await press('#exportAll');await page.waitForFunction(()=>state.exportPlan);await press('#exportStart');await page.waitForFunction(()=>!state.exportBusy);
    assert.equal(await page.evaluate(()=>qa.writes.length),0);assert.equal(await page.evaluate(()=>qa.aborts),1);
    assert.equal(await page.evaluate(()=>state.lastExportMetrics.failed),3);assert.match(await page.locator('#exportStatus').textContent(),/폴더 권한/);
    await page.evaluate(()=>{qa.memory();qa.cancel=true;});
    await press('#exportAll');await page.waitForFunction(()=>state.exportPlan);await press('#exportStart');await page.waitForFunction(()=>!state.exportBusy);
    assert.equal(await page.evaluate(()=>qa.writes.length),1);
    assert.equal(await page.evaluate(()=>state.lastExportMetrics.cancelled),2);
    assert.match(await page.locator('#exportStatus').textContent(),/2장 취소됨/);
    report.evidence.folderMock='실제 save()/availableName()/toBlob() 실행, 디스크 핸들만 메모리 mock';
  });
  await test('사전검사 취소·설정 변경 시 계획 폐기·최종 콘솔 오류 0·외부 요청 0', async () => {
    await page.evaluate(async()=>{
      const preparing=$('exportAll').onclick();$('exportCancel').click();await preparing;
    });
    assert.equal(await page.evaluate(()=>state.exportPlan),null);
    assert.match(await page.locator('#exportStatus').textContent(),/사전 확인을 취소/);
    await press('#exportOne');await page.waitForFunction(()=>state.exportPlan);await edit('title','설정 변경');
    assert.equal(await page.evaluate(()=>state.exportPlan),null);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  });
  await page.screenshot({path:join(output,'final.png'),fullPage:true});
} finally {
  report.evidence.errors=errors;report.evidence.external=external;
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
  await browser.close();
  console.log(`보고서: ${join(output,'report.json')}`);
}
if(report.failed.length)process.exitCode=1;
