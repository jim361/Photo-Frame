// Optional development check: uses an existing Playwright installation, never shipped with the app.
// PLAYWRIGHT_MODULE may point to its installed package directory; CHROME_PATH selects a local browser.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await chromium.launch({ headless:true,
  ...(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : {}) });
const errors = [], external = [];
const context = await browser.newContext({ viewport:{ width:1440, height:1000 } });
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (['error','assert'].includes(message.type())) errors.push(message.text()); });
page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
page.on('dialog', dialog => dialog.accept());
const tick = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
try {
  await page.goto(pathToFileURL(join(root,'index.html')).href + '?v=' + Date.now());
  await tick();
  assert.equal(await page.locator('#appearanceRow button').count(),1,'fresh storage completes preset init');
  assert.equal(await page.locator('#styleSeg button').count(),8);
  assert.equal(await page.locator('#ratioBg').inputValue(),'frame');
  assert.deepEqual(errors,[],'fresh initialization has no console errors/assertions');

  // Compare unchanged styles pixel-for-pixel against the git base in the same browser/font environment.
  const legacy = await context.newPage();
  await legacy.setContent(execFileSync('git',['show','HEAD:index.html'],{ cwd:root, encoding:'utf8', maxBuffer:4e6 }));
  const legacyRenders = () => {
    const out = [];
    for (const [w,h] of [[600,900],[900,600]]) for (const style of ['film','instax','bottom','top'])
      for (const tone of ['light','dark']) {
        const src = document.createElement('canvas'); src.width=w; src.height=h;
        const ctx=src.getContext('2d'); ctx.fillStyle='#326a80'; ctx.fillRect(0,0,w,h);
        const o={ style,tone,body:'Camera',lens:'50mm',film:'FILM',set:'F2 · 1/250s',date:'2026.07.19',caption:'메모',
          show:{body:true,lens:true,film:true,set:true,date:true,caption:true}, fontEn:'auto',fontKo:'gothic',ratio:'none',
          ratioBg:'#ffffff',sigText:'signature',lines:1,fontScale:1,bandScale:1,borderScale:1,logoScale:1,sideText:'stack' };
        out.push(render(src,o).toDataURL());
      }
    return out;
  };
  assert.deepEqual(await page.evaluate(legacyRenders),await legacy.evaluate(legacyRenders),'old four styles preserve exact pixels');
  await legacy.close();

  await page.locator('#loadExample').click();
  await page.waitForFunction(() => state.shots.length === 2);
  await tick();
  const dimensions = await page.evaluate(() => {
    const results=[];
    for (const shot of state.shots) for (const style of STYLE_KEYS){
      const o=withShot(withProfile({...opts(),style,ratio:'none',frameColor:'#ffffff',legacyTone:null},shot),shot);
      const info={collect:true}, cv=render(shot.img,o,info);
      const expected=exportDimensions(shot,o,0);
      if (cv.width !== expected.w || cv.height !== expected.h) throw Error(`${style} dimension mismatch`);
      if (MATTE_STYLES.includes(style) && style !== 'gallery'){
        if (Math.abs(info.photo.x-info.photo.y)>1 || Math.abs((cv.height-info.photo.h-info.photo.y)-info.photo.x)>1)
          throw Error(`${style} is not equal padding`);
      }
      const pixel=Array.from(cv.getContext('2d').getImageData(0,['bottom','minimal'].includes(style)?cv.height-1:0,1,1).data);
      if (!['film','instax'].includes(style) && pixel.slice(0,3).some(v=>v!==255)) throw Error(`${style} white default`);
      results.push([style,cv.width,cv.height]); cv.width=cv.height=1;
    }
    return results;
  });
  assert.equal(dimensions.length,16);
  assert.equal(await page.locator('#styleSeg canvas:visible').count(),8,'current photo thumbnails');
  const colors=await page.evaluate(() => {
    for (const tone of ['light','dark']){
      loadFrameColors({tone});
      if (state.legacyBandTones.bottom!==tone || state.frameColors.top!==(tone==='dark'?C.bandDark:'#f2efe8')) throw Error('old color migration');
    }
    loadFrameColors({frameColors:{}}); setStyle('matte'); setFrameColor('#173d72');
    const s=cleanProjectSettings(settingsSnapshot());
    if (s.frameColors.matte!=='#173d72') throw Error('project color preservation');
    const before=JSON.stringify(gInfo), own=JSON.stringify(state.shots.map(s=>s.own));
    const entry={settings:captureAppearance()};
    if (['body','lens','date','caption','title'].some(k=>k in entry.settings)) throw Error('appearance contains photo values');
    setFrameColor('#ffffff'); applyAppearance(entry);
    if (state.frameColors.matte!=='#173d72' || before!==JSON.stringify(gInfo) || own!==JSON.stringify(state.shots.map(s=>s.own)))
      throw Error('appearance restoration changed metadata');
    const answers=[];
    for (const color of ['#ffffff','#000000','#f6f3ec','#777777','#ffff00','#123456']){
      const ink=readableText(color), rgb=color.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
      const l=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
      const ratio=ink==='#000000'?(l+.05)/.05:1.05/(l+.05);
      if (ratio<4.5) throw Error(`poor contrast ${color}`);
      answers.push({color,ink,ratio});
    }
    const src=document.createElement('canvas');src.width=100;src.height=200;
    const padded=padToRatio(src,{style:'matte',frameColor:'#173d72',ratio:'1:1',ratioBg:'frame'});
    if (Array.from(padded.getContext('2d').getImageData(0,0,1,1).data).join(',')!=='23,61,114,255') throw Error('padding follow color');
    return answers;
  });
  assert.equal(colors.length,6);
  await tick();

  await page.evaluate(async () => {
    state.batch=new Set([state.shots[1]]); $('title').value='검사'; drawStrip();
    await prepareExport([...state.batch]);
    if (state.exportPlan.jobs[0].name!=='검사(2).png') throw Error('selected strip numbering');
    if (!$('exportSummary').textContent.includes('1장') || !$('exportItems').textContent.includes('px')) throw Error('preflight summary');
    const realSave=save; const output=[];
    save=async(blob,name)=>{output.push({bytes:blob.size,name}); return {name,confirmed:true};};
    try { await exportShots([],state.exportPlan); } finally { save=realSave; }
    if (output.length!==1 || !output[0].bytes || output[0].name!=='검사(2).png') throw Error('selected actual encode');
    adv.matte.port.bodyDX='9'; state.shots[1].own={body:'Overflow'};
    await prepareExport([state.shots[1]]);
    if (!$('exportSummary').textContent.includes('1장 요소 넘침')) throw Error('overflow target not reported');
    if (adv.matte.port.bodyDX!=='9') throw Error('overflow silently changed layout');
    adv.matte.port.bodyDX='0';
  });

  // Real local PNG decoding + the actual project picker/save paths; the writable sink is memory-only.
  await page.evaluate(async () => {
    const files=[];
    for (const [index,width,height] of [[1,600,900],[2,900,600],[3,600,900]]){
      const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
      const ctx=canvas.getContext('2d'); ctx.fillStyle=['#39798a','#985d42','#53885f'][index-1]; ctx.fillRect(0,0,width,height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      files.push(new File([blob],`recovery-${index}.png`,{type:'image/png',lastModified:1700000000000+index}));
      canvas.width=canvas.height=1;
    }
    const manifest={kind:PROJECT_KIND,version:PROJECT_VERSION,settings:settingsSnapshot(),fonts:[],activeLogo:null,current:0,
      photos:files.map((file,index)=>({file:{name:file.name,size:file.size,lastModified:file.lastModified,type:file.type},
        own:{caption:`saved ${index+1}`,film:null,show:{date:false}},
        ...(index===1?{detectedExif:{body:'Camera only',date:'2026.09.07'},exifReview:'partial'}:{})}))};
    const open=async data=>{
      const transfer=new DataTransfer();
      transfer.items.add(new File([JSON.stringify(data)],'recovery.photoframe.json',{type:'application/json'}));
      const picker=$('projectPicker'); picker.files=transfer.files;
      await picker.onchange({target:picker});
      if (!pendingProject || pendingProject.photos.length!==3) throw Error('project picker did not restore full manifest');
    };
    const edit=(id,value)=>{
      state.infoScope='shot'; state.batch.clear(); syncFields();
      $(id).value=value; $(id).dispatchEvent(new Event('input',{bubbles:true}));
    };
    const originalDir=state.dirHandle, originalSave=save;
    let savedProject, closes=0;
    try {
      state.dirHandle={name:'memory-only',async getFileHandle(_name,options){
        if (!options?.create) throw new DOMException('No test file','NotFoundError');
        return {async createWritable(){ return {
          async write(blob){savedProject=JSON.parse(await blob.text());}, async close(){closes++;}, async abort(){},
        }; }};
      }};
      await open(manifest);
      await addFiles([files[0]]);
      if (state.shots.length!==1 || state.shots[0].img.width!==600) throw Error('real partial PNG decoding');
      edit('caption','부분 복원 중 저장한 메모');
      if (!state.projectDirty) throw Error('partial edit did not become dirty');
      await $('projectSave').onclick();
      if (closes!==1 || state.projectDirty) throw Error('actual project writable close was not acknowledged');
      if (savedProject.photos.length!==3 || savedProject.photos[0].own.caption!=='부분 복원 중 저장한 메모' ||
          savedProject.photos[1].own.film!==null || savedProject.photos[1].own.show.date!==false ||
          savedProject.photos[1].detectedExif.body!=='Camera only') throw Error('partial save lost pending photo values');
      if (!$('projectNote').textContent.includes('미연결 2장 정보 포함')) throw Error('partial save did not explain pending records');
      await open(savedProject);
      await addFiles([files[0]]);
      if (state.shots[0].own.caption!=='부분 복원 중 저장한 메모') throw Error('saved partial edit did not reconnect');
      edit('lens','재연결 중 수정한 렌즈');
      await addFiles([files[2],files[1]]);
      if (pendingProject!==null || !state.projectDirty || state.shots[0].own.lens!=='재연결 중 수정한 렌즈' ||
          state.shots[0].own.caption!=='부분 복원 중 저장한 메모' || state.shots[1].detectedExif?.body!=='Camera only')
        throw Error('final original connection lost edits, pending values, or dirty state');
      if (state.shots.map(shot=>shot.name).join(',')!==files.map(file=>file.name).join(',')) throw Error('recovery strip order');

      // Real render/toBlob, with deterministic write results; cancellation must prevent the next encode.
      $('title').value='복원검사'; $('fmt').value='png'; $('size').value='1440';
      const cancelled=[];
      save=async(blob,name)=>{
        if (!(blob instanceof Blob) || !blob.size || blob.type!=='image/png') throw Error('real PNG encoding missing');
        cancelled.push(name); $('exportCancel').click(); return {name,confirmed:true};
      };
      await exportShots([...state.shots]);
      if (cancelled.length!==1 || state.lastExportMetrics.completed!==1 || state.lastExportMetrics.cancelled!==2 ||
          !$('exportStatus').textContent.includes('2장 취소됨')) throw Error('real export cancellation between images');

      const written=[]; let fail=true;
      save=async(blob,name)=>{
        if (!blob.size) throw Error('empty actual export');
        if (name==='복원검사(2).png' && fail){fail=false; throw Error('deterministic test write failure');}
        written.push(name); return {name,confirmed:true};
      };
      await exportShots([...state.shots]);
      if (written.join(',')!=='복원검사(1).png,복원검사(3).png' || state.exportRetry?.jobs.length!==1 || $('exportRetry').disabled)
        throw Error('real export failure did not preserve remaining outputs and retry');
      state.current=1; moveCurrent(1);
      await $('exportRetry').onclick();
      if (state.exportPlan.jobs.length!==1 || state.exportPlan.jobs[0].name!=='복원검사(2).png') throw Error('retry renumbered the moved photo');
      await exportShots([],state.exportPlan);
      if (written.join(',')!=='복원검사(1).png,복원검사(3).png,복원검사(2).png' || state.exportRetry!==null)
        throw Error('real retry did not save only the failed photo');
    } finally { save=originalSave; state.dirHandle=originalDir; }
  });

  // Real mouse events: a fitted canvas must not feed its changing size back into a grip gesture.
  const resizeContext=await browser.newContext({viewport:{width:1440,height:1000}});
  const resizePage=await resizeContext.newPage();
  resizePage.on('pageerror',error=>errors.push(error.message));
  resizePage.on('console',message=>{if(['error','assert'].includes(message.type())) errors.push(message.text());});
  resizePage.on('request',request=>{if(/^https?:/.test(request.url())) external.push(request.url());});
  const resizeTick=()=>resizePage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  try {
    await resizePage.goto(pathToFileURL(join(root,'index.html')).href+'?v=resize-'+Date.now());
    await resizePage.locator('#loadExample').click();
    await resizePage.waitForFunction(()=>state.shots.length===2);await resizeTick();
    for(const highRes of [false,true]){
      if(highRes) await resizePage.evaluate(()=>{
        for(const [index,width,height] of [[0,6000,4000],[1,4000,6000]]){
          const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
          const ctx=canvas.getContext('2d');ctx.fillStyle='#486a81';ctx.fillRect(0,0,width,height);
          state.shots[index].img=canvas;
        }
      });
      for(const style of ['matte','keyline']) for(const index of [0,1]) for(const mode of highRes?['fit']:['fit','free']){
        await resizePage.evaluate(({style,index,mode})=>{
          state.current=index;advTab=photoDir(state.shots[index].img);$('ratio').value=mode==='free'?'1:1':'none';
          setStyle(style);profileFor().borderScale='100';clearLayoutUndo();syncAdv();refresh();
        },{style,index,mode});await resizeTick();
        if(mode==='free') await resizePage.evaluate(()=>zoomTo(zoom.scale));
        const start=await resizePage.evaluate(()=>{
          const P=state._pv,h=edgeHandles().find(h=>h.key==='borderScale'),r=pv.getBoundingClientRect();
          return {x:r.left+(h.x+P.padX)*zoom.scale,y:r.top+(h.y+P.padY)*zoom.scale,unit:P.units.borderScale*zoom.scale};
        });
        await resizePage.mouse.move(start.x,start.y);await resizePage.mouse.down();
        const values=[];
        for(let step=1;step<=6;step++){
          const d=start.unit*step/12;
          await resizePage.mouse.move(start.x+d,start.y-d);await resizeTick();
          values.push(await resizePage.evaluate(()=>edgeDrag?.pct));
        }
        assert.deepEqual(values,[92,83,75,67,58,50],`${style}/${index}/${mode}/${highRes}: linear grip response`);
        for(let repeat=0;repeat<8;repeat++){
          await resizePage.mouse.move(start.x+start.unit/2+(repeat%2)*0.02,start.y-start.unit/2);await resizeTick();
          assert.equal(await resizePage.evaluate(()=>edgeDrag?.pct),50,`${style}: stationary grip does not oscillate`);
        }
        assert.equal(await resizePage.evaluate(()=>!!state._dragImg),highRes&&mode==='fit','only high-resolution fit gestures use reduced source');
        await resizePage.mouse.up();await resizeTick();
        assert.equal(await resizePage.evaluate(()=>layoutUndoStack().length),1,'one grip gesture is one undo step');
        assert.equal(await resizePage.locator('#borderScaleRange').inputValue(),'50','grip synchronizes slider');
      }
    }
    // A long held slider gesture must remain one undo action, including a pause over the numeric debounce.
    await resizePage.evaluate(()=>{
      state.current=0;advTab='land';setStyle('matte');profileFor().borderScale='100';clearLayoutUndo();syncAdv();
      $('dispPanel').open=true;refresh();
    });await resizeTick();
    const slider=resizePage.locator('#borderScaleRange');await slider.scrollIntoViewIfNeeded();
    // Native focus transfer blurs the paired number after the slider's pointerdown.
    await resizePage.locator('#borderScale').focus();
    const track=await slider.boundingBox(),y=track.y+track.height/2;
    await resizePage.mouse.move(track.x+track.width*0.45,y);await resizePage.mouse.down();await resizeTick();
    await resizePage.waitForTimeout(700);
    await resizePage.mouse.move(track.x+track.width*0.7,y);await resizeTick();
    await resizePage.mouse.up();await resizeTick();
    const selected=await slider.inputValue();assert(Number(selected)>100,'native slider responds to click and drag');
    assert.equal(await resizePage.locator('#borderScale').inputValue(),selected,'slider synchronizes numeric value');
    assert.equal(await resizePage.evaluate(()=>layoutUndoStack().length),1,'number-to-slider focus transfer and held gesture keep one undo step');
    assert.equal(await resizePage.evaluate(()=>store.read('frame.settings',{}).advByStyle.matte.land.borderScale),selected,'slider persists profile');
    await resizePage.locator('#zUndo').click();await resizeTick();
    assert.equal(await slider.inputValue(),'100','undo restores slider start value');
    await resizePage.locator('#borderScale').fill('');await resizeTick();
    assert.equal(await slider.inputValue(),'100','blank number uses render default, not native range midpoint');
    await resizePage.evaluate(()=>syncAdv());
    assert.equal(await slider.inputValue(),'100','profile synchronization preserves blank-number fallback');
    assert.equal(await resizePage.locator('#borderScale').inputValue(),'','fallback does not rewrite the numeric value');
    await resizePage.reload();await resizeTick();
    await resizePage.evaluate(()=>{advTab='land';syncAdv();});
    assert.equal(await resizePage.locator('#borderScale').inputValue(),'','blank legacy numeric value survives reload');
    assert.equal(await slider.inputValue(),'100','reloaded blank profile shows effective default on slider');
  } finally {await resizeContext.close();}

  for (const [width,height] of [[360,844],[390,844],[768,844],[390,480]]){
    await page.setViewportSize({width,height});
    await page.evaluate(() => { $('dispPanel').open=true; $('dateFormat').scrollIntoView({block:'center'}); });
    await tick();
    const layout=await page.evaluate(() => {
      const rect=vp.getBoundingClientRect(); const canvas=pv.getBoundingClientRect(),bar=$('zoombar').getBoundingClientRect();
      return {top:rect.top,height:rect.height,width:document.documentElement.scrollWidth, viewport:innerWidth,
        usable:Math.min(bar.top,canvas.bottom)-Math.max(rect.top,canvas.top)};
    });
    await page.screenshot({path:join(process.env.PHOTOFRAME_QA_DIR || tmpdir(),`photoframe-${width}.png`)});
    if(layout.width>width+1) console.log(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width && r.right>innerWidth+1;}).map(e=>[e.id||e.className,e.getBoundingClientRect().right]).slice(0,20)));
    assert(layout.top>=-1 && layout.top<60,`sticky preview at ${width}px: ${JSON.stringify(layout)}`);
    assert(layout.width<=width+1,`horizontal overflow at ${width}px: ${JSON.stringify(layout)}`);
    assert(layout.usable>=80,`usable preview at ${width}px: ${layout.usable}`);
    await page.locator('#caption').fill('모바일 편집 검사');
    const focused=await page.locator('#caption').boundingBox();
    const preview=await page.locator('#viewport').boundingBox();
    assert(focused.y>=preview.y+preview.height-1,`focused input hidden behind preview at ${width}x${height}: ${focused.y}`);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(() => { window.scrollTo(0,0); $('settingsRail').scrollTop=0; });
  await tick();
  await page.screenshot({path:join(process.env.PHOTOFRAME_QA_DIR || tmpdir(),'photoframe-desktop.png')});
  const persisted=await page.evaluate(() => {
    setStyle('matte');setFrameColor('#173d72');$('ratioBg').value='custom';$('ratioCustom').value='#abcdef';
    metadataShow.iso=false;$('dateFormat').value='month';saveSettings();
    return {color:state.frameColors.matte,ratio:opts().ratioBg,...metadataOptions()};
  });
  await page.reload();await tick();
  assert.deepEqual(await page.evaluate(()=>({color:state.frameColors.matte,ratio:opts().ratioBg,...metadataOptions()})),persisted,'color and metadata settings survive fresh reload');
  assert.deepEqual(errors,[],'all browser interactions without console errors');
  assert.deepEqual(external,[],'no external HTTP requests');
  console.log(`PhotoFrame 브라우저 검사 통과 · ${browser.version()} · 16 방향별 렌더 · 구버전 16 픽셀 비교 · 색/프리셋/부분 복원·저장/선택 내보내기/취소/재시도/넘침 · 매트/키라인 실제 마우스·24MP·슬라이더 · 360/390/768px`);
} finally { await browser.close(); }
