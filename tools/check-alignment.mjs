import assert from 'node:assert/strict';

export async function checkAlignment(page, loadTestPhotos){
  const tick=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const buttons=page.locator('#alignButtons button');
  assert.deepEqual(await buttons.evaluateAll(nodes=>nodes.map(b=>b.dataset.align)),['left','center','right']);
  assert.equal(await buttons.evaluateAll(nodes=>nodes.every(b=>b.disabled)),true);
  assert.equal(await page.locator('#alignButtons').evaluate(el=>!!el.closest('#dispPanel > .inner')&&!el.closest('#movePanel')),true);
  await loadTestPhotos(page);
  const matrix=await page.evaluate(()=>{
    const check=(ok,message)=>{if(!ok)throw Error(message);};
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b), clone=v=>JSON.parse(JSON.stringify(v));
    const near=(a,b,message,tolerance=1)=>check(Math.abs(a-b)<=tolerance,`${message}: ${a} != ${b}`);
    const measure=()=>{
      const shot=state.shots[state.current],info={collect:true};
      const cv=render(shot.img,withShot(withProfile(opts(),shot),shot),info);cv.width=cv.height=1;
      check(info.alignBounds.left<info.alignBounds.right,'유효한 내부 정보 폭');return info;
    };
    const union=boxes=>({left:Math.min(...boxes.map(b=>b.x)),right:Math.max(...boxes.map(b=>b.x+b.w))});
    const target=(b,a)=>a==='center'?(b.left+b.right)/2:b[a];
    const overlaps=(a,b)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>1&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>1;
    const logo=document.createElement('canvas');logo.width=100;logo.height=40;logo.getContext('2d').fillRect(12,6,76,28);
    const square=document.createElement('canvas');square.width=square.height=900;
    state.shots.push({...state.shots[0],img:square,id:'alignment-square',exif:{}});
    const values={body:'Camera',lens:'35mm',film:'FILM',set:'F2 · 1/125s',date:'2026.10.18',caption:'첫 줄\n다음 줄'};
    Object.assign(gInfo,values);Object.keys(gShow).forEach(k=>gShow[k]=true);
    state.shots.forEach(s=>{s.exif={};delete s.own;});
    let cases=0,actions=0,visibleChanges=0;
    for(const style of STYLE_KEYS)for(const current of [0,1,2])
      for(const sideText of style==='instax'&&current===0?['stack','rotate']:['stack'])
        for(const lines of ['1','2'])for(const image of [false,true])for(const shifted of [false,true]){
          state.current=current;setStyle(style);
          const dir=photoDir(state.shots[current].img),p=profileFor(style,dir);
          Object.assign(p,DEF_ADV,{lines,sideText});
          if(shifted)ELEM_KEYS.forEach((key,i)=>{p[key+'DX']=String((i+1)*.0037);p[key+'DY']=String((i-2)*.0023);});
          advTab=dir==='land'?'port':'land';logoState.img=image?logo:null;$('sigText').value='Signature';clearLayoutUndo();
          const label=`${style}/${current}/${sideText}/${lines}/${image}/${shifted}`;
          const rotated=style==='film'&&current===1||style==='instax'&&current===0&&sideText==='rotate';
          check(ELEM_KEYS.every(k=>measure().boxes.some(b=>b.key===k)),`${label}: 켜진 요소 모두 측정`);
          for(const alignment of ['left','center','right']){
            const before=measure(),beforeAdv=clone(adv),history=layoutUndoStack().length;
            alignElements(alignment);
            const after=measure(),changed=!same(beforeAdv,adv);
            near(target(union(after.boxes),alignment),target(after.alignBounds,alignment),`${label}/${alignment}: 전체 경계`);
            check(same(after.alignBounds,before.alignBounds)&&after.boxes.length===before.boxes.length,`${label}: 경계·요소 유지`);
            before.boxes.forEach((b,i)=>{
              const a=after.boxes[i];check(b.key===a.key,`${label}: 요소 키 유지`);
              near(a.w,b.w,`${label}: 폭 유지`,1e-6);near(a.h,b.h,`${label}: 높이 유지`,1e-6);
              if(rotated){near(a.x-b.x,after.boxes[0].x-before.boxes[0].x,`${label}: 회전 열 유지`,1e-6);near(a.y,b.y,`${label}: 회전 Y 유지`,1e-6);}
              if(b.key==='cap'){
                const first=before.boxes.findIndex(x=>x.key==='cap');
                near(a.y-after.boxes[first].y,b.y-before.boxes[first].y,`${label}: 메모 줄 간격 유지`,1e-6);
              }
            });
            if(!rotated)for(let i=0;i<after.boxes.length;i++)for(let j=i+1;j<after.boxes.length;j++){
              const a=after.boxes[i],b=after.boxes[j];check(a.key===b.key||!overlaps(a,b),`${label}/${alignment}: ${a.key}·${b.key} 겹침`);
            }
            for(const s of STYLE_KEYS)for(const d of ['port','land'])for(const key of PROFILE_KEYS)
              if(s!==style||d!==dir||!/D[XY]$/.test(key))check(adv[s][d][key]===beforeAdv[s][d][key],`${label}: 다른 프로파일·크기 보존`);
            check(layoutUndoStack().length===history+(changed?1:0),`${label}: 한 번의 undo`);
            check(same(store.read('frame.settings',{}).advByStyle,adv),`${label}: 저장`);
            check(same(cleanProjectSettings(clone(settingsSnapshot())).advByStyle,adv),`${label}: 프로젝트 복원`);
            const aligned=clone(adv),count=layoutUndoStack().length;alignElements(alignment);
            check(same(adv,aligned)&&layoutUndoStack().length===count,`${label}/${alignment}: 반복 클릭 무변경`);
            if(changed){undoLayout();check(same(adv,beforeAdv),`${label}: undo`);alignElements(alignment);check(same(adv,aligned),`${label}: 재정렬`);}
            actions++;
          }
          // A global bounding-box check used to pass even when all buttons did nothing.
          if(!rotated&&!shifted){
            alignElements('left');const left=measure();alignElements('right');const right=measure();
            check(left.boxes.some((b,i)=>right.boxes[i].x-b.x>10),`${label}: 기본 설정의 실제 좌우 이동`);visibleChanges++;
          }
          cases++;
        }
    state.current=0;setStyle('instax');Object.assign(profileFor('instax','land'),DEF_ADV);
    logoState.img=null;$('sigText').value='';gShow.caption=false;
    for(const alignment of ['left','center','right']){
      alignElements(alignment);const info=measure();
      for(const key of ['body','lens','film','set']){
        const b=info.boxes.find(b=>b.key===key);near(target({left:b.x,right:b.x+b.w},alignment),target(info.alignBounds,alignment),`인스탁스 ${key} 줄별 ${alignment}`);
      }
    }
    state.current=1;setStyle('bottom');Object.assign(profileFor('bottom','port'),DEF_ADV,{fontScale:'250'});
    Object.assign(gInfo,{body:'Long Camera Model',lens:'Long Lens Model',film:'Film Stock',set:'F1.8 1/125 ISO400'});
    logoState.img=logo;gShow.caption=true;
    const before=measure();alignElements('left');const after=measure();
    check(after.boxes.some((b,i)=>b.y-before.boxes[i].y>10),'긴 줄은 다음 줄로 배치');
    check($('toast').textContent.includes('정보가 프레임을 넘습니다'),'공간 부족은 명시적으로 안내');
    for(const b of after.boxes)check(Number.isFinite(b.x)&&Number.isFinite(b.y),'넘치는 단일 요소도 유한 위치');
    const aligned=clone(adv);alignElements('left');check(same(adv,aligned),'긴 줄 반복 정렬 안정');
    state.shots.pop();square.width=square.height=1;
    Object.assign(profileFor('bottom','port'),DEF_ADV);Object.assign(gInfo,values);Object.keys(gShow).forEach(k=>gShow[k]=true);
    state.shots[1].own={body:'장별 카메라',lens:'',show:{film:false,date:false,caption:false}};gShow.set=false;
    logoState.img=null;$('sigText').value='';const previous=clone(adv);clearLayoutUndo();
    state._pv={...state._pv,boxes:[],renderW:1};alignElements('right');
    const single=measure();check(single.boxes.length===1&&single.boxes[0].key==='body','켜진 장별 정보만 정렬');
    near(single.boxes[0].x+single.boxes[0].w,single.alignBounds.right,'캐시 대신 fresh render');
    for(const key of PROFILE_KEYS)if(key!=='bodyDX')check(adv.bottom.port[key]===previous.bottom.port[key],`${key}: 숨김·빈 요소 보존`);
    const invalid=clone(adv);alignElements('top');alignElements('invalid');check(same(invalid,adv),'제거된 정렬 요청 무변경');
    delete state.shots[1].own;Object.assign(gInfo,values);Object.keys(gShow).forEach(k=>gShow[k]=true);$('sigText').value='Signature';refresh();
    return {cases,actions,visibleChanges};
  });
  await tick();await page.evaluate(()=>{$('dispPanel').open=true;$('movePanel').open=false;});
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:844});
    for(const alignment of ['left','center','right']){
      const b=page.locator(`#alignButtons [data-align="${alignment}"]`);await b.scrollIntoViewIfNeeded();const r=await b.boundingBox();
      assert(r.x>=-1&&r.x+r.width<=width+1,`${width}px 가로 넘침 없음`);
      const before=await page.evaluate(()=>JSON.stringify(adv));await b.click();await tick();
      assert.notEqual(await page.evaluate(()=>JSON.stringify(adv)),before,`${width}px 실제 ${alignment} 클릭`);
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  const independent=await page.evaluate(async()=>{
    const original=JSON.parse(JSON.stringify(adv)),results=[];
    for(const [showBoxes,ratio,free]of[[true,'none',false],[false,'1:1',true],[false,'3:4',true]]){
      Object.assign(adv,JSON.parse(JSON.stringify(original)));state.showBoxes=showBoxes;$('ratio').value=ratio;refresh();
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(free)zoomTo(.43);
      alignElements('left');results.push(JSON.stringify(adv));
    }return results;
  });
  assert(independent.every(s=>s===independent[0]),'경계·출력 비율·확대와 독립');
  for(const mode of ['empty','hidden','signature','image']){
    await page.evaluate(mode=>{
      INFO_KEYS.forEach(k=>{gInfo[k]=mode==='empty'?'':'있는 정보';gShow[k]=false;});logoState.img=null;$('sigText').value=mode==='signature'?'Signature':'';
      if(mode==='image'){const c=document.createElement('canvas');c.width=60;c.height=20;c.getContext('2d').fillRect(0,0,60,20);logoState.img=c;}refresh();
    },mode);await tick();
    assert.equal(await buttons.evaluateAll(nodes=>nodes.every(b=>b.disabled)),['empty','hidden'].includes(mode),`${mode}: 표시한 요소 기준 활성`);
  }
  await page.evaluate(()=>{
    state.current=1;setStyle('bottom');Object.assign(profileFor('bottom','port'),DEF_ADV,{bandScale:'200'});
    INFO_KEYS.forEach(k=>gShow[k]=k==='body');gInfo.body='Camera';logoState.img=null;$('sigText').value='';
    state.showBoxes=true;$('ratio').value='none';zoom.mode='fit';alignElements('center');refresh();
  });await tick();
  const beforeDrag=await page.evaluate(()=>{
    const b=state._pv.boxes.find(b=>b.key==='body'),r=pv.getBoundingClientRect(),P=state._pv;
    return {x:r.left+(b.x+b.w/2+P.padX)*zoom.scale,y:r.top+(b.y+b.h/2+P.padY)*zoom.scale,profile:{...adv.bottom.port},history:layoutUndoStack().length};
  });
  await page.mouse.move(beforeDrag.x,beforeDrag.y);await page.mouse.down();await page.mouse.move(beforeDrag.x+25,beforeDrag.y+8,{steps:4});await page.mouse.up();await tick();
  const afterDrag=await page.evaluate(()=>({profile:{...adv.bottom.port},history:layoutUndoStack().length}));
  assert.notEqual(afterDrag.profile.bodyDX,beforeDrag.profile.bodyDX,'정렬 후 실제 마우스 이동');assert.equal(afterDrag.history,beforeDrag.history+1);
  for(const key of Object.keys(beforeDrag.profile))if(!['bodyDX','bodyDY'].includes(key))assert.equal(afterDrag.profile[key],beforeDrag.profile[key]);
  const saved=await page.evaluate(()=>store.read('frame.settings',{}).advByStyle);await page.reload();await tick();
  assert.deepEqual(await page.evaluate(()=>settingsSnapshot().advByStyle),saved,'정렬·드래그 reload 보존');
  assert.equal(await buttons.evaluateAll(nodes=>nodes.every(b=>b.disabled)),true);
  console.log(`정렬 검사 통과 · ${matrix.cases} 배치 · ${matrix.actions} 정렬/반복/undo · 기본 ${matrix.visibleChanges} 배치 실제 좌우 변화 · 3개 버튼 · 줄바꿈·마우스 이동 · 320/390/768/1440px`);
}
