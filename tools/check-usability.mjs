import assert from 'node:assert/strict';

export async function checkUsability(page, loadTestPhotos){
  const tick=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const downloads=[];
  const onDownload=download=>{downloads.push(download.suggestedFilename());void download.cancel();};
  page.on('download',onDownload);
  try {
    await tick();
    let layouts=0;const failures=[];
    for(const loaded of [false,true]){
      if(loaded)await loadTestPhotos(page);
      for(const [width,height] of [[1440,1000],[1100,800],[390,844],[320,568],[768,844]]){
        await page.setViewportSize({width,height});
        for(const current of loaded?[0,1]:[-1]){
          await page.evaluate(current=>{
            window.scrollTo(0,0);$('settingsRail').scrollTop=0;
            if(current>=0){state.current=current;refresh();}
          },current);await tick();
          const label=`${width}×${height}/${loaded?(current?'세로':'가로'):'사진 없음'}`;
          if(!loaded){
            assert.equal(await page.locator('#toExport').isVisible(),false,`${label}: 초기 툴바는 숨김`);
            assert(await page.locator('#exportAll').isDisabled(),`${label}: 사진 없이 내보내기 불가`);
            layouts++;continue;
          }
          assert(await page.locator('#toExport').isVisible(),`${label}: 내보내기 이동 버튼 표시`);
          const layout=await page.evaluate(()=>{
            const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
            const button=rect($('toExport')),bar=rect($('zoombar')),controls=rect(document.querySelector('.zoomControls'));
            const view=rect(vp),photo=rect(pv),mobile=innerWidth<=1099;
            const overlaps=(a,b)=>a.left<b.right-.5&&a.right>b.left+.5&&a.top<b.bottom-.5&&a.bottom>b.top+.5;
            const floating=[...document.querySelector('.masthead').children].map(rect);
            return {button,bar,controls,view,photo,mobile,sticky:getComputedStyle(vp).position,
              width:document.documentElement.scrollWidth,barScroll:$('zoombar').scrollWidth-$('zoombar').clientWidth,
              barOverflow:getComputedStyle($('zoombar')).overflowX,controlsOverflow:getComputedStyle(document.querySelector('.zoomControls')).overflowX,
              overlap:overlaps(button,controls),photoClear:!overlaps(photo,bar)&&floating.every(r=>!overlaps(photo,r)),
              touches:[...document.querySelectorAll('#zoombar button')].map(e=>rect(e))};
          });
          assert(layout.button.left>=0&&layout.button.right<=width+1&&layout.button.top>=0&&layout.button.bottom<=height+1,
            `${label}: 내보내기 버튼은 화면 안 ${JSON.stringify(layout.button)}`);
          assert(!layout.overlap&&layout.controls.right<=layout.button.left+1,`${label}: 고정 버튼과 컨트롤이 겹치지 않음`);
          assert(layout.width<=width+1&&layout.barScroll<=1,`${label}: 문서·툴바 가로 넘침 없음`);
          assert(!['auto','scroll'].includes(layout.barOverflow)&&['auto','scroll'].includes(layout.controlsOverflow),`${label}: 가로 스크롤은 컨트롤 내부`);
          assert(layout.touches.every(r=>r.width>=48&&r.height>=48),`${label}: 버튼 터치 영역 48px`);
          if(layout.mobile)assert(layout.bar.height<=75,`${label}: 툴바 한 줄 ${layout.bar.height}px`);
          if(loaded){
            assert(layout.photoClear,`${label}: 화면 맞춤 사진이 상단 버튼·하단 툴바와 겹치지 않음`);
            assert(layout.photo.height>=80&&layout.photo.top>=layout.view.top-1&&layout.photo.bottom<=layout.view.bottom+1,`${label}: 사진은 미리보기 안에 표시`);
            if(layout.mobile){
              assert.equal(layout.sticky,'sticky',`${label}: 고정 미리보기`);
              assert(Math.abs(layout.view.height-Math.min(520,Math.max(304,height*.48)))<=1,`${label}: 기존 고정 미리보기 높이 유지`);
              assert.equal(await page.locator('#toPreview').isVisible(),false,`${label}: 중복 미리보기 이동 버튼 숨김`);
            }
          }
          await page.locator('#toExport').click();await tick();
          const destination=await page.evaluate(()=>{
            const r=$('exportLabel').getBoundingClientRect(),v=vp.getBoundingClientRect(),rail=$('settingsRail').getBoundingClientRect();
            return {focus:document.activeElement.id,top:r.top,bottom:r.bottom,left:r.left,right:r.right,
              clearTop:innerWidth<=1099?(document.body.classList.contains('has-photo')?v.bottom:0):Math.max(0,rail.top)};
          });
          assert.equal(destination.focus,'exportPanel',`${label}: 실제 내보내기 패널 포커스`);
          assert(destination.top>=destination.clearTop-1&&destination.bottom<=height+1&&destination.left>=0&&destination.right<=width+1,
            `${label}: 내보내기 제목이 고정 미리보기 뒤에 가리지 않음 ${JSON.stringify(destination)}`);
          layouts++;
        }
      }
    }

    // Native Tab focus must reveal buttons clipped by the controls' horizontal scroll area.
    await page.setViewportSize({width:320,height:568});
    await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('.zoomControls').scrollLeft=0;});await tick();
    const clipped=await page.locator('.zoomControls').evaluate(el=>{
      const r=el.getBoundingClientRect();
      return [...el.querySelectorAll('button:enabled')].filter(b=>b.getBoundingClientRect().right>r.right+1).map(b=>b.id);
    });
    assert(clipped.length,'320px에서는 일부 컨트롤이 가로 스크롤 안에 있음');
    const tabOrder=await page.locator('.zoomControls button:enabled').evaluateAll(nodes=>nodes.map(e=>e.id));
    await page.locator('#zFit').focus();
    for(const id of tabOrder){
      if(id!==tabOrder[0])await page.keyboard.press('Tab');
      await tick();
      const focused=await page.evaluate(()=>{
        const el=document.activeElement,r=el.getBoundingClientRect(),c=el.closest('.zoomControls').getBoundingClientRect();
        return {id:el.id,visible:r.left>=c.left-1&&r.right<=c.right+1,left:r.left,right:r.right,clipLeft:c.left,clipRight:c.right,scroll:document.querySelector('.zoomControls').scrollLeft};
      });
      assert.equal(focused.id,id,'자연스러운 Tab 순서');
      if(!focused.visible)failures.push(`${id}: 키보드 포커스가 잘린 컨트롤을 온전히 표시하지 못함 ${JSON.stringify(focused)}`);
    }
    assert(await page.locator('.zoomControls').evaluate(el=>el.scrollLeft>0),'Tab 이동이 실제 가로 스크롤을 발생시킴');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'toExport','스크롤 컨트롤 다음은 고정 내보내기 버튼');
    await page.evaluate(()=>{document.querySelector('.zoomControls').scrollLeft=0;zoomTo(zoom.scale*1.1);});
    const zoomBefore=await page.evaluate(()=>JSON.stringify(zoom));
    const controls=await page.locator('.zoomControls').boundingBox();
    await page.mouse.move(controls.x+controls.width/2,controls.y+controls.height/2);
    await page.mouse.wheel(180,0);await tick();
    assert.equal(await page.evaluate(()=>JSON.stringify(zoom)),zoomBefore,'툴바 휠 스크롤이 사진 확대를 바꾸지 않음');
    await page.waitForFunction(()=>document.querySelector('.zoomControls').scrollLeft>0);
    await page.locator('#zRatio').dblclick();await tick();
    assert.equal(await page.evaluate(()=>JSON.stringify(zoom)),zoomBefore,'툴바 더블클릭이 사진 배치를 바꾸지 않음');
    await page.evaluate(()=>zoomFit());

    await page.locator('#toExport').click();
    assert.equal(await page.evaluate(()=>state.exportPlan),null,'이동 버튼은 사전 검사·저장을 시작하지 않음');
    await page.locator('#exportAll').click();
    await page.waitForFunction(()=>!$('exportReview').hidden&&!state.exportBusy);
    assert(await page.locator('#exportReview').isVisible(),'기존 전체 내보내기 사전 확인 표시');
    assert.equal(await page.locator('#exportItems li').count(),2,'합성 PNG 두 장을 실제 사전 검사');
    assert.match(await page.locator('#exportSummary').textContent(),/2장.*PNG/);
    assert.equal(await page.evaluate(()=>state.exportPlan.jobs.length),2);
    assert.equal(await page.evaluate(()=>state.dirHandle==null&&state.lastExportMetrics==null),true,'사전 확인은 파일 저장을 하지 않음');

    await page.setViewportSize({width:1440,height:1000});await page.mouse.move(0,0);await tick();
    const contrast=selector=>page.locator(selector).first().evaluate(el=>{
      const rgba=s=>{const v=s.match(/[\d.]+/g).map(Number);return [...v.slice(0,3),v[3]??1];};
      const blend=(fg,bg)=>fg.slice(0,3).map((v,i)=>v*fg[3]+bg[i]*(1-fg[3]));
      const luminance=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((v,c,i)=>v+c*[.2126,.7152,.0722][i],0);
      let bg=[255,255,255];const parents=[];
      for(let node=el;node;node=node.parentElement)parents.unshift(node);
      for(const node of parents)bg=blend(rgba(getComputedStyle(node).backgroundColor),bg);
      const style=getComputedStyle(el),ink=blend(rgba(style.color),bg),a=luminance(ink),b=luminance(bg);
      return {id:el.id||el.className,color:style.color,background:style.backgroundColor,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    });
    const settle=()=>page.evaluate(()=>Promise.allSettled(document.getAnimations().map(a=>a.finished)));
    const originalTheme=await page.evaluate(()=>({theme:$('uiTheme').value,box:$('zBox').className,pressed:$('zBox').getAttribute('aria-pressed')}));
    const theme=[];
    try {
      await page.evaluate(()=>{$('uiTheme').value='light';$('uiTheme').dispatchEvent(new Event('input',{bubbles:true}));});await tick();
      const before=await page.evaluate(()=>[pv,state._pv.raw,state._pv.cv].map(c=>c.toDataURL()));
      for(const value of ['light','dark']){
        await page.evaluate(value=>{$('uiTheme').value=value;$('uiTheme').dispatchEvent(new Event('input',{bubbles:true}));},value);await tick();await settle();
        const scope=await contrast('.scopeTag'),solid=[];
        const ids=await page.locator('.btn.solid:enabled,#toExport').evaluateAll(nodes=>nodes.filter(e=>e.getClientRects().length).map(e=>e.id));
        for(const id of ids)solid.push(await contrast('#'+id));
        const deletion=[await contrast('.chip .x')],warnings=[];
        await page.locator('.chip .x').first().hover();await settle();deletion.push(await contrast('.chip .x'));
        await page.mouse.move(0,0);await settle();
        for(const selected of ['true','false']){
          await page.evaluate(selected=>{$('zBox').classList.add('warn');$('zBox').setAttribute('aria-pressed',selected);},selected);await settle();
          warnings.push({selected,hover:false,...await contrast('#zBox')});
          await page.locator('#zBox').hover();await settle();warnings.push({selected,hover:true,...await contrast('#zBox')});
          await page.mouse.move(0,0);await settle();
        }
        await page.evaluate(p=>{$('zBox').className=p.box;$('zBox').setAttribute('aria-pressed',p.pressed);},originalTheme);
        theme.push({value,scope,solid,deletion,warnings,
          unchanged:await page.evaluate(before=>[pv,state._pv.raw,state._pv.cv].every((c,i)=>c.toDataURL()===before[i]),before)});
      }
    } finally {
      await page.evaluate(p=>{
        $('zBox').className=p.box;$('zBox').setAttribute('aria-pressed',p.pressed);
        $('uiTheme').value=p.theme;$('uiTheme').dispatchEvent(new Event('input',{bubbles:true}));
      },originalTheme);await tick();
    }
    for(const result of theme){
      assert(result.scope.ratio>=4.5,`${result.value}: scopeTag 실제 대비 ${JSON.stringify(result.scope)}`);
      for(const warning of result.warnings)assert(warning.ratio>=4.5,`${result.value}: 경고 경계 버튼 대비 ${JSON.stringify(warning)}`);
      assert.equal(result.warnings[0].color,'rgb(255, 255, 255)',`${result.value}: 선택한 경고는 흰 글자`);
      for(const deletion of result.deletion)assert(deletion.ratio>=4.5,`${result.value}: 사진 삭제 버튼 대비 ${JSON.stringify(deletion)}`);
      assert(result.solid.length>=2,'활성 solid 버튼도 함께 검사');
      for(const b of result.solid){
        assert.equal(b.color,'rgb(255, 255, 255)',`${result.value}/${b.id}: 흰 글자 유지`);
        assert(b.ratio>=4.5,`${result.value}/${b.id}: 대비 ${b.ratio}`);
      }
      assert(result.unchanged,`${result.value}: UI 테마가 preview·raw·출력 Canvas 픽셀을 바꾸지 않음`);
    }
    assert.deepEqual(theme[1].solid.map(b=>[b.id,b.background]),theme[0].solid.map(b=>[b.id,b.background]),'다크 테마에서도 solid 버튼 배경 보존');

    const overlay=await page.evaluate(async()=>{
      const tick=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const previous={style:state.style,current:state.current,show:state.showBoxes,hot:state._hot,hotSig:state._hotSig,
        info:{...gInfo},showInfo:{...gShow},profile:{...adv.bottom.land},sig:$('sigText').value,logo:logoState.img};
      const ctx=pv.getContext('2d'),descriptors=['fillText','strokeRect'].map(k=>Object.getOwnPropertyDescriptor(ctx,k));
      const fill=ctx.fillText,stroke=ctx.strokeRect;let texts=[],strokes=[];
      try {
        state.current=0;state.showBoxes=true;state._hot=null;state._hotSig='';
        Object.assign(gInfo,{body:'Camera',lens:'35mm'});Object.keys(gShow).forEach(k=>gShow[k]=['body','lens'].includes(k));
        Object.assign(adv.bottom.land,DEF_ADV,{bandScale:'200'});$('sigText').value='';logoState.img=null;setStyle('bottom');refresh();await tick();
        const P=state._pv,body=P.boxes.find(b=>b.key==='body');
        if(P.boxes.length<2||!body||P.boxes.some(b=>boxOver(b,P)))throw Error('경계 검사용 실제 렌더는 두 개 이상의 정상 정보 박스가 필요합니다');
        ctx.fillText=function(text,...args){texts.push(String(text).trim());return fill.call(this,text,...args);};
        ctx.strokeRect=function(...args){strokes.push(this.strokeStyle);return stroke.apply(this,args);};
        const capture=drag=>{texts=[];strokes=[];paintOverlay(drag);return {texts:[...texts],strokes:[...strokes]};};
        const raw=P.raw.toDataURL(),idle=capture(null);
        state._hot={type:'box',key:'body'};const hover=capture(null);
        state._hot=null;const drag=capture({key:'body',ddx:0,ddy:0});
        const rawUnchanged=P.raw.toDataURL()===raw;
        adv.bottom.land.bodyDX='2';refresh();await tick();
        const overflow=capture(null),over=state._pv.boxes.find(b=>b.key==='body');
        return {idle,hover,drag,overflow,label:body.label,boxes:P.boxes.length,rawUnchanged,
          realOverflow:boxOver(over,state._pv),warning:$('zBox').classList.contains('warn')};
      } finally {
        ['fillText','strokeRect'].forEach((key,i)=>{if(descriptors[i])Object.defineProperty(ctx,key,descriptors[i]);else delete ctx[key];});
        Object.assign(gInfo,previous.info);Object.assign(gShow,previous.showInfo);Object.assign(adv.bottom.land,previous.profile);
        $('sigText').value=previous.sig;logoState.img=previous.logo;state.current=previous.current;
        state.showBoxes=previous.show;state._hot=previous.hot;state._hotSig=previous.hotSig;setStyle(previous.style);refresh();await tick();
      }
    });
    assert.deepEqual(overlay.idle.texts,[],'idle 경계에는 요소 이름 배지가 없음');
    for(const mode of ['idle','hover','drag'])assert(overlay[mode].strokes.length>=overlay.boxes,`${mode}: 박스 경계선은 유지`);
    assert.deepEqual(overlay.hover.texts,[overlay.label],'hover는 선택 요소 이름만 표시');
    assert.deepEqual(overlay.drag.texts,[overlay.label],'drag는 선택 요소 이름만 표시');
    assert(overlay.realOverflow&&overlay.warning,'실제 프로파일 이동의 넘침 경고');
    assert(overlay.overflow.texts.some(t=>t.includes(overlay.label)&&t.includes('넘침'))&&overlay.overflow.strokes.includes('#b42318'),'idle에서도 넘침 배지·빨간 경계 유지');
    assert(overlay.rawUnchanged,'경계 배지는 raw 출력 픽셀에 포함되지 않음');

    // Real pointer events must erase the hover badge on toolbar/header/viewport exits.
    const pointer=await page.evaluate(async()=>{
      const previous={body:gInfo.body,bodyShow:gShow.body,current:state.current,style:state.style,
        show:state.showBoxes,hot:state._hot,hotSig:state._hotSig};
      gInfo.body='Hover';gShow.body=true;state.current=0;state.showBoxes=true;state._hot=null;state._hotSig='';
      setStyle('bottom');refresh();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const P=state._pv,b=P.boxes.find(b=>b.key==='body'),r=pv.getBoundingClientRect();
      return {previous,idle:pv.toDataURL(),x:r.left+(b.x+b.w/2+P.padX)*zoom.scale,y:r.top+(b.y+b.h/2+P.padY)*zoom.scale};
    });
    try {
      for(const target of ['#toExport','#addPhotos','outside']){
        await page.mouse.move(pointer.x,pointer.y);await tick();
        assert.equal(await page.evaluate(()=>state._hot?.key),'body',`${target}: 실제 마우스 hover`);
        assert.equal(await page.evaluate(idle=>pv.toDataURL()===idle,pointer.idle),false,`${target}: hover 배지가 실제 픽셀에 표시`);
        if(target==='outside')await page.mouse.move(1438,500);else await page.locator(target).hover();
        await tick();
        assert.equal(await page.evaluate(()=>state._hot),null,`${target}: hover 해제`);
        assert.equal(await page.evaluate(idle=>pv.toDataURL()===idle,pointer.idle),true,`${target}: 남은 배지 없이 idle 픽셀로 복원`);
      }
    } finally {
      await page.evaluate(p=>{
        gInfo.body=p.body;gShow.body=p.bodyShow;state.current=p.current;state.showBoxes=p.show;
        state._hot=p.hot;state._hotSig=p.hotSig;setStyle(p.style);refresh();
      },pointer.previous);await tick();
    }
    assert.deepEqual(downloads,[],'이동·사전 검사에서 실제 다운로드 없음');
    assert.deepEqual(failures,[],'화면별 내보내기 이동·키보드 접근성 회귀');
    console.log(`사용성 검사 통과 · ${layouts} 화면/사진 조합 · Tab 가로 스크롤 · 내보내기 이동/사전 확인 · 밝음/다크 대비/픽셀 보존 · idle/hover/drag/넘침 경계`);
  } finally {page.off('download',onDownload);}
}
