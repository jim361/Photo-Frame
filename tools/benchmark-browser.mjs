// Optional developer benchmark; Playwright is never an application dependency.
// PLAYWRIGHT_MODULE may point to an installed Playwright package directory; CHROME_PATH is optional.
// PHOTOFRAME_BENCH_COUNTS defaults to 1,6,12; PHOTOFRAME_BENCH_STYLE defaults to gallery.
// Output JSON goes to the OS temporary directory unless PHOTOFRAME_BENCH_OUTPUT is set.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const modulePath = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = createRequire(import.meta.url)(modulePath);
const html = await readFile(new URL('../index.html', import.meta.url));
const counts = (process.env.PHOTOFRAME_BENCH_COUNTS || '1,6,12').split(',').map(Number);
assert(counts.every(n => Number.isInteger(n) && n > 0 && n <= 24), 'Counts must be integers from 1 to 24.');
const style = process.env.PHOTOFRAME_BENCH_STYLE || 'gallery';
const output = process.env.PHOTOFRAME_BENCH_OUTPUT || path.join(os.tmpdir(), `photoframe-benchmark-${Date.now()}.json`);
const server = createServer((req, res) => {
  if (req.url.startsWith('/favicon.ico')) { res.writeHead(204).end(); return; }
  res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' }).end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = {
  measuredAt:new Date().toISOString(), sourceSha256:createHash('sha256').update(html).digest('hex'),
  environment:{ os:`${os.type()} ${os.release()}`, architecture:os.arch(), cpu:os.cpus()[0]?.model,
    node:process.version, chromePath:process.env.CHROME_PATH || 'Playwright bundled Chromium', headless:true,
    viewport:{ width:1440, height:1000 } },
  method:{ freshBrowserPerBatch:true, repeatCount:1, input:'6000×4000 generated JPEGs, quality 90; gradient, fine tile, diagonal lines, unique numbered labels; no EXIF',
    output:{ style, format:'JPEG', quality:92, longEdge:2048, ratio:'auto' },
    sink:'Mock save() records encoded Blob size/name only; no filesystem write, no browser download and no download delay.',
    timing:'App dataset load/export metrics; load wall time also includes the next two animation frames for preview. Fixture generation and export preflight are separate.',
    limits:'Synthetic image content and headless desktop only; no real camera/scanner JPEGs, mobile devices, disk throughput or memory measurement. One run per size, not a median.' },
  batches:[],
};
try {
  for (const count of counts){
    console.log(`Starting ${count} × 24 MP synthetic JPEGs in a fresh browser.`);
    const browser = await chromium.launch({ headless:true, executablePath:process.env.CHROME_PATH || undefined });
    const errors = [], externalRequests = [];
    try {
      report.environment.browser = browser.version();
      const page = await browser.newPage({ viewport:report.environment.viewport });
      await page.addInitScript(() => { window.benchmarkInitialStorage=localStorage.length; });
      page.setDefaultTimeout(120_000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (['error','assert'].includes(message.type())) errors.push(message.text()); });
      page.on('request', request => {
        if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) externalRequests.push(request.url());
      });
      await page.goto(`${origin}/?benchmark=${count}-${Date.now()}`);
      await page.waitForFunction(() => document.querySelector('#moveElement')?.disabled);
      const initialized = await page.evaluate(() => ({ initialStorageKeys:window.benchmarkInitialStorage,
        storageKeysAfterInit:Object.keys(localStorage),
        empty:state.shots.length === 0, gearColumns:document.querySelector('#gearGrid').children.length,
        eyesReady:[...document.querySelectorAll('.eye')].every(e => e.childElementCount > 0),
        theme:document.documentElement.dataset.theme }));
      assert.equal(initialized.initialStorageKeys,0);
      assert(initialized.empty && initialized.gearColumns===3 && initialized.eyesReady && initialized.theme==='light');
      const fixture = await page.evaluate(async count => {
        const began = performance.now(), canvas = document.createElement('canvas');
        canvas.width = 6000; canvas.height = 4000;
        const ctx = canvas.getContext('2d'), tile = document.createElement('canvas');
        tile.width = tile.height = 64;
        const t = tile.getContext('2d');
        for (let y=0;y<64;y+=8) for (let x=0;x<64;x+=8){
          t.fillStyle = (x+y)%16 ? '#ffffff' : '#142438'; t.fillRect(x,y,8,8);
        }
        window.benchmarkFiles = [];
        for (let i=0;i<count;i++){
          const gradient = ctx.createLinearGradient(0,0,6000,4000);
          gradient.addColorStop(0, `hsl(${180+i*4},55%,30%)`);
          gradient.addColorStop(0.55, '#eedbbb'); gradient.addColorStop(1, '#a25343');
          ctx.fillStyle = gradient; ctx.fillRect(0,0,6000,4000);
          ctx.globalAlpha = 0.18; ctx.fillStyle = ctx.createPattern(tile,'repeat'); ctx.fillRect(0,0,6000,4000);
          ctx.globalAlpha = 0.35; ctx.strokeStyle = '#23334f'; ctx.lineWidth = 2;
          ctx.beginPath();
          for (let x=-4000;x<6000;x+=31){ ctx.moveTo(x,0);ctx.lineTo(x+4000,4000); }
          ctx.stroke(); ctx.globalAlpha = 1;
          ctx.fillStyle = '#ffffff'; ctx.fillRect(120,140,3600,420);
          ctx.fillStyle = '#152133'; ctx.font = 'bold 170px sans-serif';
          ctx.fillText(`SYNTHETIC 24 MP / ${i+1}`,180,420);
          const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',0.9));
          window.benchmarkFiles.push(new File([blob],`synthetic-${i+1}.jpg`,{ type:'image/jpeg', lastModified:1 }));
        }
        canvas.width = canvas.height = tile.width = tile.height = 1;
        return { generationMs:Math.round(performance.now()-began), count,
          totalBytes:window.benchmarkFiles.reduce((sum,file)=>sum+file.size,0),
          fileBytes:window.benchmarkFiles.map(file=>file.size) };
      }, count);
      const measurements = await page.evaluate(async ({ count, style }) => {
        setStyle(style);
        Object.assign(gInfo,{ body:'Synthetic Camera',lens:'50mm',set:'F2.8 · 1/250s · ISO 100 · 50mm',date:'2026.09.07' });
        $('fmt').value='jpeg'; $('quality').value='92'; $('size').value='2048'; $('ratio').value='auto';
        const began=performance.now();
        await addFiles(window.benchmarkFiles);
        window.benchmarkFiles=null;
        await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
        const loaded={ ...JSON.parse(document.documentElement.dataset.loadMetrics), wallThroughPreviewMs:Math.round(performance.now()-began),
          preview:JSON.parse(document.documentElement.dataset.previewMetrics), decodedCount:state.shots.length };
        if (state.shots.length!==count) throw new Error(`Expected ${count} shots, decoded ${state.shots.length}`);
        const preflightStart=performance.now(); await prepareExport([...state.shots]);
        const preflight={ totalMs:Math.round(performance.now()-preflightStart), summary:$('exportSummary').textContent };
        const sink=[];
        save=async(blob,name)=>{ sink.push({ name,bytes:blob.size,type:blob.type });return { name,confirmed:true }; };
        state.dirHandle={ benchmarkMock:true }; // Disable download pacing; save() above performs no I/O.
        await exportShots([],state.exportPlan);
        return { loaded,preflight,exported:JSON.parse(document.documentElement.dataset.exportMetrics),sink };
      }, { count,style });
      assert.equal(measurements.exported.completed,count);
      assert.equal(measurements.exported.failed,0);
      assert.equal(measurements.sink.length,count);
      assert.deepEqual(errors,[]); assert.deepEqual(externalRequests,[]);
      report.batches.push({ count,initialized,fixture,...measurements,errors,externalRequests });
      console.log(JSON.stringify({ count,loadMs:measurements.loaded.totalMs,
        previewWallMs:measurements.loaded.wallThroughPreviewMs,preflightMs:measurements.preflight.totalMs,
        exportMs:measurements.exported.totalMs,completed:measurements.exported.completed }));
    } catch(error){
      report.batches.push({ count,error:String(error),errors,externalRequests });
      throw error;
    } finally { await browser.close(); }
  }
} finally {
  await writeFile(output,JSON.stringify(report,null,2));
  await new Promise(resolve=>server.close(resolve));
  console.log(`Benchmark report: ${output}`);
}
