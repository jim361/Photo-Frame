import assert from 'node:assert/strict';

// Existing Playwright smoke owns the browser and local synthetic photo fixtures.
export async function checkAlignment(page, loadTestPhotos){
  const tick = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const buttons = page.locator('#alignButtons button');
  assert.equal(await buttons.count(), 6, '촬영 정보·로고의 좌·중앙·우측 버튼 6개');
  assert.deepEqual(await buttons.evaluateAll(nodes => nodes.map(b => `${b.dataset.group}/${b.dataset.align}`).sort()),
    ['info/center','info/left','info/right','logo/center','logo/left','logo/right']);
  assert.equal(await page.locator('#alignButtons').evaluate(el =>
    !!el.closest('#dispPanel > .inner') && !el.closest('#movePanel')), true, '정렬은 펼친 주 영역에 위치한다');
  assert.equal(await buttons.evaluateAll(nodes => nodes.every(b => b.disabled)), true, '사진 없으면 정렬 비활성');
  assert.equal(await page.evaluate(() => {
    const before = JSON.stringify(adv); alignElements('info','left'); alignElements('logo','right');
    return before === JSON.stringify(adv) && STYLE_KEYS.every(s => !layoutUndoStack(s).length);
  }), true, '사진 없는 호출은 프로파일·되돌리기를 바꾸지 않는다');

  await loadTestPhotos(page);
  const matrix = await page.evaluate(async () => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
    const clone = value => JSON.parse(JSON.stringify(value));
    const near = (a,b,message,tolerance=1) => check(Math.abs(a-b)<=tolerance, `${message}: ${a} != ${b}`);
    const measure = () => {
      const shot=state.shots[state.current], o=withShot(withProfile(opts(),shot),shot), info={collect:true};
      const cv=render(shot.img,o,info); cv.width=cv.height=1;
      check(info.alignBounds && Number.isFinite(info.alignBounds.left) && Number.isFinite(info.alignBounds.right), '실제 render가 정렬 경계를 반환한다');
      check(info.alignBounds.left<info.alignBounds.right, `${state.style}: 유효한 내부 정보 폭`);
      check(info.alignBounds.left>=info.area.x && info.alignBounds.right<=info.area.x+info.area.w, `${state.style}: 내부 경계는 정보 영역 안에 있다`);
      return info;
    };
    const union = boxes => ({ left:Math.min(...boxes.map(b=>b.x)), right:Math.max(...boxes.map(b=>b.x+b.w)) });
    const selected = (boxes,group) => boxes.filter(b=>group==='logo'?b.key==='logo':b.key && b.key!=='logo');
    const target = (bounds,alignment) => alignment==='center'?(bounds.left+bounds.right)/2:bounds[alignment];
    const logoCanvas=document.createElement('canvas'); logoCanvas.width=100; logoCanvas.height=40;
    logoCanvas.getContext('2d').fillRect(12,6,76,28);
    const image=new Image(); image.src=logoCanvas.toDataURL(); await image.decode(); logoCanvas.width=logoCanvas.height=1;
    const values={body:'Camera',lens:'35mm',film:'FILM',set:'F2 · 1/125s',date:'2026.10.18',caption:'첫 줄\n다음 줄'};
    Object.assign(gInfo,values); Object.keys(gShow).forEach(k=>gShow[k]=true);
    state.shots.forEach(s=>{ s.exif={}; delete s.own; });
    let cases=0, actions=0;
    for(const style of STYLE_KEYS) for(const current of [0,1])
      for(const sideText of style==='instax' && current===0?['stack','rotate']:['stack'])
        for(const lines of ['1','2']) for(const logo of ['signature','image']){
          state.current=current; setStyle(style);
          const dir=photoDir(state.shots[current].img), p=profileFor(style,dir);
          Object.assign(p,DEF_ADV,{lines,sideText,fontScale:'75',bandScale:'160',borderScale:'130'});
          ELEM_KEYS.forEach((key,i)=>{ p[key+'DX']=String((i+1)*0.0037); p[key+'DY']=String((i-2)*0.0023); });
          // The selected advanced tab must never redirect an operation on the current photo.
          advTab=dir==='land'?'port':'land';
          logoState.img=logo==='image'?image:null; $('sigText').value='Signature';
          clearLayoutUndo();
          const label=`${style}/${dir}/${sideText}/${lines}/${logo}`;
          const initial=measure();
          check(ELEM_KEYS.every(k=>initial.boxes.some(b=>b.key===k)), `${label}: 개별 요소 박스가 모두 존재한다`);
          check(initial.boxes.every(b=>b.key), `${label}: null key 집합 박스가 남지 않는다`);
          check(initial.boxes.filter(b=>b.key==='cap').length===2, `${label}: 여러 줄 메모는 한 묶음이다`);
          check(initial.boxes.find(b=>b.key==='logo').label===(logo==='image'?'로고':'서명'), `${label}: 이미지 우선·서명 대체`);

          for(const group of ['info','logo']) for(const alignment of ['left','center','right']){
            const before=measure(), beforeAdv=clone(adv), history=layoutUndoStack().length;
            const oldBoxes=selected(before.boxes,group), oldUnion=union(oldBoxes);
            const dx=Math.round(target(before.alignBounds,alignment)-target(oldUnion,alignment));
            // Deliberately retain stale preview data across calls; only render() is authoritative.
            alignElements(group,alignment);
            const after=measure(), actual=selected(after.boxes,group), newUnion=union(actual);
            near(target(newUnion,alignment),target(after.alignBounds,alignment), `${label}/${group}/${alignment}: 경계 정렬`);
            check(same(after.alignBounds,before.alignBounds), `${label}: 정렬 경계 고정`);
            check(after.boxes.length===before.boxes.length, `${label}: 박스 개수 보존`);
            before.boxes.forEach((box,i)=>{
              const next=after.boxes[i], moving=group==='logo'?box.key==='logo':box.key!=='logo';
              check(box.key===next.key, `${label}: 박스 순서 보존`);
              near(next.x-box.x,moving?dx:0, `${label}/${box.key}: 같은 화면축 X 이동`, 1e-6);
              for(const k of ['y','w','h']) near(next[k],box[k], `${label}/${box.key}: ${k} 보존`,1e-6);
            });
            const keys=new Set(oldBoxes.map(b=>b.key+'DX'));
            for(const s of STYLE_KEYS) for(const d of ['port','land']) for(const key of PROFILE_KEYS){
              if(s===style && d===dir && keys.has(key))
                near(Number(adv[s][d][key])-Number(beforeAdv[s][d][key]), dx/before.renderW, `${label}/${key}: 저장 DX 비율`,1e-10);
              else check(adv[s][d][key]===beforeAdv[s][d][key], `${label}/${s}/${d}/${key}: 다른 묶음·축·프로파일 보존`);
            }
            check(layoutUndoStack().length===history+(dx?1:0), `${label}: 한 정렬은 한 undo`);
            const persisted=store.read('frame.settings',{}).advByStyle;
            check(same(persisted,adv), `${label}: 기존 설정 저장 경로`);
            check(same(cleanProjectSettings(JSON.parse(JSON.stringify(settingsSnapshot()))).advByStyle,adv), `${label}: 프로젝트 JSON roundtrip`);
            const entry={name:'정렬 검사',style,port:clone(adv[style].port),land:clone(adv[style].land)};
            check(same(cleanPresetLayouts(JSON.parse(JSON.stringify([entry])))[0],entry), `${label}: 배치 프리셋 JSON roundtrip`);
            const aligned=JSON.stringify(adv), saved=JSON.stringify(store.read('frame.settings',{})), count=layoutUndoStack().length;
            alignElements(group,alignment);
            check(JSON.stringify(adv)===aligned && layoutUndoStack().length===count, `${label}/${group}/${alignment}: 반복 정렬 무변경`);
            check(JSON.stringify(store.read('frame.settings',{}))===saved, `${label}: 반복 정렬 저장 무변경`);
            if(dx){
              undoLayout(); check(same(adv,beforeAdv), `${label}: undo가 전체 이전 배치를 복원한다`);
              check(layoutUndoStack().length===history, `${label}: undo 한 단계만 제거`);
              check(same(store.read('frame.settings',{}).advByStyle,beforeAdv), `${label}: undo도 저장된다`);
              alignElements(group,alignment);
              check(JSON.stringify(adv)===aligned, `${label}: undo 후 재정렬`);
            }
            actions++;
          }
          cases++;
        }

    // Hidden and missing fields retain their nonzero offsets; shot values override globals.
    state.current=1; setStyle('bottom'); logoState.img=null; $('sigText').value='';
    Object.assign(gInfo,values); Object.keys(gShow).forEach(k=>gShow[k]=true);
    state.shots[1].own={body:'장별 카메라',lens:'',show:{film:false,date:false,caption:false}};
    gShow.set=false; clearLayoutUndo();
    const before=measure(), previous=clone(adv), profile=profileFor('bottom','port');
    check(same(before.boxes.map(b=>b.key),['body']), '장별 빈값과 표시 설정 이후 실제 보이는 카메라만 측정');
    // Metadata is changed after the last preview to catch cached-box implementations.
    state._pv={...state._pv,boxes:[],renderW:1,alignBounds:{left:0,right:1}};
    alignElements('info','right');
    const after=measure(); near(after.boxes[0].x+after.boxes[0].w,after.alignBounds.right,'캐시 대신 장별 fresh render');
    for(const key of PROFILE_KEYS) if(key!=='bodyDX') check(profile[key]===previous.bottom.port[key], `${key}: 숨김·없는 요소 보존`);
    const noLogo=JSON.stringify(adv), count=layoutUndoStack().length;
    alignElements('logo','left');
    check(JSON.stringify(adv)===noLogo && layoutUndoStack().length===count,'없는 로고는 무변경');
    for(const [group,alignment] of [['invalid','left'],['info','invalid']]) alignElements(group,alignment);
    check(JSON.stringify(adv)===noLogo && layoutUndoStack().length===count,'잘못된 정렬 요청은 무변경');
    delete state.shots[1].own; Object.assign(gInfo,values); Object.keys(gShow).forEach(k=>gShow[k]=true);
    $('sigText').value='Signature'; refresh();
    return {cases,actions};
  });
  await tick();

  // Real clicks cover routing, visibility with precision controls closed, and mobile wrapping.
  await page.evaluate(() => { $('dispPanel').open=true; $('movePanel').open=false; });
  await tick();
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:844});
    for(const group of ['info','logo']) for(const alignment of ['left','center','right']){
      const button=page.locator(`#alignButtons [data-group="${group}"][data-align="${alignment}"]`);
      assert.equal(await button.isVisible(),true,'정밀 위치를 접어도 정렬 버튼 노출');
      await button.scrollIntoViewIfNeeded();
      const rect=await button.boundingBox();
      assert(rect.x>=-1 && rect.x+rect.width<=width+1,`${width}px 정렬 버튼 가로 넘침 없음`);
      await button.click();
      await tick();
      const error=await page.evaluate(({group,alignment})=>{
        const shot=state.shots[state.current],info={collect:true},cv=render(shot.img,withShot(withProfile(opts(),shot),shot),info);
        cv.width=cv.height=1;
        const boxes=info.boxes.filter(b=>group==='logo'?b.key==='logo':b.key&&b.key!=='logo');
        const left=Math.min(...boxes.map(b=>b.x)),right=Math.max(...boxes.map(b=>b.x+b.w));
        return alignment==='center'?(left+right-info.alignBounds.left-info.alignBounds.right)/2
          :alignment==='left'?left-info.alignBounds.left:right-info.alignBounds.right;
      },{group,alignment});
      assert(Math.abs(error)<=1,`${width}px ${group}/${alignment} 실제 클릭 정렬: ${error}`);
    }
  }
  await page.setViewportSize({width:1440,height:1000});

  const independent=await page.evaluate(async()=>{
    const tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const original=JSON.parse(JSON.stringify(adv)),results=[];
    for(const [showBoxes,ratio,free] of [[true,'none',false],[false,'1:1',true],[false,'3:4',true]]){
      Object.assign(adv,JSON.parse(JSON.stringify(original)));
      state.showBoxes=showBoxes; $('ratio').value=ratio; refresh(); await tick();
      if(free) zoomTo(.43);
      alignElements('info','left'); alignElements('logo','right');
      results.push(JSON.stringify(adv));
    }
    return results;
  });
  assert(independent.every(s=>s===independent[0]),'경계 off·비율 패딩·자유 확대가 저장 정렬값에 영향을 주지 않는다');

  await page.evaluate(()=>{
    const before=JSON.stringify(adv),project=cleanProjectSettings(JSON.parse(JSON.stringify(settingsSnapshot())));
    store.write('frame.settings',project);resetAdv();loadSettings();
    if(JSON.stringify(adv)!==before)throw Error('정렬 프로파일 프로젝트 재적용 실패');
    const style=state.style,entry=cleanPresetLayouts(JSON.parse(JSON.stringify([
      {name:'정렬 배치 roundtrip',style,port:{...adv[style].port},land:{...adv[style].land}},
    ])))[0];
    layouts.push(entry);store.write('frame.layouts',layouts);drawLayouts();
    adv[style].port.bodyDX='0.87';adv[style].land.logoDX='-0.31';clearLayoutUndo();
    const changed=JSON.stringify(adv[style]);
    $('layoutRow').querySelector('button[title="정렬 배치 roundtrip"]').click();
    if(JSON.stringify(adv)!==before || layoutUndoStack().length!==1)throw Error('정렬 배치 프리셋 실제 적용 실패');
    undoLayout();if(JSON.stringify(adv[style])!==changed)throw Error('배치 프리셋 적용 undo 실패');
    adv[style].port={...entry.port};adv[style].land={...entry.land};saveSettings();

    // Small bands and zero margins must still return ordered bounds in every orientation.
    for(const s of STYLE_KEYS) for(const shot of state.shots) for(const scale of [50,500]){
      const o={...withShot(withProfile({...opts(),style:s},shot),shot),bandScale:scale/100,borderScale:scale===50?0:3};
      const info={collect:true},cv=render(shot.img,o,info);cv.width=cv.height=1;
      if(!(info.alignBounds.left<info.alignBounds.right))throw Error(`${s}/${photoDir(shot.img)}/${scale}: 내부 정렬 경계 역전`);
    }
  });

  for(const mode of ['empty','hidden','signature','image']){
    await page.evaluate(mode=>{
      const visible=mode!=='empty' && mode!=='hidden';
      INFO_KEYS.forEach(k=>{gInfo[k]=mode==='empty'?'':'있는 정보';gShow[k]=visible;});
      logoState.img=null; $('sigText').value=mode==='signature'?'Signature':'';
      if(mode==='image'){
        const image=document.createElement('canvas');image.width=60;image.height=20;
        image.getContext('2d').fillRect(0,0,60,20);logoState.img=image;
      }
      refresh();
    },mode);
    await tick();
    const disabled=await buttons.evaluateAll(nodes=>Object.fromEntries(['info','logo'].map(group=>
      [group,nodes.filter(b=>b.dataset.group===group).every(b=>b.disabled)])));
    assert.deepEqual(disabled,{info:['empty','hidden'].includes(mode),logo:!['signature','image'].includes(mode)},`${mode}: 없는 묶음만 비활성`);
    await page.evaluate(disabled=>{
      const before=JSON.stringify(adv),count=layoutUndoStack().length;
      for(const group of ['info','logo'])if(disabled[group])alignElements(group,'right');
      if(JSON.stringify(adv)!==before || layoutUndoStack().length!==count)throw Error('비활성 묶음 직접 호출은 무변경이어야 한다');
    },disabled);
  }

  // Film portrait now uses the same screen axes and existing precision/drag save paths.
  await page.evaluate(()=>{
    state.current=1;setStyle('film');gInfo.body='Camera';gShow.body=true;logoState.img=null;$('sigText').value='';
    Object.assign(profileFor('film','port'),DEF_ADV);state.showBoxes=true;refresh();
  });
  await tick();
  const movement=await page.evaluate(()=>{
    const measure=()=>{const info={collect:true},shot=state.shots[1],cv=render(shot.img,withShot(withProfile(opts(),shot),shot),info);cv.width=cv.height=1;return info.boxes.find(b=>b.key==='body');};
    const before=measure();$('moveElement').value='body';$('moveStep').value='0.005';clearLayoutUndo();
    nudgeElement(1,0);const x=measure();nudgeElement(0,1);const y=measure();
    return {before,x,y,history:layoutUndoStack().length};
  });
  assert.equal(movement.x.y,movement.before.y,'세로 film 정밀 X 이동은 Y 보존');
  assert.equal(movement.y.x,movement.x.x,'세로 film 정밀 Y 이동은 X 보존');
  assert(Math.abs(movement.x.x-movement.before.x-4.5)<=1,'세로 film X는 화면 가로축');
  assert(Math.abs(movement.y.y-movement.x.y-4.5)<=1,'세로 film Y는 화면 세로축');
  assert.equal(movement.history,2,'정밀 이동은 각 한 undo');
  await tick();
  const dragged=await page.evaluate(()=>{
    const box=state._pv.boxes.find(b=>b.key==='body'),r=pv.getBoundingClientRect(),P=state._pv;
    const started=startBoxDrag({clientX:r.left+(box.x+box.w/2+P.padX)*zoom.scale,clientY:r.top+(box.y+box.h/2+P.padY)*zoom.scale});
    if(!started || boxDrag.key!=='body')throw Error('세로 film 카메라 박스 hit/drag 실패');
    boxDrag.ddx=18;boxDrag.ddy=9;endBoxDrag();
    const info={collect:true},shot=state.shots[1],cv=render(shot.img,withShot(withProfile(opts(),shot),shot),info);
    cv.width=cv.height=1;const after=info.boxes.find(b=>b.key==='body');
    return {dx:after.x-box.x,dy:after.y-box.y};
  });
  assert.deepEqual(dragged,{dx:18,dy:9},'세로 film 드래그는 화면 X/Y 좌표로 저장한다');
  await tick();
  assert.equal(await page.evaluate(()=>layoutUndoStack().length),3,'세로 film 드래그는 한 undo');

  const saved=await page.evaluate(()=>store.read('frame.settings',{}).advByStyle);
  await page.reload();await tick();
  assert.deepEqual(await page.evaluate(()=>settingsSnapshot().advByStyle),saved,'정렬·정밀 이동·드래그 프로파일 reload 보존');
  assert.equal(await buttons.evaluateAll(nodes=>nodes.every(b=>b.disabled)),true,'사진 없는 재로드에서 정렬 비활성');
  console.log(`정렬 브라우저 검사 통과 · ${matrix.cases} 배치 · ${matrix.actions} 정렬/반복/undo · 6개 실제 버튼 · 저장/프로젝트/프리셋 · 세로 film 화면축 · 320/390px`);
}
