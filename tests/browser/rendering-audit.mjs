// Opt-in browser audit. Uses one production build; no worktrees or source copies.
// Set PLAYWRIGHT_MODULE_PATH if Playwright is supplied by the host runtime.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = resolve(process.env.DC_AUDIT_OUTPUT || join(root, 'dist', 'audit-results'));
await mkdir(output, { recursive: true });
const fixture = JSON.parse(await readFile(join(root, 'data/examples/public-example-2026-09-28.json'), 'utf8'));
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const decoded=decodeURIComponent(url.pathname);
    const pathname = decoded.endsWith('/') ? decoded + 'index.html' : decoded;
    const path = resolve(root, 'dist', '.' + pathname);
    if (!path.startsWith(join(root, 'dist') + sep)) throw new Error('Invalid path');
    let body = await readFile(path);
    // Absence test removes the link BEFORE parsing. No seasonal request or DOM decoration.
    if (extname(path) === '.html' && url.searchParams.get('audit-theme') === 'off') {
      body = Buffer.from(body.toString().replace(/\s*<link[^>]+href="[^\"]*seasonal-effects\.css[^\"]*"[^>]*>/g, ''));
    }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolveListen => server.listen(Number(process.env.DC_AUDIT_PORT || 4197), '127.0.0.1', resolveListen));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.DC_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: process.env.DC_HEADED !== '1',
  // Keep Playwright's isolated user-data-dir and debugging transport. Only
  // omit scheduling/compositing flags for this controlled comparison.
  ignoreDefaultArgs: process.env.DC_DEFAULT_BROWSER === '1' && process.env.DC_HEADED === '1' ? [
    '--disable-background-timer-throttling','--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding','--allow-pre-commit-input',
    '--enable-features=CDPScreenshotNewSurface',
  ] : undefined,
  args: ['--no-first-run', '--disable-background-networking'],
});
const browserCdp = await browser.newBrowserCDPSession();
const systemInfo = await browserCdp.send('SystemInfo.getInfo').catch(error => ({ error: error.message }));
const metadata = { date: new Date().toISOString(), browser: browser.version(), headless: process.env.DC_HEADED !== '1', defaultBrowserArgs:process.env.DC_DEFAULT_BROWSER === '1', warmups:Number(process.env.DC_WARMUPS??4), rawInput:process.env.DC_RAW_INPUT==='1', base,
  systemInfo, sourceHash: createHash('sha256').update(await readFile(join(root, 'frontend/seasonal-effects.css'))).digest('hex'),
  builtCssHash: createHash('sha256').update(await readFile(join(root, 'dist/frontend/seasonal-effects.css'))).digest('hex') };
const errors = [];

async function prepare(mode, width, height, dpr = 1, remote = null, mobile = false) {
  if(remote && mode==='B')throw new Error('Remote B mode is unsupported; use the local HTML absence test.');
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, acceptDownloads: true, isMobile: mobile, hasTouch: mobile });
  await context.addInitScript(seed => {
    if (!localStorage.getItem('dab-loadout-v1')) localStorage.setItem('dab-loadout-v1', JSON.stringify(seed));
    window.__audit = { clicks: [], events: [], longTasks: [], mutations: 0 };
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (entry.name === 'click') window.__audit.events.push({
          start: entry.startTime, duration: entry.duration, processingStart: entry.processingStart,
          processingEnd: entry.processingEnd, interactionId: entry.interactionId,
        });
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
      new PerformanceObserver(list => window.__audit.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });
    } catch {}
    document.addEventListener('click', event => {
      const entry = { inputTimestamp: event.timeStamp, capture: performance.now(), selector: event.target.id || event.target.tagName };
      window.__audit.clicks.push(entry);
      requestAnimationFrame(() => { entry.raf = performance.now(); });
    }, true);
    document.addEventListener('click', () => { window.__audit.clicks.at(-1).bubble = performance.now(); });
    document.addEventListener('DOMContentLoaded', () => new MutationObserver(records => { window.__audit.mutations += records.length; }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }));
  }, fixture);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push({ mode, width, message: error.message }));
  page.on('response', response => { if (response.status() >= 400) errors.push({ mode, width, url: response.url(), status: response.status() }); });
  await page.goto(remote || `${base}/?audit-theme=${mode === 'B' ? 'off' : 'on'}`, { waitUntil: 'networkidle' });
  await page.locator('.stat summary').first().waitFor();
  await page.evaluate(async () => { await document.fonts.ready; });
  if (mode !== 'A' && mode !== 'B') await page.evaluate(mode => {
    const style = document.createElement('style');
    style.id = 'audit-isolation';
    const parts = text => {
      const out = []; let depth = 0, start = 0;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '(') depth++;
        if (text[i] === ')') depth--;
        if (text[i] === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
      }
      out.push(text.slice(start)); return out;
    };
    const rootStyle = getComputedStyle(document.documentElement);
    const backgrounds = parts(rootStyle.backgroundImage);
    const sizes = parts(rootStyle.backgroundSize);
    const removeLayers = indices => `:root { background-image:${backgrounds.filter((_, i) => !indices.includes(i)).join(',')} !important; background-size:${sizes.filter((_, i) => !indices.includes(i)).join(',')} !important; }`;
    const modes = {
      C: '* ,*::before,*::after {animation:none !important}',
      D: removeLayers([2, 3]) + 'body::before{content:none!important} * ,*::before,*::after{filter:none!important;backdrop-filter:none!important;box-shadow:none!important}',
      E: removeLayers([1, 2, 3]) + 'footer::before{filter:none!important}',
      F: removeLayers(backgrounds.map((_, i) => i).filter(i => i >= 4)) + 'body::before,.workspace-heading::after{content:none!important}',
      moon: 'body::before{content:none!important}',
      root: ':root{background-image:none!important}',
      backdrop: '* ,*::before,*::after{backdrop-filter:none!important}',
      stars: removeLayers(backgrounds.map((_, i) => i).filter(i => i >= 4)),
    };
    style.textContent = modes[mode] || ''; document.head.append(style);
  }, mode);
  await page.waitForTimeout(300);
  return { page, context };
}

function summary(values) {
  const sorted = values.filter(Number.isFinite).sort((a,b) => a-b);
  if (!sorted.length) return { count: 0, median: null, p95: null, max: null };
  return { count: sorted.length, median: sorted[Math.floor((sorted.length-1)*.5)], p95: sorted[Math.ceil(sorted.length*.95)-1], max: sorted.at(-1) };
}

async function traceStart(cdp) {
  await cdp.send('Tracing.start', { transferMode: 'ReturnAsStream', categories: 'devtools.timeline,blink.user_timing,latencyInfo,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,disabled-by-default-devtools.timeline.invalidationTracking,cc,gpu' });
}
async function traceEnd(cdp, name) {
  const completion = new Promise(resolveTrace => cdp.once('Tracing.tracingComplete', resolveTrace));
  await cdp.send('Tracing.end');
  const { stream } = await completion;
  let json = '';
  for (;;) { const part = await cdp.send('IO.read', { handle: stream }); json += part.data; if (part.eof) break; }
  await cdp.send('IO.close', { handle: stream });
  await writeFile(join(output, `${name}.trace.json`), json);
  const events = JSON.parse(json).traceEvents;
  const input = events.find(e=>e.name==='EventTiming' && e.args?.data?.type==='click');
  const mainTasks = events.filter(e=>e.name==='RunTask' && e.ph==='X' && e.pid===input?.pid && e.tid===input?.tid);
  const groups = ['Paint', 'RasterTask', 'Layout', 'UpdateLayoutTree', 'CompositeLayers', 'Commit', 'RunTask'];
  const costs = Object.fromEntries(groups.map(name => {
    const durations = events.filter(e => e.name === name && e.ph === 'X' && e.dur).map(e => e.dur / 1000);
    return [name, { ...summary(durations), total: durations.reduce((a,b)=>a+b,0) }];
  }));
  const paints = events.filter(e => e.name === 'Paint' && e.args?.data).map(e => e.args.data);
  return { costs, mainThread:{pid:input?.pid,tid:input?.tid,tasks:summary(mainTasks.map(e=>e.dur/1000)),longTasks:mainTasks.filter(e=>e.dur>50000)}, paints: paints.slice(0, 100), eventTiming: events.filter(e => e.name === 'EventTiming' && e.ph==='b' && e.args?.data?.type==='click') };
}

async function benchmark(mode, width, height, samples = 30, traced = false, dpr = 1, remote = null) {
  const { context, page } = await prepare(mode, width, height, dpr, remote);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const layerPaints = [], layerTrees = [];
  if (traced) {
    await cdp.send('LayerTree.enable');
    cdp.on('LayerTree.layerPainted', event => layerPaints.push(event));
    cdp.on('LayerTree.layerTreeDidChange', event => layerTrees.push(event.layers));
  }
  const caseName = `${remote ? 'remote-' : ''}${mode}-${width}x${height}-dpr${dpr}${process.env.DC_RAW_INPUT==='1'?'-raw':''}${traced ? '-trace' : ''}`;
  const initial = await page.evaluate(() => ({ url: location.href, origin: location.origin, revision: document.querySelector('meta[name=build-revision]')?.content,
    seasonalLinks: [...document.querySelectorAll('link[rel=stylesheet]')].map(e=>e.href), dpr: devicePixelRatio, width: innerWidth, height: innerHeight,
    breakpoints: [380,700,1240,1600].map(w=>[w,matchMedia(`(max-width:${w}px)`).matches]),
    viewportArea: innerWidth*innerHeight, physicalArea: innerWidth*innerHeight*devicePixelRatio**2,
    screen: {width:screen.width,height:screen.height,outerWidth,outerHeight} }));
  const samplesOut = [];
  const cpuBefore = await browserCdp.send('SystemInfo.getProcessInfo').catch(()=>null);
  if (traced) await traceStart(cdp);
  for (const type of ['card', 'option']) {
    const target = type === 'card' ? page.locator('.stat summary').first() : page.locator('#alternate');
    await target.scrollIntoViewIfNeeded();
    for (let i=0;i<Number(process.env.DC_WARMUPS??4);i++) { await target.click(); await page.waitForTimeout(150); }
    const count = type === 'card' ? samples*2 : samples;
    for (let i=0;i<count;i++) {
      const before = await page.evaluate(() => ({ start: performance.now(), clicks: window.__audit.clicks.length,
        docHeight: document.documentElement.scrollHeight, mutations: window.__audit.mutations,
        visible: [...document.querySelectorAll('button,input,summary')].filter(e=>{ const r=e.getBoundingClientRect(); return r.width&&r.height&&r.top<innerHeight&&r.bottom>0; }).length,
        open: document.querySelector('.stat')?.open }));
      if(process.env.DC_RAW_INPUT==='1'){
        const rect=await target.boundingBox();await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
      }else await target.click();
      await page.waitForTimeout((traced ? 180 : 150)+(process.env.DC_RAW_INPUT==='1'?(i%7)*3:0));
      const after = await page.evaluate(before => ({
        click: window.__audit.clicks[before.clicks],
        timing: window.__audit.events.find(e=>Math.abs(e.start-window.__audit.clicks[before.clicks]?.inputTimestamp)<5),
        longTasks: window.__audit.longTasks.filter(e=>e.start>=before.start),
        docHeight: document.documentElement.scrollHeight, mutations: window.__audit.mutations,
      }), before);
      samplesOut.push({ type: type === 'option' ? 'option' : before.open ? 'collapse' : 'expand', before, after,
        geometryChanged: before.docHeight !== after.docHeight,
        input: after.timing ? after.timing.processingStart-after.timing.start : null,
        processing: after.timing ? after.timing.processingEnd-after.timing.processingStart : null,
        presentation: after.timing ? Math.max(0, after.timing.start+after.timing.duration-after.timing.processingEnd) : null,
        eventDuration: after.timing?.duration ?? null,
        rafDelay: after.click?.raf-after.click?.inputTimestamp,
        mutations: after.mutations-before.mutations });
    }
  }
  const trace = traced ? await traceEnd(cdp, caseName) : null;
  if(trace)for(const sample of samplesOut){
    const e=trace.eventTiming.find(e=>Math.abs(e.args.data.timeStamp-sample.after.click.inputTimestamp)<1)?.args.data;
    if(e)sample.traceExact={duration:e.duration,input:e.processingStart-e.timeStamp,processing:e.processingEnd-e.processingStart,presentation:e.timeStamp+e.duration-e.processingEnd};
  }
  const layerDescriptions=[];
  if(traced)for(const layer of layerTrees.at(-1)||[]){
    const node=layer.backendNodeId?await cdp.send('DOM.describeNode',{backendNodeId:layer.backendNodeId}).catch(()=>null):null;
    const reasons=await cdp.send('LayerTree.compositingReasons',{layerId:layer.layerId}).catch(()=>null);
    layerDescriptions.push({layer,node,reasons});
  }
  const metrics = await cdp.send('Performance.getMetrics');
  const cpuAfter = await browserCdp.send('SystemInfo.getProcessInfo').catch(()=>null);
  const aggregates = Object.fromEntries(['expand','collapse','option'].map(type => {
    const subset = samplesOut.filter(e=>e.type===type);
    return [type, { operations: subset.length, belowEventTimingThreshold: subset.filter(e=>!e.after.timing).length,
      eventDuration: summary(subset.map(e=>e.eventDuration)), input: summary(subset.map(e=>e.input)), processing: summary(subset.map(e=>e.processing)),
      presentation: summary(subset.map(e=>e.presentation)), rafSchedulingOnly: summary(subset.map(e=>e.rafDelay)),
      traceExactDuration:summary(subset.map(e=>e.traceExact?.duration)),traceExactPresentation:summary(subset.map(e=>e.traceExact?.presentation)),
      geometryChanged: subset.filter(e=>e.geometryChanged).length, mutations: summary(subset.map(e=>e.mutations)),
      longTasks: subset.flatMap(e=>e.after.longTasks) }];
  }));
  const result = { caseName, mode, initial, aggregates, metrics, cpuBefore, cpuAfter, samples: samplesOut, trace, layerPaints, layerTrees, layerDescriptions };
  await writeFile(join(output, `${caseName}.json`), JSON.stringify(result,null,2));
  console.log(JSON.stringify({ caseName, results: Object.fromEntries(Object.entries(aggregates).map(([type,a])=>[type,{event:a.eventDuration,presentation:a.presentation,processing:a.processing,geometryChanged:a.geometryChanged,longTasks:a.longTasks.length}])) }));
  await context.close();
  return result;
}

async function visual(width, mode) {
  const { context, page } = await prepare(mode, width, width < 768 ? 844 : 900,1,null,width<=430);
  const selectors = ['.toolbar','.toolbar-settings','.toolbar-actions','#class-picker','.skill-damage-share-number-wrap','.toggle','.equipment-panel','#inspector','.results-panel','.stat','footer'];
  const geometry = await page.evaluate(selectors => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    rects: Object.fromEntries(selectors.map(s=> {const e=document.querySelector(s),r=e?.getBoundingClientRect(),c=e&&getComputedStyle(e);
      return [s,e?{x:r.x,y:r.y,width:r.width,height:r.height,display:c.display,position:c.position,fontSize:c.fontSize,padding:c.padding}:null]})),
    controls: [...document.querySelectorAll('.toolbar button')].map(e=>({text:e.textContent,disabled:e.disabled,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,fontSize:getComputedStyle(e).fontSize})),
    themeDecorations: {moon:getComputedStyle(document.body,'::before').content,fire:getComputedStyle(document.querySelector('footer'),'::before').content},
  }),selectors);
  await page.screenshot({ path:join(output,`${mode}-${width}-top.png`) });
  await page.locator('.stat summary').first().click();
  await page.screenshot({ path:join(output,`${mode}-${width}-card.png`) });
  await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
  await page.screenshot({ path:join(output,`${mode}-${width}-footer.png`) });
  await page.goto(`${base}/buff-simulator/`,{waitUntil:'networkidle'});
  await page.screenshot({path:join(output,`${mode}-${width}-buff.png`)});
  geometry.buffOverflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  await context.close(); return {width,mode,...geometry};
}

async function regression(mode, width) {
  const { context, page } = await prepare(mode,width,844,1,null,width<=430);
  const passed=[];
  const check=(name,condition)=>{assert.ok(condition,name);passed.push(name)};
  const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('dab-loadout-v1')));
  const resultText=()=>page.locator('#damage-result .damage-summary strong').allTextContents();
  // Startup can fill weapon presets before recording the session's initial
  // snapshot. The saved baseline captures that actual initialized configuration.
  const initialResult=await resultText();let initialState=await state();
  check('initial history empty',await page.locator('#undo').isDisabled() && await page.locator('#redo').isDisabled());
  await page.locator('#baseline').click();
  check('baseline save does not create history',await page.locator('#undo').isDisabled());
  const savedBaseline=await page.evaluate(()=>localStorage.getItem('dab-baseline-v1'));
  initialState=JSON.parse(savedBaseline);
  await page.locator('#alternate').click();
  const changedState=await state();
  check('checkbox saved',changedState.lowerwearAlternativeEnabled!==initialState.lowerwearAlternativeEnabled);
  await page.locator('#undo').click();
  check('undo restores complete state',isDeepStrictEqual(await state(),initialState));
  await page.locator('#redo').click();
  check('redo restores changed state',isDeepStrictEqual(await state(),changedState));
  await page.locator('#restore-baseline').click();
  check('restore baseline restores state',isDeepStrictEqual(await state(),initialState));
  await page.locator('#undo').click();
  check('baseline restore is atomic and undoable',isDeepStrictEqual(await state(),changedState));
  await page.locator('#redo').click();
  check('calculation result unchanged after restore',isDeepStrictEqual(await resultText(),initialResult));
  check('restoring does not mutate saved baseline',await page.evaluate(()=>localStorage.getItem('dab-baseline-v1'))===savedBaseline);
  const percent=page.locator('#transcendence-skill-share-number');
  await percent.fill('70'); await percent.press('Enter');
  check('percentage setting updates',(await state()).transcendenceSkillDamageSharePct===70);
  await page.locator('#undo').click();
  check('percentage undo',(await state()).transcendenceSkillDamageSharePct===initialState.transcendenceSkillDamageSharePct);
  const job=page.locator('#class-picker input');
  await job.fill('KE');await job.press('Enter');
  check('class selection updates',(await state()).Job==='KE');
  await page.locator('#class-picker .picker-clear').click();
  check('class selection clears',await page.locator('#class-picker input').inputValue()==='');
  await page.locator('#undo').click();await page.locator('#undo').click();
  check('class selection undo returns original',(await state()).Job===initialState.Job);
  const card=page.locator('.stat summary').first();
  await card.click(); check('result attribute card expands',await page.locator('.stat').first().evaluate(e=>e.open));
  await card.click(); check('result attribute card collapses',!await page.locator('.stat').first().evaluate(e=>e.open));
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-loadout').click();
  const download=await downloadPromise; const downloaded=JSON.parse(await readFile(await download.path(),'utf8'));
  const importState=await state();
  await page.locator('#alternate').click();
  await page.locator('#loadout-file').setInputFiles({name:'roundtrip.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(downloaded))});
  await page.waitForFunction(()=>document.querySelector('#transfer-status').textContent.includes('已匯入'));
  check('export import roundtrip',isDeepStrictEqual(await state(),importState));
  await page.locator('#undo').click();
  check('import can be undone',(await state()).lowerwearAlternativeEnabled!==importState.lowerwearAlternativeEnabled);
  const reloadState=await state();await page.reload({waitUntil:'networkidle'});
  check('reload retains state',isDeepStrictEqual(await state(),reloadState));
  check('reload clears history',await page.locator('#undo').isDisabled() && await page.locator('#redo').isDisabled());
  check('reload retains baseline',await page.evaluate(()=>localStorage.getItem('dab-baseline-v1'))===savedBaseline);
  const draft=page.locator('#class-picker input');await draft.focus();await draft.press('End');await draft.pressSequentially('X');await draft.press('Control+z');
  check('text field native undo is not intercepted',!((await draft.inputValue()).endsWith('X'))&&isDeepStrictEqual(await state(),reloadState));
  await draft.press('Escape');
  if(width<700){
    await page.locator('.beast-accessory-slot').first().tap();
    check('mobile inspector opens',await page.locator('#inspector').isVisible());
    await page.locator('#inspector .picker-control input').first().tap();
    check('mobile picker modal opens',await page.locator('.mobile-picker-dialog').isVisible());
    check('mobile modal fits viewport',await page.locator('.mobile-picker-dialog').evaluate(e=>{const r=e.getBoundingClientRect();return r.width<=innerWidth&&r.height<=innerHeight}));
    await page.screenshot({path:join(output,`${mode}-${width}-modal.png`)});
    await page.locator('.mobile-picker-close').click();
    await page.locator('.inspector-close').click();
    check('mobile inspector closes',!await page.locator('#inspector').isVisible());
    await page.locator('#transcendence-skill-share-number').focus();
    await page.setViewportSize({width:844,height:390});
    check('orientation change retains field focus',await page.locator('#transcendence-skill-share-number').evaluate(e=>e===document.activeElement));
    await page.setViewportSize({width,height:360});
    await page.screenshot({path:join(output,`${mode}-${width}-short-viewport.png`)});
    check('short viewport retains percentage value',await page.locator('#transcendence-skill-share-number').inputValue()===String(reloadState.transcendenceSkillDamageSharePct));
    await page.setViewportSize({width,height:844});
  }
  await page.goto(`${base}/buff-simulator/`,{waitUntil:'networkidle'});
  const member=page.locator('[data-member]').first();await member.fill('KE');await member.press('Tab');
  check('buff member input operates',await page.locator('[data-member]').first().inputValue()==='KE');
  check('buff result exists',(await page.locator('#results').innerText()).length>0);
  const buffSingleResult=await page.locator('#results').innerText();
  await page.locator('[data-mode=challenge]').click();
  check('buff double team mode',await page.locator('[data-member]').count()===8);
  await page.locator('#boss-reduction').fill('25');await page.locator('#boss-reduction').press('Tab');
  check('buff boss setting operates',Number(await page.locator('#boss-reduction').inputValue())===25);
  const buffDoubleResult=await page.locator('#results').innerText();
  check('no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await context.close();return {mode,width,passed,initialResult,buffSingleResult,buffDoubleResult};
}

try {
  const phase=process.argv[2]||'probe';
  await writeFile(join(output,'environment.json'),JSON.stringify(metadata,null,2));
  if(phase==='probe') {
    const {page,context}=await prepare('A',2560,1344);
    console.log(JSON.stringify({metadata, title:await page.title(),url:page.url(),checkbox:await page.locator('#alternate').isChecked(),stats:await page.locator('.stat').count()},null,2));
    await page.screenshot({path:join(output,'baseline-top.png')});
    await context.close();
  } else if(phase==='bench') {
    const modes=(process.env.DC_MODES||'A,B,C,D,E,F').split(',');
    const sizes=JSON.parse(process.env.DC_SIZES||'[[2560,1344],[2560,350]]');
    const out=[];
    for(const size of sizes) for(const mode of modes) out.push(await benchmark(mode,...size,Number(process.env.DC_SAMPLES||30),process.env.DC_TRACE==='1',Number(process.env.DC_DPR||1),process.env.DC_REMOTE||null));
    await writeFile(join(output,'benchmark-summary.json'),JSON.stringify(out.map(({samples,trace,...r})=>r),null,2));
  } else if(phase==='visual') {
    const out=[];
    for(const width of [320,360,390,430,768,1024,1440,1920,2560]) for(const mode of ['A','B']) out.push(await visual(width,mode));
    const differences=[];
    for(const width of [320,360,390,430,768,1024,1440,1920,2560]){
      const a=out.find(r=>r.width===width&&r.mode==='A'),b=out.find(r=>r.width===width&&r.mode==='B');
      for(const [selector,rect] of Object.entries(a.rects)) if(JSON.stringify(rect)!==JSON.stringify(b.rects[selector])) differences.push({width,selector,activity:rect,regular:b.rects[selector]});
    }
    await writeFile(join(output,'geometry.json'),JSON.stringify({out,differences},null,2));
    console.log(JSON.stringify(out.map(r=>({width:r.width,mode:r.mode,overflow:r.overflow,buffOverflow:r.buffOverflow}))));
    console.log('GEOMETRY_DIFFERENCES',differences.length);
    assert.deepEqual(differences,[],'activity removal must preserve shared component geometry');
    assert.ok(out.every(r=>!r.overflow&&!r.buffOverflow),'no root horizontal overflow in either page/theme');
  } else if(phase==='regression') {
    const out=[];for(const width of [390,1440])for(const mode of ['A','B'])out.push(await regression(mode,width));
    assert.deepEqual(out[0].initialResult,out[1].initialResult,'themes produce equal calculation output');
    assert.deepEqual(out[2].initialResult,out[3].initialResult,'themes produce equal desktop calculation output');
    for(const [a,b] of [[out[0],out[1]],[out[2],out[3]]]){
      assert.equal(a.buffSingleResult,b.buffSingleResult,'Buff single-team results are theme independent');
      assert.equal(a.buffDoubleResult,b.buffDoubleResult,'Buff double-team results are theme independent');
    }
    await writeFile(join(output,'functional-regression.json'),JSON.stringify(out,null,2));
    console.log(JSON.stringify(out.map(({mode,width,passed})=>({mode,width,passed:passed.length}))));
  } else if(phase==='css') {
    const {page,context}=await prepare('A',1440,900);
    const collectRules=()=>{
      const out=[];const visit=(rules,file,scopes=[])=>{for(const rule of rules){
        if(rule.style)out.push({file,selector:rule.selectorText||rule.keyText,scopes,declarations:[...rule.style].map(name=>({name,value:rule.style.getPropertyValue(name),important:rule.style.getPropertyPriority(name)}))});
        if(rule.cssRules)visit(rule.cssRules,file,[...scopes,rule.conditionText||rule.name||'group']);
      }};
      for(const sheet of document.styleSheets)visit(sheet.cssRules,new URL(sheet.href).pathname);return out;
    };
    const rules=await page.evaluate(collectRules);
    await page.goto(`${base}/buff-simulator/`,{waitUntil:'networkidle'});
    rules.push(...await page.evaluate(collectRules));
    await writeFile(join(output,'css-rule-inventory.json'),JSON.stringify(rules,null,2));
    console.log(JSON.stringify({rules:rules.length,seasonalRules:rules.filter(r=>r.file.includes('seasonal')).length}));
    await context.close();
  }
  await writeFile(join(output,'browser-errors.json'),JSON.stringify(errors,null,2));
} finally { await browser.close(); await new Promise(resolveClose=>server.close(resolveClose)); }
