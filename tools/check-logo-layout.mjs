// Independent browser QA. Uses only synthetic PNGs and never changes application files.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = execFileSync('git', ['show', 'f657be27fa5bb6a0f3093923d55c197d0bb3e85b:index.html'],
  { cwd: root, encoding: 'utf8', maxBuffer: 4e6 });
const current = readFileSync(join(root, 'index.html'), 'utf8');
const output = join(process.env.LOGO_QA_OUTPUT || tmpdir(), `photoframe-logo-qa-${Date.now()}`);
mkdirSync(output, { recursive: true });
const errors = [], external = [], failures = [];
const checks = [];
const sourceHash = createHash('sha256').update(current).digest('hex');
const MODERN_STYLES = ['film','bottom','top','matte','gallery','keyline'];
const entry = pathToFileURL(join(root, 'index.html')).href;
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const contexts = [];
async function open(version) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  contexts.push(context);
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(entry)) return route.fulfill({contentType:'text/html; charset=utf-8',body:version==='old'?baseline:current});
    if (/^(data:|blob:)/.test(url)) return route.continue();
    external.push(url); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`${version}: ${e.message}`));
  page.on('console', m => { if (['error', 'assert'].includes(m.type())) errors.push(`${version}: ${m.text()}`); });
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`${entry}?v=${version}-${Date.now()}`);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  assert.equal(await page.locator('#styleSeg button').count(), 8, `${version}: fresh initialization`);
  assert.equal(await page.locator('#appearanceRow button').count(), 1, `${version}: preset initialization`);
  return page;
}

async function renderState(page, settings) {
  return page.evaluate(async settings => {
    if(settings) {
      resetAdv(); $('sigText').value='';store.write('frame.settings',settings);loadSettings();
      logoState.name='';logoState.img=null;
    }
    const results=[];
    for(const [dir,w,h] of [['port',600,900],['land',900,600],['square',700,700]]) {
      const img=document.createElement('canvas'); img.width=w; img.height=h;
      const ctx=img.getContext('2d');ctx.fillStyle='#39798a';ctx.fillRect(0,0,w,h);
      ctx.fillStyle='#985d42';ctx.fillRect(w*.1,h*.2,w*.3,h*.2);
      const shot={img,own:{},exif:{}},info={collect:true};
      const cv=render(img,withShot(withProfile(opts(),shot),shot),info);
      const pixels=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels)),
        n=>n.toString(16).padStart(2,'0')).join('');
      results.push({dir,width:cv.width,height:cv.height,boxes:info.boxes,hash});
      img.width=img.height=cv.width=cv.height=1;
    }
    return results;
  }, settings);
}

async function makeFixtures(old) {
  return old.evaluate(() => {
    const base=settingsSnapshot();
    Object.assign(base,{body:'Camera',lens:'50mm',film:'FILM',set:'F2 · 1/250s',date:'2026.10.18',
      caption:'메모',sigText:'signature',logo:'',show:Object.fromEntries(INFO_KEYS.map(k=>[k,true]))});
    const fixtures=[];
    for(const style of STYLE_KEYS) for(const key of ELEM_KEYS) for(const sign of [-1,1]) for(const hidden of [false,true]) {
      const settings=structuredClone(base);settings.style=style;
      for(const style of STYLE_KEYS) for(const dir of ['port','land']) settings.advByStyle[style][dir]={...DEF_ADV};
      for(const dir of ['port','land']) Object.assign(settings.advByStyle[style][dir],{
        [key+'DX']:String(sign*.037),[key+'DY']:String(-sign*.023)});
      if(hidden) {if(key==='logo')settings.sigText='';else settings.show[key==='cap'?'caption':key]=false;}
      fixtures.push({id:`${style}-${key}-${sign}-${hidden?'hidden':'visible'}`,style,key,sign,hidden,settings});
    }
    for(const style of STYLE_KEYS)for(const sign of[-1,1]){
      const settings=structuredClone(base);settings.style=style;
      for(const style of STYLE_KEYS)for(const dir of['port','land'])settings.advByStyle[style][dir]={...DEF_ADV};
      for(const dir of['port','land'])Object.assign(settings.advByStyle[style][dir],{infoDX:String(sign*.037),infoDY:String(-sign*.023)});
      fixtures.push({id:`${style}-old-info-${sign}`,style,key:'info',sign,hidden:false,settings});
    }
    return fixtures;
  });
}

async function check(name, action) {
  try { await action(); checks.push(name); }
  catch(error) { failures.push({name,message:error.message}); console.error(`FAIL ${name}: ${error.message.slice(0,400)}`); }
}

async function checkPreservation(old, next) {
  const fixtures=await makeFixtures(old);
  writeFileSync(join(output,'legacy-fixtures.json'),JSON.stringify(fixtures,null,2));
  const evidence=[];
  for(const fixture of fixtures) {
    const expected=await renderState(old,fixture.settings);
    const actual=await renderState(next,fixture.settings);
    const same=JSON.stringify(expected)===JSON.stringify(actual);
    evidence.push({id:fixture.id,same,expected,actual});
    if(!same) failures.push({name:`preserve:${fixture.id}`,message:'collect boxes or pixel SHA-256 differs from f657be2'});
  }
  writeFileSync(join(output,'preservation.json'),JSON.stringify(evidence,null,2));
  checks.push(`legacy settings: ${fixtures.length} fixtures × 3 orientations`);
  console.log(`Legacy preservation: ${evidence.filter(r=>r.same).length}/${fixtures.length} fixtures`);
  return fixtures;
}

async function checkEntryPaths(old,next,fixtures) {
  const evidence=[];
  for(const fixture of fixtures.filter(f=>(f.key==='body'&&!f.hidden)||(f.key==='date'&&f.hidden)||f.key==='info')) {
    const expected=await renderState(old,fixture.settings);
    for(const path of (fixture.key==='info'?['reload','project','appearance']:['reload','project','layout','appearance'])) {
      await check(`${path}:${fixture.id}`,async()=>{
        await next.evaluate(async({settings,path})=>{
          resetAdv();$('sigText').value='';store.write('frame.settings',settings);loadSettings();
          if(path==='project') {
            const data={kind:PROJECT_KIND,version:PROJECT_VERSION,settings,photos:[],fonts:[],activeLogo:null};
            const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(data)],'old.photoframe.json',{type:'application/json'}));
            $('projectPicker').files=transfer.files;await $('projectPicker').onchange({target:$('projectPicker')});
            if(!pendingProject)throw Error('project picker failed');
          } else if(path==='layout') {
            resetAdv();layouts=cleanPresetLayouts([{name:'QA old layout',style:settings.style,...settings.advByStyle[settings.style]}]);
            drawLayouts();$('layoutRow').querySelector('button[title="QA old layout"]').click();
          } else if(path==='appearance') {
            resetAdv();applyAppearance({name:'QA old appearance',settings});
          }
        },{settings:fixture.settings,path});
        if(path==='reload')await next.reload();
        const actual=await renderState(next,null);
        evidence.push({id:fixture.id,path,expected,actual});
        assert.deepEqual(actual,expected,`${path} must preserve boxes and pixels`);
      });
    }
  }
  writeFileSync(join(output,'entry-paths.json'),JSON.stringify(evidence,null,2));
}

async function checkContract(page) {
  await check('profile version migration',async()=>{
    const result=await page.evaluate(()=>{
      const settings=settingsSnapshot();
      for(const style of STYLE_KEYS)for(const dir of ['port','land']){
        settings.advByStyle[style][dir]={...DEF_ADV};delete settings.advByStyle[style][dir].logoLayout;
      }
      settings.advByStyle.bottom.port.bodyDX='.01';
      settings.advByStyle.gallery.land.infoDY='-.02';
      settings.advByStyle.top.port.logoLayout='1';
      settings.advByStyle.matte.land.logoLayout='2';settings.advByStyle.matte.land.bodyDX='.1';
      resetAdv();store.write('frame.settings',settings);loadSettings();
      return {default:DEF_ADV.logoLayout,ui:ADV_KEYS.includes('logoLayout'),profile:PROFILE_KEYS.includes('logoLayout'),
        moved:adv.bottom.port.logoLayout,old:adv.gallery.land.logoLayout,zero:adv.bottom.land.logoLayout,
        explicit1:adv.top.port.logoLayout,explicit2:adv.matte.land.logoLayout};
    });
    assert.deepEqual(result,{default:'2',ui:false,profile:true,moved:'1',old:'1',zero:'2',explicit1:'1',explicit2:'2'});
  });
}

async function unchangedMatrix(page) {
  return page.evaluate(async()=>{
    resetAdv();const out=[];
    for(const style of STYLE_KEYS)for(const [dir,w,h]of[['port',600,900],['land',900,600],['square',700,700]])
      for(const lines of[1,2])for(const logo of['none','signature','image'])for(const mode of['raw','profile','legacy']){
        if(mode==='profile'&&!['instax','minimal'].includes(style)&&logo!=='none')continue;
        const img=document.createElement('canvas');img.width=w;img.height=h;img.getContext('2d').fillRect(0,0,w,h);
        const mark=document.createElement('canvas');mark.width=400;mark.height=100;mark.getContext('2d').fillRect(0,0,400,100);
        let o={...opts(),style,body:'Camera',lens:'50mm',film:'FILM',set:'F2 · 1/250s',date:'2026.10.18',caption:'메모',
          show:{body:true,lens:true,film:true,set:true,date:true,caption:true},sigText:logo==='signature'?'signature':'',
          logoImg:logo==='image'?mark:null,lines,fontScale:1,bandScale:1,borderScale:1,logoScale:1,sideText:'stack',
          off:Object.fromEntries(ELEM_KEYS.map(k=>[k,{x:0,y:0}]))};
        if(mode!=='raw'){
          adv[style][dir==='land'?'land':'port'].lines=String(lines);o=withProfile(o,{img});
          if(mode==='legacy')o.logoLayout='1';
        }
        const info={collect:true},cv=render(img,o,info),pixels=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels)),n=>n.toString(16).padStart(2,'0')).join('');
        out.push({id:`${mode}/${style}/${dir}/${lines}/${logo}`,width:cv.width,height:cv.height,boxes:info.boxes,hash});
        img.width=img.height=mark.width=mark.height=cv.width=cv.height=1;
      }
    return out;
  });
}

async function zeroBorderMatrix(page) {
  return page.evaluate(async()=>{
    const out=[];
    for(const style of ['matte','keyline'])for(const [w,h]of[[600,900],[900,600],[700,700]])for(const lines of[1,2]) {
      const img=document.createElement('canvas');img.width=w;img.height=h;img.getContext('2d').fillRect(0,0,w,h);
      const o={...opts(),style,body:'Camera',lens:'50mm',film:'FILM',set:'F2 · 1/250s',date:'2026.10.18',caption:'메모',
        show:{body:true,lens:true,film:true,set:true,date:true,caption:true},sigText:'signature',logoImg:null,
        lines,fontScale:2,bandScale:.5,borderScale:0,logoScale:3,logoLayout:'2',
        off:Object.fromEntries(ELEM_KEYS.map(k=>[k,{x:0,y:0}]))};
      const info={collect:true},cv=render(img,o,info),pixels=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels)),n=>n.toString(16).padStart(2,'0')).join('');
      out.push({style,w,h,lines,boxes:info.boxes,hash,warnings:info.boxes.filter(b=>boxOver(b,{raw:cv,area:info.area})).map(b=>b.key)});
      img.width=img.height=cv.width=cv.height=1;
    }
    return out;
  });
}

async function checkOverflow(page) {
  const rows=await page.evaluate(styles=>{
    resetAdv();const out=[];
    for(const style of styles)for(const [dir,w,h]of[['port',600,900],['land',900,600],['square',700,700]])for(const key of['body','logo']){
      const img=document.createElement('canvas');img.width=w;img.height=h;
      const o={...opts(),style,body:'Camera',lens:'50mm',film:'FILM',set:'F2 · 1/250s',date:'2026.10.18',caption:'메모',
        show:{body:true,lens:true,film:true,set:true,date:true,caption:true},sigText:'signature',logoImg:null,
        lines:1,fontScale:1,bandScale:1,borderScale:1,logoScale:1,logoLayout:'2',
        off:Object.fromEntries(ELEM_KEYS.map(k=>[k,{x:0,y:0}]))};
      const before={collect:true},a=render(img,o,before);o.off[key]={x:3,y:-3};
      const after={collect:true},b=render(img,o,after),initial=before.boxes.find(b=>b.key===key),final=after.boxes.find(b=>b.key===key);
      out.push({style,dir,key,dx:final.x-initial.x,dy:final.y-initial.y,expected:3*w,moved:final.moved,
        warning:boxOver(final,{raw:b,area:after.area}),othersSame:before.boxes.filter(b=>b.key!==key).every((b,i)=>{
          const other=after.boxes.filter(b=>b.key!==key)[i];return JSON.stringify(b)===JSON.stringify(other);
        })});
      img.width=img.height=a.width=a.height=b.width=b.height=1;
    }
    return out;
  },MODERN_STYLES);
  writeFileSync(join(output,'overflow.json'),JSON.stringify(rows,null,2));
  assert(rows.every(r=>r.moved&&r.warning&&r.othersSame&&Math.abs(r.dx-r.expected)<.01&&Math.abs(r.dy+r.expected)<.01),
    'moved elements retain requested physical offsets and overflow warnings');
}

async function checkFilm(page) {
  const rows=await page.evaluate(()=>{
    const out=[],native=trackedText;
    let paints=[];
    trackedText=function(ctx,text,...args){paints.push({text,ink:ctx.fillStyle});return native(ctx,text,...args);};
    try{
      for(const [dir,w,h]of[['port',600,900],['land',900,600]])for(const lines of[1,2]){
        const img=document.createElement('canvas');img.width=w;img.height=h;img.getContext('2d').fillRect(0,0,w,h);
        const o={...opts(),style:'film',body:'Camera',lens:'50mm',film:'FILM',set:'F2 · 1/250s',date:'2026.10.18',caption:'메모',
          show:{body:true,lens:true,film:true,set:true,date:true,caption:true},sigText:'signature',logoImg:null,
          lines,fontScale:1,bandScale:1,borderScale:1,logoScale:1,logoLayout:'2',
          off:Object.fromEntries(ELEM_KEYS.map(k=>[k,{x:0,y:0}]))};
        const info={collect:true};paints=[];const cv=render(img,o,info),lb=info.boxes.find(b=>b.key==='logo'),date=info.boxes.find(b=>b.key==='date');
        const body=info.boxes.find(b=>b.key==='body'),cap=info.boxes.find(b=>b.key==='cap');
        const legacy=render(img,{...o,logoLayout:'1'}),bar=Math.max(w,h)*.088;
        const inset=Math.min(bar,(dir==='port'?info.area.w:info.area.h)/2);
        const cropW=dir==='port'?Math.floor(info.area.x+inset):cv.width;
        const cropH=dir==='port'?cv.height:Math.floor(info.area.y+inset);
        const prefix=cv.getContext('2d').getImageData(0,0,cropW,cropH).data;
        const oldPrefix=legacy.getContext('2d').getImageData(0,0,cropW,cropH).data;
        const decorationsSame=prefix.length===oldPrefix.length&&prefix.every((v,i)=>v===oldPrefix[i]);
        const arrangement=dir==='port'?date.y>=lb.y+lb.h&&body.y+body.h<=lb.y&&cap.y+cap.h<=lb.y:
          date.x+date.w<=lb.x&&body.x>=lb.x+lb.w&&cap.x>=lb.x+lb.w;
        out.push({dir,lines,arrangement,decorationsSame,colors:{date:paints.find(p=>p.text===o.date)?.ink,
          body:paints.find(p=>p.text==='CAMERA')?.ink,caption:paints.find(p=>p.text==='메모')?.ink},boxes:info.boxes});
        img.width=img.height=cv.width=cv.height=legacy.width=legacy.height=1;
      }
    }finally{trackedText=native;}
    return out;
  });
  writeFileSync(join(output,'film-contract.json'),JSON.stringify(rows,null,2));
  for(const row of rows){assert(row.arrangement,'film date/logo/information order');
    assert(row.decorationsSame,'film photo, base and perforation pixels remain unchanged');
    assert.deepEqual(row.colors,{date:'#e8873a',body:'#8a8378',caption:'#6f6a5f'});}
}

async function checkModern(page) {
  const rows=await page.evaluate(styles=>{
    resetAdv();const out=[];
    for(const style of styles)for(const [dir,w,h]of[['port',600,900],['land',900,600],['square',700,700]])
      for(const lines of[1,2])for(const scenario of['normal','long','shot','min','max','thin-border'])
        for(const logo of['signature','long-signature','image-0.05','image-0.25','image-1','image-4','image-20']){
          const img=document.createElement('canvas');img.width=w;img.height=h;img.getContext('2d').fillRect(0,0,w,h);
          const mark=document.createElement('canvas');mark.width=Math.max(1,100*(Number(logo.split('-')[1])||1));mark.height=100;
          mark.getContext('2d').fillRect(0,0,mark.width,100);
          const long=scenario!=='normal',own=scenario==='shot'?{body:'장별 Camera Z8',lens:'장별 Lens 50mm',set:'장별 F1.8 · 1/1000s · ISO 6400',caption:'장별 첫째 줄\n장별 둘째 줄'}:{};
          const shot={img,own,exif:{}},profile=adv[style][dir==='land'?'land':'port'];
          Object.assign(profile,{...DEF_ADV,logoLayout:'2',lines:String(lines),fontScale:scenario==='min'?'50':long?'200':'100',
            logoScale:scenario==='min'?'30':long?'300':'100',bandScale:scenario==='max'?'500':scenario==='min'?'50':'100',
            borderScale:scenario==='max'?'300':scenario==='min'?'1':scenario==='thin-border'?'0.01':'100'});
          const input={...opts(),style,body:long?'Camera body with very long model designation':'Camera',
            lens:long?'Lens 24-70mm f/2.8 very long model':'50mm',film:long?'FILM 400 SPECIAL EDITION':'FILM',
            set:long?'F2.8 · 1/1000s · ISO 6400 · 70mm':'F2 · 1/250s',date:'2026.10.18',caption:long?'긴 메모 첫 번째 줄\n긴 메모 두 번째 줄':'메모',
            show:{body:true,lens:true,film:true,set:true,date:true,caption:true},
            sigText:logo.includes('signature')?(logo==='signature'?'signature':'Very long handwritten signature with 한글 서명'):'',
            logoImg:logo.startsWith('image')?mark:null};
          Object.assign(gInfo,Object.fromEntries(INFO_KEYS.map(k=>[k,input[k]])));
          const o=withShot(withProfile(input,shot),shot);
          const info={collect:true},cv=render(img,o,info),empty=render(img,{...o,logoImg:null,sigText:''});
          const lb=info.boxes.find(b=>b.key==='logo'),area={...info.area},collisions=[],outside=[];
          if(style==='film'){
            const bar=Math.max(w,h)*.088,inset=Math.min(bar,(dir==='port'?area.w:area.h)/2);
            if(dir==='port'){area.x+=inset;area.w-=inset;}else{area.y+=inset;area.h-=inset;}
          }
          for(const b of info.boxes){
            if(b.key!=='logo'&&Math.min(lb.x+lb.w,b.x+b.w)-Math.max(lb.x,b.x)>.05&&Math.min(lb.y+lb.h,b.y+b.h)-Math.max(lb.y,b.y)>.05)collisions.push(b.key);
            if(b.x<area.x-.1||b.y<area.y-.1||b.x+b.w>area.x+area.w+.1||b.y+b.h>area.y+area.h+.1)outside.push(b.key);
          }
          out.push({style,dir,lines,scenario,logo,marker:o.logoLayout,collisions,outside,
            centered:style==='film'&&dir==='port'?Math.abs(lb.y+lb.h/2-h/2)<.1:Math.abs(lb.x+lb.w/2-(area.x+w/2))<.1,
            dimensionsFixed:cv.width===empty.width&&cv.height===empty.height,
            boxes:info.boxes,area,
            png:(scenario==='normal'&&logo==='signature')||(lines===1&&scenario==='long'&&logo==='image-20')||
              (outside.length&&logo==='signature')?cv.toDataURL('image/png'):null});
          img.width=img.height=cv.width=cv.height=empty.width=empty.height=mark.width=mark.height=1;
        }
    return out;
  },MODERN_STYLES);
  for(const row of rows){
    if(row.png)writeFileSync(join(output,`${row.style}-${row.dir}-${row.lines}line-${row.scenario}.png`),Buffer.from(row.png.split(',')[1],'base64'));
    delete row.png;
  }
  writeFileSync(join(output,'modern-layout.json'),JSON.stringify(rows,null,2));
  for(const row of rows)if(row.marker!=='2'||row.collisions.length||row.outside.length||!row.centered||!row.dimensionsFixed)
    failures.push({name:`modern:${row.style}/${row.dir}/${row.lines}/${row.scenario}/${row.logo}`,
      message:JSON.stringify({marker:row.marker,collisions:row.collisions,outside:row.outside,centered:row.centered,dimensionsFixed:row.dimensionsFixed})});
  checks.push(`modern layouts: ${rows.length} cases`);
  console.log(`Modern layouts: ${rows.filter(r=>r.marker==='2'&&!r.collisions.length&&!r.outside.length&&r.centered&&r.dimensionsFixed).length}/${rows.length}`);
}

async function loadPhotos(page) {
  const files=await page.evaluate(()=>[[600,900],[900,600],[700,700]].map(([width,height],i)=>{
    const cv=document.createElement('canvas');cv.width=width;cv.height=height;
    cv.getContext('2d').fillRect(0,0,width,height);
    const data=cv.toDataURL('image/png').split(',')[1];cv.width=cv.height=1;return {name:`qa-${i}.png`,data};
  }));
  await page.locator('#picker').setInputFiles(files.map(f=>({name:f.name,mimeType:'image/png',buffer:Buffer.from(f.data,'base64')})));
  await page.waitForFunction(()=>state.shots.length===3);
}
async function tick(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}

async function checkDrag(page) {
  await page.evaluate(()=>{clearShots();pendingProject=null;});await loadPhotos(page);
  for(const style of MODERN_STYLES)for(const current of [0,1,2])for(const key of ['body','logo']) {
    await check(`first drag:${style}/${current}/${key}`,async()=>{
      await page.evaluate(({style,current})=>{
        resetAdv();clearLayoutUndo();state.current=current;
        Object.assign(gInfo,{body:'Camera',lens:'50mm',film:'FILM',set:'F2 · 1/250s',date:'2026.10.18',caption:''});
        Object.assign(gShow,Object.fromEntries(INFO_KEYS.map(k=>[k,true])));
        logoState.img=null;$('sigText').value='signature';setStyle(style);state.showBoxes=true;zoom.mode='fit';refresh();
      },{style,current});await tick(page);
      const before=await renderState(page,null);
      const move=await page.evaluate(key=>{
        const P=state._pv,b=P.boxes.find(b=>b.key===key),others=P.boxes.filter(b=>b.key!==key),th=Math.max(6,P.raw.width*.006);
        const candX=[P.raw.width/2,...others.flatMap(b=>[b.x,b.x+b.w/2,b.x+b.w])];
        const candY=[P.raw.height/2,...others.flatMap(b=>[b.y,b.y+b.h/2,b.y+b.h])];
        for(let dx=-180;dx<=180;dx+=7)for(const dy of [-37,37,-53,53,-71,71]){
          if(b.x+dx<1||b.y+dy<1||b.x+b.w+dx>P.raw.width-1||b.y+b.h+dy>P.raw.height-1)continue;
          if(candX.some(c=>[b.x,b.x+b.w/2,b.x+b.w].some(v=>Math.abs(c-v-dx)<=th)))continue;
          if(candY.some(c=>[b.y,b.y+b.h/2,b.y+b.h].some(v=>Math.abs(c-v-dy)<=th)))continue;
          const r=pv.getBoundingClientRect(),scale=r.width/pv.width;
          const x=r.left+(b.x+b.w/2+P.padX)*scale,y=r.top+(b.y+b.h/2+P.padY)*scale;
          if(hitBox({clientX:x,clientY:y})?.b.key!==key||hitEdge({clientX:x,clientY:y}))continue;
          return {x,y,dx,dy,scale,renderW:P.renderW};
        }
        throw Error('No unsnapped in-bounds test gesture: '+JSON.stringify({key,b,boxes:P.boxes}));
      },key);
      await page.mouse.move(move.x,move.y);await page.mouse.down();
      await page.mouse.move(move.x+move.dx*move.scale,move.y+move.dy*move.scale,{steps:4});await page.mouse.up();await tick(page);
      const after=await renderState(page,null);
      const direction=['port','land','square'][current],a=before.find(r=>r.dir===direction),b=after.find(r=>r.dir===direction);
      for(let i=0;i<a.boxes.length;i++){
        const initial=a.boxes[i],final=b.boxes[i];assert.equal(final.key,initial.key);
        assert(Math.abs(final.x-initial.x-(initial.key===key?move.dx:0))<=1,'first drag x displacement');
        assert(Math.abs(final.y-initial.y-(initial.key===key?move.dy:0))<=1,'first drag y displacement');
        assert.equal(final.w,initial.w);assert.equal(final.h,initial.h);
      }
      const settings=await page.evaluate(()=>settingsSnapshot());
      const profile=settings.advByStyle[style][current===1?'land':'port'];
      assert.equal(profile.logoLayout,'2');
      assert(Math.abs(Number(profile[key+'DX'])-move.dx/move.renderW)<=.000051,'drag stores physical x axis');
      assert(Math.abs(Number(profile[key+'DY'])-move.dy/move.renderW)<=.000051,'drag stores physical y axis');
      await page.evaluate(()=>undoLayout());await tick(page);assert.deepEqual(await renderState(page,null),before,'undo preserves new layout origin');
      await page.evaluate(settings=>{store.write('frame.settings',settings);loadSettings();saveSettings();},settings);
      await page.reload();assert.deepEqual(await renderState(page,null),after,'reload preserves dragged layout');
      await page.evaluate(async settings=>{
        const data={kind:PROJECT_KIND,version:PROJECT_VERSION,settings,photos:[],fonts:[]};
        const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(data)],'drag.photoframe.json',{type:'application/json'}));
        $('projectPicker').files=transfer.files;await $('projectPicker').onchange({target:$('projectPicker')});
        if(!pendingProject)throw Error('drag project restore failed');
      },settings);
      assert.deepEqual(await renderState(page,null),after,'project restore preserves dragged layout');
    });
    // Reload/project reopening clears original photos. Reconnect synthetic PNGs for the next gesture.
    await page.evaluate(()=>{clearShots();pendingProject=null;});await loadPhotos(page);
  }
}

// All coordinates come from the same collect path used by the real preview.
async function diagnose(page, styles) {
  return page.evaluate(styles => {
    const out = [];
    const overlap = (a, b) => ({ w: Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x),
      h: Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y) });
    for (const style of styles) for (const [dir,w,h] of [['port',600,900],['land',900,600],['square',700,700]])
      for (const lines of [1,2]) for (const sideText of style==='instax'&&dir==='land'?['stack','rotate']:['stack'])
        for (const logo of ['signature','image-1','image-4','image-0.25']) for (const caption of ['', '메모']) {
          const src=document.createElement('canvas'); src.width=w; src.height=h;
          const ctx=src.getContext('2d'); ctx.fillStyle='#39798a'; ctx.fillRect(0,0,w,h);
          const mark=document.createElement('canvas'); mark.width=100*(Number(logo.split('-')[1])||1); mark.height=100;
          mark.getContext('2d').fillRect(0,0,mark.width,mark.height);
          const o={...opts(),style,body:'Camera',lens:'50mm',film:'FILM',set:'F2 · 1/250s',date:'2026.10.18',caption,
            show:{body:true,lens:true,film:true,set:true,date:true,caption:true},sigText:logo==='signature'?'signature':'',
            logoImg:logo==='signature'?null:mark,lines,fontScale:1,bandScale:1,borderScale:1,logoScale:1,sideText,
            off:Object.fromEntries(ELEM_KEYS.map(k=>[k,{x:0,y:0}]))};
          const info={collect:true}, cv=render(src,o,info), lb=info.boxes.find(b=>b.key==='logo');
          const collisions=info.boxes.filter(b=>b.key!=='logo').map(b=>({key:b.key,...overlap(lb,b)})).filter(b=>b.w>0.01&&b.h>0.01);
          const clipped=lb.x<0||lb.y<0||lb.x+lb.w>cv.width||lb.y+lb.h>cv.height;
          out.push({style,dir,lines,sideText,logo,caption,collisions,clipped,boxes:info.boxes,area:info.area});
          cv.width=cv.height=src.width=src.height=mark.width=mark.height=1;
        }
    return out;
  }, styles);
}

try {
  const old = await open('old');
  const diagnosis = await diagnose(old, ['film','instax','top','matte','keyline','minimal']);
  writeFileSync(join(output, 'baseline-diagnosis.json'), JSON.stringify(diagnosis, null, 2));
  for (const style of ['film','instax','top','matte','keyline','minimal']) {
    const rows=diagnosis.filter(r=>r.style===style), bad=rows.filter(r=>r.collisions.length);
    console.log(JSON.stringify({style,cases:rows.length,collisions:bad.length,
      examples:bad.filter(r=>r.logo==='signature'&&r.caption==='').slice(0,3).map(({boxes,area,...r})=>r),
      imageExamples:bad.filter(r=>r.logo==='image-1'&&r.caption==='').slice(0,2).map(({boxes,area,...r})=>r)}));
  }
  if (!process.argv.includes('--diagnose-only')) {
    const next=await open('current');
    await check('raw render, no-logo and Instax/minimal unchanged',async()=>{
      const expected=await unchangedMatrix(old),actual=await unchangedMatrix(next);
      writeFileSync(join(output,'unchanged.json'),JSON.stringify({expected,actual},null,2));
      assert.deepEqual(actual,expected);
    });
    const fixtures=await checkPreservation(old,next);
    await checkEntryPaths(old,next,fixtures);
    await checkContract(next);
    await check('modern rendering matrix',()=>checkModern(next));
    await check('zero border retains legacy boxes, pixels and warnings',async()=>{
      const expected=await zeroBorderMatrix(old),actual=await zeroBorderMatrix(next);
      writeFileSync(join(output,'zero-border.json'),JSON.stringify({expected,actual},null,2));
      assert.deepEqual(actual,expected);assert(actual.every(r=>r.boxes.some(b=>b.key==='logo')&&r.boxes.some(b=>b.key==='body')&&r.warnings.length));
    });
    await check('film colors and rotated column order',()=>checkFilm(next));
    await check('explicit offsets and overflow warnings',()=>checkOverflow(next));
    await checkDrag(next);
  }
  assert.deepEqual(errors, [], 'console/page errors');
  assert.deepEqual(external, [], 'external requests');
  writeFileSync(join(output,'summary.json'),JSON.stringify({baseline:'f657be27fa5bb6a0f3093923d55c197d0bb3e85b',
    sourceHash,checks,failures,errors,external},null,2));
  console.log(JSON.stringify({passedChecks:checks.length,failures:failures.length,consoleErrors:errors.length,externalRequests:external.length}));
  console.log(`Artifacts: ${output}`);
  if(failures.length) process.exitCode=1;
} finally {
  await Promise.all(contexts.map(c=>c.close()));
  await browser.close();
}
