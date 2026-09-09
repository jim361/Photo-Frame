import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const source=name=>script.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0];
const constants=script.slice(script.indexOf('const C = {'),script.indexOf('/* ============================================================',script.indexOf('const C = {')));
const STYLE_KEYS=['film','instax','bottom','top','matte','gallery','keyline','minimal'];
const state={};
const code=constants+'\n'+['frameDims','loadFrameColors'].map(source).join('\n')+
  ';return {hexColor,frameColor,readableText,frameDims,loadFrameColors,C};';
const api=new Function('STYLE_KEYS','state','infoRows',code)(STYLE_KEYS,state,o=>o.lines===2?[[],[]]:[[]]);
assert.equal(api.hexColor('#AbC'),'#aabbcc');
assert.equal(api.hexColor('url(https://invalid)'), '#ffffff');
assert.equal(api.hexColor('#zzzzzz',null),null);
for(let r=0;r<256;r+=17) for(let g=0;g<256;g+=17) for(let b=0;b<256;b+=17){
  const color='#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
  const linear=[r,g,b].map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  const l=linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;
  const contrast=api.readableText(color)==='#000000'?(l+.05)/.05:1.05/(l+.05);
  assert(contrast>=4.5,`${color} text contrast`);
}
for(const tone of ['light','dark']){
  api.loadFrameColors({tone});
  assert.equal(state.frameColors.bottom,tone==='dark'?api.C.bandDark:'#f2efe8');
  assert.equal(state.legacyBandTones.top,tone);
}
api.loadFrameColors({frameColors:{matte:'#ABC',bottom:'#ff8800'}});
assert.deepEqual(state.frameColors,{bottom:'#ff8800',matte:'#aabbcc'});
assert.deepEqual(state.legacyBandTones,{});
assert.equal(api.frameColor({style:'film',frameColor:'#fff'}),api.C.base);
for(const tone of ['light','dark']) for(const frameColor of ['#000000','#f6f3ec'])
  assert.equal(api.frameColor({style:'instax',tone,frameColor}),'#ffffff','Instax card and follow-frame padding stay pure white');
for(const [w,h] of [[600,900],[900,600]]) for(const scale of [.5,1,2]){
  const o={style:'matte',borderScale:scale,bandScale:5,lines:2};
  const d=api.frameDims(w,h,o),margin=w*.08*scale;
  assert.equal(d.w,w+2*margin);assert.equal(d.h,h+2*margin,'matte has no independent extra band');
}
const appearanceKeys=script.match(/const APPEARANCE_KEYS = (\[[^;]+\]);/)[1];
const capture=new Function('settingsSnapshot',`const APPEARANCE_KEYS=${appearanceKeys};${source('captureAppearance')}return captureAppearance;`)
  (()=>({body:'private camera',date:'private date',title:'private title',frameColors:{matte:'#abcdef'},fontEn:'serif',sigText:'signature',logo:'local-logo'}));
const appearance=capture();
assert.equal(appearance.frameColors.matte,'#abcdef');assert.equal(appearance.logo,'local-logo');
for(const field of ['body','lens','date','set','caption','title','shots','gear']) assert(!(field in appearance),`${field} must not be a design preset`);
const migrateInstax=new Function(`${source('migrateInstax')};return migrateInstax;`)();
for(const style of ['instax-square','instax-wide']){
  const old={style,caption:'보존할 메모',advByStyle:{instax:{port:{borderScale:'77'}},
    [style]:{port:{borderScale:'137'},land:{sideText:'rotate',bodyDX:'.12'}}}};
  const before=structuredClone(old),mapped=migrateInstax(old);
  assert.equal(mapped.style,'instax');assert.equal(mapped.caption,old.caption);
  assert.deepEqual(mapped.advByStyle.instax,old.advByStyle[style],'the selected retired profile is retained');
  assert.deepEqual(old,before,'migration leaves input data intact');
}
for(const style of STYLE_KEYS){
  const current={style,advByStyle:{instax:{port:{borderScale:'77'}}}};
  assert.equal(migrateInstax(current),current,'supported styles keep their existing settings');
}
console.log('PhotoFrame 색·매트·디자인 검사 통과 · 4096색 대비 · 구버전 톤 · 흰색 인스탁스 · 제거한 규격 이전 · 균등 여백 · 촬영 정보 제외');
