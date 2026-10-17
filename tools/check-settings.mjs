// Optional local QA; uses an existing Playwright installation without adding app dependencies.
// PLAYWRIGHT_MODULE and CHROME_PATH follow check-browser.mjs. Artifacts always stay in TEMP.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = await mkdtemp(join(tmpdir(), 'photoframe-settings-'));
const sourceHash = async () => createHash('sha256').update(await readFile(join(root,'index.html'))).digest('hex');
const report = { started:new Date().toISOString(), sourceBefore:await sourceHash(), output,
  cases:[], inventory:[], notes:[], errors:[], external:[], skipped:[
    '정렬 API·정렬 버튼 동작: 주 담당의 check-alignment.mjs 소유 범위',
    'legacy tone, size, ratioBg, ratioCustom: 숨겨진 이전 저장값 호환 입력으로 신규 UI 조작에서 제외',
    '인스탁스 lines: 카드 고정 2단 배치이므로 숨김; matte/keyline bandScale: 네 변 동일 여백이므로 숨김',
    'PC 글꼴 권한·실제 폰트 파일·실제 저장 폴더 권한: 실사용 리소스와 사용자 권한 없이 통과로 판정하지 않음',
    '실제 카메라 JPEG/회전 EXIF·모바일 실기기/가상 키보드·Safari·36장 메모리: 이번 합성 PNG/Chrome 검사 범위 밖',
  ] };
const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : {}) });
report.browser = browser.version();
const context = await browser.newContext({ viewport:{width:1440,height:1000} });
const page = await context.newPage();
page.setDefaultTimeout(6000);
page.on('pageerror', e => report.errors.push(e.message));
page.on('console', m => { if (['error','assert'].includes(m.type())) report.errors.push(m.text()); });
// Abort accidental external requests before any bytes of synthetic fixtures can be sent.
await context.route(/^https?:/, route => { report.external.push(route.request().url()); return route.abort(); });
page.on('dialog', d => d.accept(d.type()==='prompt' ? '설정 QA 프리셋' : undefined));
const tick = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const styles = ['film','instax','bottom','top','matte','gallery','keyline','minimal'];
const values = {body:'Camera 한글',lens:'50mm',film:'Film',date:'2026.07.19',set:'F1.8 · 1/250s · ISO 400 · 35mm',caption:'메모 Memo'};
let pixels = 0;
async function run(name, fn){
  try { const evidence=await fn(); report.cases.push({name,ok:true,evidence}); }
  catch(e){
    const screenshot=join(output,`failure-${report.cases.length+1}.png`);
    await page.screenshot({path:screenshot,fullPage:false}).catch(()=>{});
    report.cases.push({name,ok:false,error:e.stack,screenshot});
    console.error(`실패: ${name}: ${e.message}`);
  }
}
async function click(selector){ await page.locator(selector).click(); await tick(); }
async function fill(id,value){
  const el=page.locator('#'+id); await el.fill(String(value)); await el.press('Tab'); await tick();
}
async function select(id,value){ await page.locator('#'+id).selectOption(String(value)); await tick(); }
async function panel(id,open=true){
  if(await page.locator('#'+id).evaluate(el=>el.open)!==open) await click('#'+id+' > summary');
}
async function photo(index){
  await page.locator(`#strip .chip:nth-child(${index+1})`).click({position:{x:40,y:30}}); await tick();
}
async function style(name){ await click(`#styleSeg [data-style="${name}"]`); }
async function snapshot(){
  pixels++;
  return page.evaluate(()=>{
    const c=state._pv.raw,ctx=c.getContext('2d'),data=ctx.getImageData(0,0,c.width,c.height).data;
    const words=new Uint32Array(data.buffer); let hash=2166136261;
    for(const n of words) hash=Math.imul(hash^n,16777619)>>>0;
    const p=state._pv.photo;
    const sample=(x,y)=>[...ctx.getImageData(Math.max(0,Math.floor(x)),Math.max(0,Math.floor(y)),1,1).data];
    return {hash,width:c.width,height:c.height,photo:p,boxes:state._pv.boxes,
      center:p?sample(p.x+p.w/2,p.y+p.h/2):null,corner:sample(0,0),
      paper:sample(0,['bottom','minimal'].includes(state.style)?c.height-1:0)};
  });
}
async function reset(index=0,name='bottom'){
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{
    closeSettings(false); resetAdv(); clearLayoutUndo(); state.batch.clear(); state.infoScope='global';
    state.shots.forEach(s=>{s.own={};s.exif={};});
    Object.keys(gShow).forEach(k=>gShow[k]=true); Object.keys(metadataShow).forEach(k=>metadataShow[k]=true);
    $('dateFormat').value='original';$('fontEn').value='auto';$('fontKo').value='gothic';
    $('sigText').value='Signature';logoState.name='';logoState.img=null;drawLogos();
    state.frameColors={};state.legacyBandTones={};
    $('ratio').value='none';$('fmt').value='png';$('fmt').onchange();
    $('uiWidth').value='500';$('uiScale').value='100';$('uiTheme').value='light';applyUi();
    state.current=0;drawStrip();syncMetadataVisibility();syncFields();syncAdv();refresh();
  }); await tick();
  await photo(index);await style(name);await panel('dispPanel',false);await panel('dispPanel');
  for(const [id,value] of Object.entries(values)) await fill(id,value);
}
async function loadPhotos(){
  const files=await page.evaluate(()=>[[600,900],[900,600],[700,700]].map(([w,h],i)=>{
    const c=document.createElement('canvas');c.width=w;c.height=h;
    const x=c.getContext('2d');x.fillStyle='#39798a';x.fillRect(0,0,w,h);
    x.fillStyle='#cc7733';x.fillRect(0,0,w/5,h/5);
    return {name:`settings-${i}.png`,data:c.toDataURL('image/png').split(',')[1]};
  }));
  await page.locator('#picker').setInputFiles(files.map(f=>({name:f.name,mimeType:'image/png',buffer:Buffer.from(f.data,'base64')})));
  await page.waitForFunction(()=>state.shots.length===3&&state._pv); await tick();
}
async function inventory(stage){
  report.inventory.push({stage,controls:await page.evaluate(()=>[...document.querySelectorAll('button,input,select,textarea,summary,a[href]')].map(el=>({
    tag:el.tagName,id:el.id,label:el.getAttribute('aria-label')||el.title||el.textContent.trim().slice(0,90),
    data:{...el.dataset},type:el.type,hidden:!el.checkVisibility(),disabled:!!el.disabled,
    min:el.min,max:el.max,options:el.tagName==='SELECT'?[...el.options].map(o=>({value:o.value,label:o.textContent,hidden:o.hidden})):undefined,
  })))});
}

try {
  await page.goto(pathToFileURL(join(root,'index.html')).href+'?v=settings-'+Date.now());await tick();
  await inventory('빈 localStorage 초기 화면');
  await run('신선 로드 init 완료·빈 기본값·콘솔·외부 요청',async()=>{
    assert.equal(await page.evaluate(()=>localStorage.getItem('frame.settings')),null);
    assert.equal(await page.locator('#styleSeg button').count(),8);
    assert.equal(await page.locator('#logoRow button').count(),2);
    assert.equal(await page.locator('#layoutRow button').count(),1);
    assert.equal(await page.locator('#appearanceRow button').count(),1);
    assert.equal(await page.locator('#movePanel').evaluate(el=>el.open),false);
    for(const id of Object.keys(values)) assert.equal(await page.locator('#'+id).inputValue(),'');
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);
  });
  await loadPhotos();await reset();
  for(const id of ['toneField','presetPanel','appearancePanel','movePanel']) await panel(id);
  await inventory('사진 3장·접이식 패널 펼침');
  await click('#gearBtn');await inventory('개인 설정');await click('#closeSettings');
  console.log(`설정 컨트롤 인벤토리 확보 · ${output}`);

  // UI-driven matrix: real uploaded PNGs; source pixel and displayed paper checks use fixed fixture colors.
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:width===320?640:1000});
    for(const name of styles) for(const index of [0,1,2]) for(const side of name==='instax'&&index===1?['stack','rotate']:['stack']){
      await run(`화면 ${width}px/${name}/${['세로','가로','정방형'][index]}/${side}`,async()=>{
        await photo(index);await style(name);await panel('dispPanel',false);await panel('dispPanel');
        const dir=index===1?'land':'port';
        assert.equal(await page.locator(`#advTab [data-t="${dir}"]`).getAttribute('aria-pressed'),'true');
        if(name==='instax'&&index===1) await select('sideText',side);
        const shot=await snapshot();
        assert(shot.width>= [600,900,700][index] && shot.height>=[900,600,700][index]);
        if(shot.center) assert.deepEqual(shot.center,[57,121,138,255],'사진 중앙의 실제 픽셀 보존');
        if(name==='instax') assert.deepEqual(shot.corner,[255,255,255,255],'인스탁스 종이는 흰색');
        const layout=await page.evaluate(()=>{
          const r=pv.getBoundingClientRect(),v=vp.getBoundingClientRect(),b=$('zoombar').getBoundingClientRect();
          return {overflow:document.documentElement.scrollWidth-innerWidth,
            usable:Math.min(r.bottom,b.top)-Math.max(r.top,v.top),top:v.top,
            controls:[...$('settingsRail').querySelectorAll('input,select,button')].filter(el=>el.checkVisibility()).map(el=>{
              const q=el.getBoundingClientRect();return {id:el.id||el.getAttribute('aria-label')||el.textContent.trim(),left:q.left,right:q.right};
            }).filter(q=>q.left< -1||q.right>innerWidth+1)};
        });
        assert(layout.overflow<=1,JSON.stringify(layout));
        assert(layout.usable>=70,`실제 보이는 사진 높이 ${layout.usable}`);
        assert.deepEqual(layout.controls,[],'설정 컨트롤이 가로로 잘리지 않아야 함');
        assert.equal(await page.locator('#lines').isVisible(),name!=='instax');
        assert.equal(await page.locator('#bandScale').isVisible(),!['matte','keyline'].includes(name));
        assert.equal(await page.locator('#borderScale').isVisible(),['instax','matte','gallery','keyline'].includes(name));
        assert.equal(await page.locator('#sideText').isVisible(),name==='instax'&&index===1);
        return {hash:shot.hash,width:shot.width,height:shot.height,usable:layout.usable};
      });
    }
    await page.screenshot({path:join(output,`screen-${width}.png`)});
    console.log(`8종 × 세로/가로/정방형 · ${width}px 검사 완료`);
  }

  // Every offered layout control must have an observable effect in the appropriate direction only.
  for(const name of styles) for(const index of [0,1,2]){
    await run(`설정 픽셀·방향 격리 ${name}/${index}`,async()=>{
      await reset(index,name);const observations=[];
      const baseline=await snapshot();
      // A large signature can already fill Instax's available width; shrink it to test the offered scale.
      for(const [id,value] of [['lines','2'],['fontScale','135'],['bandScale','160'],['borderScale','170'],['logoScale','50']]){
        if(!await page.locator('#'+id).isVisible()) continue;
        const before=await snapshot();
        if(id==='lines') await select(id,value);else await fill(id,value);
        const after=await snapshot();
        assert.notEqual(after.hash,before.hash,`${name}/${index}/${id}: 조작 후 합성 픽셀 불변`);
        observations.push({id,before:before.hash,after:after.hash,width:after.width,height:after.height});
        if(id==='lines') await select(id,'1');else await fill(id,'100');
      }
      for(const [id,key] of [['showBody','body'],['showLens','lens'],['showFilm','film'],['showSet','set'],['showDate','date'],['showCaption','cap']]){
        const before=await snapshot();await click(`.eye[data-for="${id}"]`);const after=await snapshot();
        assert.notEqual(after.hash,before.hash,`${name}/${index}/${id}: 숨김이 실제 픽셀에 반영되지 않음`);
        assert(!after.boxes.some(b=>b.key===key));await click(`.eye[data-for="${id}"]`);
      }
      const shown=await snapshot();
      await click(`#advTab [data-t="${index===1?'port':'land'}"]`);await fill('fontScale','160');
      assert.equal((await snapshot()).hash,shown.hash,'반대 방향 프로파일 변경은 현재 사진에 적용되지 않음');
      await click(`#advTab [data-t="${index===1?'land':'port'}"]`);
      assert.equal(await page.locator('#fontScale').inputValue(),'100','현재 방향의 크기는 보존됨');
      return {baseline:baseline.hash,observations};
    });
  }
  console.log('전스타일 크기·줄 수·표시 토글·방향 격리 검사 완료');

  for(const side of ['stack','rotate']) await run(`가로 인스탁스 전체 조작 ${side}`,async()=>{
    await reset(1,'instax');await select('sideText',side);await panel('movePanel');
    const before=await snapshot();
    await select('moveElement','body');await select('moveStep','.005'.replace(/^\./,'0.'));
    await click('#moveButtons [data-dx="1"]');const moved=await snapshot();
    assert.notEqual(moved.hash,before.hash);
    assert(Math.abs(moved.boxes.find(b=>b.key==='body').x-before.boxes.find(b=>b.key==='body').x-4.5)<=.51,'가로 사진 폭 900의 0.5% 이동, 최대 반 픽셀 반올림');
    assert.equal(await page.evaluate(()=>adv.instax.land.bodyDX),'0.005','저장 비율은 0.5% 그대로 유지');
    await click('#zUndo');assert.equal((await snapshot()).hash,before.hash,'되돌리기가 실제 렌더 복원');
    for(const [id,option] of [['fontEn','serif'],['fontKo','myeongjo']]){
      const prior=await snapshot();await select(id,option);
      assert.notEqual((await snapshot()).hash,prior.hash,`${side}/${id}: 실제 문자 픽셀 변화`);
    }
    for(const field of ['aperture','shutter','iso','focal']){
      const prior=await snapshot();await click(`#metadataVisibility [data-meta="${field}"]`);
      assert.notEqual((await snapshot()).hash,prior.hash,`${side}/${field}: 노출 항목 숨김`);
      assert.equal(await page.locator('#set').inputValue(),values.set,'노출 원문 보존');
      await click(`#metadataVisibility [data-meta="${field}"]`);
    }
    for(const fmt of ['hyphen','korean','month','dots']){
      await select('dateFormat','original');const prior=await snapshot();await select('dateFormat',fmt);
      const after=await snapshot();
      if(fmt!=='dots') assert.notEqual(after.hash,prior.hash,`${side}/${fmt}: 날짜 출력 형식`);
      assert.equal(await page.locator('#date').inputValue(),values.date);
    }
    return {before:before.hash,moved:moved.hash};
  });

  await run('가로 인스탁스 서명 크기 상한·방향 탭 구분',async()=>{
    await reset(1,'instax');const before=await snapshot();await fill('logoScale','160');const enlarged=await snapshot();
    await fill('logoScale','50');const shrunk=await snapshot();assert.notEqual(shrunk.hash,before.hash);
    if(enlarged.hash===before.hash) report.notes.push({
      behavior:'가로 인스탁스 긴 텍스트 서명은 사용 가능한 폭에 맞춰 제한되므로 100→160%에서 픽셀이 같을 수 있음. 50% 축소는 실제 변경됨.',
      source:'index.html drawLogo()의 maxH/maxW 제한',width:before.boxes.find(b=>b.key==='logo')?.w});
    await photo(0);
    const tab=await page.locator('#advTab [aria-pressed="true"]').getAttribute('data-t');
    report.notes.push({behavior:'펼친 레이아웃 패널에서 사진만 바꾸면 선택 방향 탭은 유지된다. 반대 방향 편집은 현재 사진을 바꾸지 않으며 패널을 다시 열면 현재 사진 방향으로 맞춘다.',
      selectedTab:tab,currentPhoto:'세로',scope:await page.locator('#layoutScope').textContent()});
    await panel('dispPanel',false);await panel('dispPanel');
    assert.equal(await page.locator('#advTab [aria-pressed="true"]').getAttribute('data-t'),'port');
  });

  await run('모든 시스템 글꼴·여백 슬라이더·레이아웃 프리셋',async()=>{
    await reset(0,'gallery');const hashes={};
    for(const [id,options] of [['fontEn',['auto','mono','sans','serif','script']],['fontKo',['gothic','myeongjo','script']]]){
      hashes[id]=[];
      for(const option of options){await select(id,option);hashes[id].push({option,hash:(await snapshot()).hash});}
      assert(new Set(hashes[id].map(o=>o.hash)).size>1,`${id}: 시스템 글꼴 선택의 픽셀 변화`);
    }
    const before=await snapshot();
    await page.locator('#borderScaleRange').focus();await page.locator('#borderScaleRange').press('End');await page.locator('#borderScaleRange').press('Tab');await tick();
    assert.equal(await page.locator('#borderScale').inputValue(),'300');assert.notEqual((await snapshot()).hash,before.hash);
    await click('#zUndo');assert.equal((await snapshot()).hash,before.hash);
    await fill('fontScale','135');await click('#layoutRow .gearadd');const saved=await snapshot();
    await fill('fontScale','180');await click('#layoutRow button[title="설정 QA 프리셋"]');assert.equal((await snapshot()).hash,saved.hash);
    await click('#layoutReset');assert.notEqual((await snapshot()).hash,saved.hash);
    await click('#zUndo');assert.equal((await snapshot()).hash,saved.hash);
    return hashes;
  });

  await run('촬영 정보 current/batch/global·상속·혼합·전역 복귀',async()=>{
    await reset(0);const global=await snapshot();
    await click('#infoScope [data-scope="shot"]');await fill('body','Current only');
    assert.notEqual((await snapshot()).hash,global.hash);
    await photo(1);assert.equal(await page.locator('#body').inputValue(),values.body);
    await page.locator('#strip .chip:nth-child(1) .pick').check();await tick();
    await page.locator('#strip .chip:nth-child(2) .pick').check();await tick();
    assert.equal(await page.locator('#body').getAttribute('data-mixed'),'true');
    await fill('lens','Batch lens');await click('.eye[data-for="showFilm"]');
    const edited=await page.evaluate(()=>state.shots.map(s=>({body:s.own.body,lens:s.own.lens,show:s.own.show})));
    assert.equal(edited[0].body,'Current only');assert.equal(edited[1].body,undefined);
    assert.deepEqual(edited.map(s=>s.lens),['Batch lens','Batch lens',undefined]);
    assert.deepEqual(edited.map(s=>s.show?.film),[false,false,undefined]);
    await click('#infoScope [data-scope="global"]');await fill('lens','New global');
    assert.deepEqual(await page.evaluate(()=>state.shots.map(s=>withShot(opts(),s).lens)),['Batch lens','Batch lens','New global']);
    await click('#infoScope [data-scope="shot"]');await click('.basebadge[data-k="lens"]');
    assert.deepEqual(await page.evaluate(()=>state.shots.map(s=>withShot(opts(),s).lens)),['New global','New global','New global']);
    await click('#batchAll');assert.equal(await page.evaluate(()=>state.batch.size),3);
    await click('#batchAll');assert.equal(await page.evaluate(()=>state.batch.size),0);
    return edited;
  });

  await run('8종 색상·HEX 오류·로컬 이미지 로고·로고 크기',async()=>{
    await reset(0);const samples=[];
    for(const name of styles){
      await style(name);
      if(['film','instax'].includes(name)){assert.equal(await page.locator('#toneField').isVisible(),false);continue;}
      await panel('toneField');
      for(const hex of ['#000000','#ffffff','#aabbcc']){
        await fill('frameHex',hex);const shot=await snapshot();
        assert.deepEqual(shot.paper,hex.match(/\w\w/g).map(s=>parseInt(s,16)).concat(255),`${name} 색상이 합성 픽셀에 반영`);
        samples.push({name,hex,hash:shot.hash});
      }
      const before=await snapshot();await fill('frameHex','#zzzzzz');assert.equal((await snapshot()).hash,before.hash,'잘못된 HEX 무시');
    }
    await style('gallery');
    const data=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=80;c.height=32;const x=c.getContext('2d');
      x.fillStyle='#fb137e';x.fillRect(0,0,80,32);return c.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#logoPicker').setInputFiles({name:'settings-logo.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
    await page.waitForFunction(()=>logoState.img);await tick();const before=await snapshot();
    await fill('logoScale','180');assert.notEqual((await snapshot()).hash,before.hash);
    const logoPixels=await page.evaluate(()=>{
      const c=state._pv.raw,a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;
      for(let i=0;i<a.length;i+=4) if(a[i]===251&&a[i+1]===19&&a[i+2]===126)count++;return count;
    });assert(logoPixels>20,'실제 로고 원래 색 픽셀이 합성됨');
    await click('#logoRow > button.gear');assert.notEqual((await snapshot()).hash,before.hash);
    return {samples,logoPixels};
  });

  await run('모든 스타일·방향 저장 범위와 디자인 프리셋 복원',async()=>{
    await reset();
    for(const [i,name] of styles.entries()){
      await style(name);
      for(const [dir,value] of [['port',110+i],['land',140+i]]){
        await click(`#advTab [data-t="${dir}"]`);await fill('fontScale',value);
        if(name==='instax'&&dir==='land') await select('sideText','rotate');
      }
    }
    await panel('appearancePanel');await click('#appearanceRow .gearadd');
    const expected=await page.evaluate(()=>JSON.parse(JSON.stringify(adv)));
    for(const [i,name] of styles.entries()){
      assert.equal(expected[name].port.fontScale,String(110+i));
      assert.equal(expected[name].land.fontScale,String(140+i));
    }
    await fill('body','프리셋이 덮으면 안 되는 촬영 정보');
    await fill('fontScale','199');await click('#appearanceRow button[title="설정 QA 프리셋"]');
    assert.deepEqual(await page.evaluate(()=>JSON.parse(JSON.stringify(adv))),expected,'디자인이 모든 스타일의 두 방향 복원');
    assert.equal(await page.locator('#body').inputValue(),'프리셋이 덮으면 안 되는 촬영 정보');
    await page.reload();await tick();
    assert.deepEqual(await page.evaluate(()=>JSON.parse(JSON.stringify(adv))),expected,'새로고침 후 16개 프로파일 복원');
    await loadPhotos();await photo(1);await style('instax');await panel('dispPanel',false);await panel('dispPanel');
    assert.equal(await page.locator('#sideText').inputValue(),'rotate');
    return expected;
  });

  for(const width of [1440,768,390,320]) await run(`개인 설정·접근성·화면 전용 변화 ${width}px`,async()=>{
    await reset(1,'instax');await page.setViewportSize({width,height:width===320?640:844});
    const before=await snapshot();
    await click('#zBox');
    const boxes=await page.locator('#zBox').getAttribute('aria-pressed');
    for(const railWidth of ['300','600']) for(const scale of ['90','130']){
      await click('#gearBtn');await fill('uiWidth',railWidth);await fill('uiScale',scale);
      await select('uiTheme','dark');
      const cfg=await page.evaluate(()=>({ui:store.read('frame.ui',{}),theme:document.documentElement.dataset.theme,
        width:document.documentElement.scrollWidth,visible:[...$('advPanel').querySelectorAll('input,select,button,a')].every(el=>{
          const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;
        })}));
      assert.equal(cfg.theme,'dark');assert.equal(String(cfg.ui.boxes),boxes,'개인 설정이 경계 저장값을 덮지 않음');
      assert(cfg.width<=width+1,`패널폭 ${railWidth}/배율 ${scale} 가로 넘침 ${cfg.width}`);
      assert(cfg.visible,'개인 설정 컨트롤이 화면 밖으로 잘림');
      await page.locator('#closeSettings').focus();await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'uiWidth','팝업 Tab 순환');
      await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'gearBtn');
      assert.equal((await snapshot()).hash,before.hash,'화면 표시 설정은 결과물 픽셀 보존');
      if(width<1100)await click('#toPreview');
    }
    await panel('dispPanel');await panel('movePanel');await select('moveElement','body');
    await click('#moveButtons [data-dx="1"]');assert.notEqual((await snapshot()).hash,before.hash);
    await click('#zUndo');assert.equal((await snapshot()).hash,before.hash);
    const scaleBefore=await page.evaluate(()=>zoom.scale);
    await click('#zIn');assert((await page.evaluate(()=>zoom.scale))>scaleBefore,'확대 버튼은 실제 화면 배율을 높임');
    await click('#zOut');assert(Math.abs((await page.evaluate(()=>zoom.scale))-scaleBefore)<.0001);
    await click('#z100');assert.equal(await page.evaluate(()=>zoom.scale),1);
    await click('#zFit');assert.equal(await page.evaluate(()=>zoom.mode),'fit');
    assert.equal((await snapshot()).hash,before.hash,'줌 조작은 합성 픽셀 보존');
    await page.screenshot({path:join(output,`settings-${width}.png`)});
    return {boxes};
  });

  await run('스트립 선택·버튼/키보드/드래그 순서·삭제',async()=>{
    await reset();const names=await page.evaluate(()=>state.shots.map(s=>s.name));
    await page.locator('#strip .chip:first-child .pick').check();await tick();
    await click('#moveNext');
    assert.deepEqual(await page.evaluate(()=>state.shots.map(s=>s.name)),[names[1],names[0],names[2]]);
    assert.deepEqual(await page.evaluate(()=>[state.shots[state.current].name,[...state.batch][0].name]),[names[0],names[0]]);
    await page.locator('#strip .chip:nth-child(2)').focus();await page.keyboard.press('Shift+ArrowRight');await tick();
    assert.equal(await page.evaluate(()=>state.current),2);
    // Real browser DnD API; mouse dragTo dispatches dragstart/dragover/drop to the existing strip.
    await page.locator('#strip .chip:nth-child(3)').dragTo(page.locator('#strip .chip:first-child'),{targetPosition:{x:2,y:20}});await tick();
    assert.equal(await page.evaluate(()=>state.shots[0].name),names[0]);
    await click('#strip .chip:first-child .x');
    assert.equal(await page.evaluate(()=>state.shots.length),2);assert.equal(await page.evaluate(()=>state.batch.size),0);
  });

  await run('출력 설정 화면·비율 합성·현재 장 사전 검사',async()=>{
    await reset(0,'gallery');
    const dimensions=[];
    for(const [mode,ratio] of [['none',null],['3:4',.75],['4:5',.8],['1:1',1],['1.91:1',1.91],['9:16',9/16]]){
      await select('ratio',mode);
      const d=await page.evaluate(()=>({width:state._pv.cv.width,height:state._pv.cv.height}));
      if(ratio)assert(Math.abs(d.width/d.height-ratio)<.003,`${mode} 결과물 비율`);
      dimensions.push({mode,...d});
    }
    await select('fmt','jpeg');assert.equal(await page.locator('#quality').isVisible(),true);await fill('quality','88');
    await fill('title','설정 QA');assert.match(await page.locator('#exportNote').textContent(),/설정 QA\(1\)\.jpg/);
    await click('#exportOne');assert.equal(await page.locator('#exportReview').isVisible(),true);
    assert.equal(await page.evaluate(()=>state.exportPlan.jobs.length),1);
    assert.match(await page.locator('#exportSummary').textContent(),/1장/);
    await select('fmt','png');assert.equal(await page.locator('#quality').isVisible(),false);
    return dimensions;
  });

  await run('기존 독립 metadata/mobile/colors 회귀 검사 재사용',async()=>{
    const results=[];
    for(const file of ['check-metadata.mjs','check-mobile.mjs','check-colors.mjs']){
      const result=execFileSync(process.execPath,[join(root,'tools',file)],{cwd:root,encoding:'utf8'});
      results.push({file,result:result.trim()});
    }return results;
  });
  await run('전체 검사 후 콘솔 오류 0·외부 요청 0',async()=>{
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);
  });
} catch(e) {
  report.cases.push({name:'검사 준비·진행',ok:false,error:e.stack});
} finally {
  report.sourceAfter=await sourceHash();report.sourceChanged=report.sourceBefore!==report.sourceAfter;
  report.pixelSnapshots=pixels;report.finished=new Date().toISOString();
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
  await writeFile(join(output,'inventory.json'),JSON.stringify(report.inventory,null,2));
  await browser.close();
  const failed=report.cases.filter(c=>!c.ok);
  console.log(JSON.stringify({browser:report.browser,passed:report.cases.length-failed.length,failed:failed.map(c=>({name:c.name,error:c.error.split('\n')[0]})),pixels,sourceChanged:report.sourceChanged,report:join(output,'report.json')},null,2));
  if(failed.length||report.sourceChanged)process.exitCode=1;
}
