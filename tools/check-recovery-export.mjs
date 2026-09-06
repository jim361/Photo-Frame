import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const source = name => {
  const match = script.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `${name} source exists`);
  return match[0];
};
const nodes = new Map();
const $ = id => {
  if (!nodes.has(id)) nodes.set(id, { value:'', hidden:false, disabled:false, textContent:'', children:[],
    replaceChildren(){ this.children = []; }, appendChild(child){ this.children.push(child); } });
  return nodes.get(id);
};
const context = vm.createContext({ $, assert, Blob, Set, Map, performance,
  console:{ info(){} }, requestAnimationFrame:callback => callback(0), setTimeout:callback => callback(),
  document:{ documentElement:{ dataset:{} }, createElement:() => ({ textContent:'' }) },
  state:{ shots:[], batch:new Set(), current:-1, projectDirty:false, fontBusy:0, exportBusy:false,
    projectMessage:'', projectTone:'', dirHandle:{}, exportCancel:false },
  pendingProject:null, deletedPhoto:null,
  EXIF_KEYS:['body','lens','date','set'], INFO_KEYS:['body','lens','film','date','set','caption'],
  loadImage:async () => ({ width:4000, height:6000 }), thumbnailData:() => 'local-thumbnail',
  readExif:async () => null, applyDetectedExif:() => false,
  drawStrip(){}, syncFields(){}, refresh(){}, toast(){}, syncActionButtons(){}, confirm:() => true,
  saveSettings(){ context.markProjectDirty(); },
  store:{ read:() => ({ style:'bottom' }) }, cleanProjectSettings:value => value,
  projectFontFiles:() => ({ files:[], missing:[] }), cleanProjectFonts:value => value,
  logos:[], logoState:{ name:'' }, PROJECT_KIND:'photoframe-project', PROJECT_VERSION:2,
  MAX_PROJECT_BYTES:64 * 1024 * 1024,
  opts:() => ({ ratio:'none', style:'bottom' }), withProfile:o => ({ ...o }), withShot:o => ({ ...o }),
  safeScale:() => 1, frameDims:(w,h) => ({ w,h:h + w * 0.078 }), ratioDims:d => d,
  niceRatio:(w,h) => `${w}:${h}`, boxOver:box => box.over,
  render:(img, options, info) => { info.boxes = img.overflow ? [{ over:true }] : []; return { width:img.width, height:img.height }; },
  padToRatio:cv => cv, downscale:cv => cv, toBlob:async () => ({ size:100 }),
});
for (const name of ['updateProjectStatus','markProjectDirty','markProjectClean','cleanExif','cleanOwn',
  'projectMismatchReasons','matchProjectPhoto','projectPhotoEntries','syncPendingPhotoOrder','projectPhotoData',
  'addFiles','filename','makeExportPlan','exportDimensions','prepareExport','exportShots'])
  vm.runInContext(source(name), context);
vm.runInContext(script.match(/\$\('projectSave'\)\.onclick = async \(\) => \{[^]*?\n\};/)[0], context);

const file = name => ({ name:`${name}.jpg`, size:100, lastModified:200, type:'image/jpeg' });
const pending = (names = ['a','b','c']) => ({ changed:false, current:0,
  photos:names.map((name, order) => ({ file:file(name), order, matched:false,
    own:{ caption:`saved ${name}`, film:null, show:{ date:false } }, exif:{ body:`Camera ${name}` } })) });
function reset(names){
  Object.assign(context.state, { shots:[], current:-1, batch:new Set(), projectDirty:false, projectMessage:'',
    exportBusy:false, exportCancel:false, exportPlan:null, exportRetry:null });
  context.pendingProject = pending(names);
}

// A final reconnect must never acknowledge edits made while other originals were absent.
reset();
await context.addFiles([file('a')]);
assert.equal(context.state.shots.length, 1);
context.state.shots[0].own.caption = 'edit during partial recovery';
context.markProjectDirty();
assert.match($('projectStatus').textContent, /1\/3장 · 저장 필요/);
await context.addFiles([file('c'), file('b')]);
assert.equal(context.pendingProject, null);
assert.equal(context.state.projectDirty, true);
assert.equal(context.state.shots[0].own.caption, 'edit during partial recovery');
assert.deepEqual(Array.from(context.state.shots, shot => shot.name), ['a.jpg','b.jpg','c.jpg']);

// Exercise the actual save handler, including the unconnected records and false/null values.
reset();
await context.addFiles([file('a')]);
context.state.shots[0].own.caption = 'saved partial edit';
context.pendingProject.photos[1].detectedExif = { body:'Scanner', date:'2026.09.07' };
context.pendingProject.photos[1].exifReview = 'scanner';
let savedProject;
context.save = async blob => { savedProject = JSON.parse(await blob.text()); return { confirmed:true, name:'partial.photoframe.json' }; };
await $('projectSave').onclick();
assert.equal(savedProject.photos.length, 3);
assert.deepEqual(savedProject.photos.map(photo => photo.file.name), ['a.jpg','b.jpg','c.jpg']);
assert.equal(savedProject.photos[0].own.caption, 'saved partial edit');
assert.equal(savedProject.photos[1].own.film, null);
assert.equal(savedProject.photos[1].own.show.date, false);
assert.equal(savedProject.photos[1].detectedExif.body, 'Scanner');
assert.equal(savedProject.photos[1].exifReview, 'scanner');
assert.equal(context.state.projectDirty, false);
assert.match($('projectNote').textContent, /미연결 2장 정보 포함/);
context.markProjectDirty();
await context.addFiles([file('b'), file('c')]);
assert.equal(context.state.projectDirty, true, 'edits after saving a partial project survive completion');

reset();
await context.addFiles([file('a')]);
let finishSave;
context.save = () => new Promise(resolve => { finishSave = resolve; });
const pendingSave = $('projectSave').onclick();
context.state.shots[0].own.caption = 'edit while disk write is pending';
context.markProjectDirty();
finishSave({ confirmed:true, name:'partial.photoframe.json' });
await pendingSave;
assert.equal(context.state.projectDirty, true, 'a completed earlier snapshot cannot acknowledge newer edits');
context.save = async blob => { savedProject = JSON.parse(await blob.text()); return { confirmed:true, name:'partial.photoframe.json' }; };

reset();
await $('projectSave').onclick();
assert.equal(savedProject.photos.length, 3, 'saving before any originals connect preserves every entry');
await context.addFiles([file('a'), file('b'), file('c')]);
assert.equal(context.state.projectDirty, false, 'connecting unchanged originals does not create edits');

// Connecting more originals must keep the relative order deliberately chosen for connected photos.
reset(['a','b','c','d']);
await context.addFiles([file('a'), file('c')]);
context.state.shots.reverse(); context.state.current = 0; context.markProjectDirty();
await context.addFiles([file('d'), file('b')]);
assert.deepEqual(Array.from(context.state.shots, shot => shot.name), ['c.jpg','b.jpg','a.jpg','d.jpg']);

reset();
await context.addFiles([file('a'), file('c')]);
context.state.shots.shift(); context.state.current = 0; context.markProjectDirty();
assert.deepEqual(Array.from(context.projectPhotoEntries(), entry => entry.file.name), ['b.jpg','c.jpg']);
await context.addFiles([file('b')]);
assert.deepEqual(Array.from(context.state.shots, shot => shot.name), ['b.jpg','c.jpg']);
assert.equal(context.state.projectDirty, true);

// Selection order does not renumber outputs; retries keep the original frozen filename.
reset(); context.pendingProject = null;
const shots = ['a','b','c'].map(name => ({ name:`${name}.jpg`, img:{ width:4000, height:6000 } }));
context.state.shots = shots; context.state.current = 0;
$('size').value = '2048'; $('fmt').value = 'jpeg'; $('quality').value = '92'; $('title').value = '여행';
const plan = context.makeExportPlan([shots[2], shots[0]]);
assert.deepEqual(Array.from(plan.jobs, job => job.name), ['여행(1).jpg','여행(3).jpg']);
const savedNames = []; let firstFailure = true;
context.save = async (_blob, name) => {
  if (name === '여행(1).jpg' && firstFailure){ firstFailure = false; throw new Error('disk'); }
  savedNames.push(name); return { confirmed:true, name };
};
await context.exportShots([], plan);
assert.deepEqual(savedNames, ['여행(3).jpg']);
assert.equal(context.state.exportRetry.jobs.length, 1);
context.state.shots.reverse();
await context.exportShots([], context.state.exportRetry);
assert.deepEqual(savedNames, ['여행(3).jpg','여행(1).jpg']);
assert.equal(context.state.exportRetry, null);

// Cancel after one image: the next image must not render, encode, or write.
context.state.shots = shots;
let renderCount = 0, writes = 0;
context.render = (_img, _opts, info) => { renderCount++; info.boxes = []; return { width:4000, height:6000 }; };
context.save = async (_blob, name) => { writes++; context.state.exportCancel = true; return { confirmed:true, name }; };
await context.exportShots(shots);
assert.equal(writes, 1); assert.equal(renderCount, 1);
assert.equal(context.state.lastExportMetrics.cancelled, 2);
assert.match($('exportStatus').textContent, /2장 취소됨/);

// Lost folder permission keeps all unattempted jobs available for retry.
context.save = async () => { const error = new Error('permission'); error.name = 'NotAllowedError'; throw error; };
await context.exportShots(shots);
assert.equal(context.state.exportRetry.jobs.length, 3);
assert.equal(context.state.exportBusy, false);

// Preflight visits every target, reports overflow, and does not save any images.
context.render = (_img, _options, info) => { info.boxes = [{ over:true }]; return { width:1000, height:1500 }; };
context.save = async () => { throw new Error('preflight must not write'); };
await context.prepareExport(shots);
assert.equal($('exportItems').children.length, 3);
assert.match($('exportSummary').textContent, /3장 요소 넘침/);
assert.match($('exportItems').children[0].textContent, /약 \d+ × \d+px/);
assert.equal(context.state.exportPlan.jobs.length, 3);
assert.equal(context.state.exportBusy, false);

console.log('PhotoFrame 복원·내보내기 동작 검사 통과 · 부분 저장/dirty/정렬/선택 순번/재시도/취소/권한/넘침');
