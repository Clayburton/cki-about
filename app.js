import * as THREE from 'three';

/* ==========================================================================
   CKI — About page engine
   Instant text first; a featherweight three.js pollen layer + interactions
   fade in on top. No GLB, no post stack. Everything is gated on visibility.
   ========================================================================== */

const stage   = document.getElementById('stage');
const canvas  = document.getElementById('pollen');
const eggLayer= document.getElementById('eggLayer');
const spot    = document.getElementById('spot');
const descent = document.getElementById('descent');
const coarse  = matchMedia('(pointer:coarse)').matches;
const reduce  = matchMedia('(prefers-reduced-motion:reduce)').matches;

/* shared pointer state (document/stage space + clip space for pollen) */
const P = { cx:-9999, cy:-9999, sx:-9999, sy:-9999, mx:-9, my:-9, active:false, last:0 };

/* -------------------------------------------------------------------------
   1) POLLEN  (three.js — one draw call, screen-space points)
   ------------------------------------------------------------------------- */
let renderer, scene, cam, pts, uniforms, contextOK = true;
const COUNT = coarse ? 90 : 150;

function initPollen(){
  renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:false, powerPreference:'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio||1, 1.75));
  scene = new THREE.Scene();
  cam = new THREE.Camera();               // identity — vertex shader outputs clip space directly

  const pos  = new Float32Array(COUNT*3);
  const seed = new Float32Array(COUNT*3); // speed, phase, size
  for(let i=0;i<COUNT;i++){
    pos[i*3]   = (Math.random()*2-1);     // x, scaled by aspect in shader
    pos[i*3+1] = (Math.random()*2-1);     // y
    pos[i*3+2] = 0.0;
    seed[i*3]   = 0.012 + Math.random()*0.03;   // rise speed
    seed[i*3+1] = Math.random()*6.283;          // phase
    seed[i*3+2] = 1.6 + Math.random()*4.0;       // size
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));  // vec3 — three injects `attribute vec3 position`
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed,3));

  uniforms = {
    uTime:{value:0}, uAspect:{value:1}, uPix:{value:renderer.getPixelRatio()},
    uMouse:{value:new THREE.Vector2(-9,-9)}, uInk:{value:0}
  };

  const mat = new THREE.ShaderMaterial({
    uniforms, transparent:true, depthTest:false, depthWrite:false,
    blending:THREE.NormalBlending,
    vertexShader:`
      attribute vec3 aSeed; uniform float uTime,uAspect,uPix,uInk; uniform vec2 uMouse;
      varying float vA; varying float vInk;
      void main(){
        vec2 p = position.xy;
        p.y = mod(p.y + uTime*aSeed.x + 1.0, 2.0) - 1.0;         // drift up, wrap
        p.x += sin(uTime*0.28 + aSeed.y)*0.035;                  // gentle sway
        vec2 m = uMouse; m.x *= uAspect;                          // mouse into x-space
        vec2 me = vec2(p.x*uAspect, p.y);
        vec2 d = m - me; float dist = length(d);
        me += normalize(d + 1e-4) * smoothstep(0.85,0.0,dist) * 0.10;   // lean toward cursor
        float tw = 0.55 + 0.45*sin(uTime*aSeed.x*3.4 + aSeed.y*6.28);   // twinkle
        vA  = (0.24 + 0.5*tw) * (1.0 - 0.55*uInk);
        vInk = uInk;
        gl_PointSize = aSeed.z * uPix * 1.6 * (0.85 + 0.25*tw);
        gl_Position = vec4(me.x/uAspect, me.y, 0.0, 1.0);
      }`,
    fragmentShader:`
      precision mediump float; varying float vA; varying float vInk;
      void main(){
        float d = length(gl_PointCoord-0.5);
        float a = smoothstep(0.5,0.06,d);
        vec3 mauve = vec3(0.76,0.48,0.55);
        vec3 ember = vec3(1.0,0.90,0.82);
        gl_FragColor = vec4(mix(mauve,ember,vInk), a*vA);
      }`
  });
  pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;                 // bare camera would otherwise cull it
  scene.add(pts);
  sizePollen();
  canvas.classList.add('on');

  canvas.addEventListener('webglcontextlost', e=>{ e.preventDefault(); contextOK=false; }, false);
  canvas.addEventListener('webglcontextrestored', ()=>{ contextOK=true; sizePollen(); }, false);
}

function sizePollen(){
  const w = innerWidth, h = innerHeight;
  canvas.style.height = h+'px';
  renderer.setSize(w, h, false);
  uniforms.uAspect.value = w/h;
  uniforms.uPix.value = renderer.getPixelRatio();
  followScroll();
}
function followScroll(){ canvas.style.transform = `translate3d(0,${scrollY}px,0)`; }

/* -------------------------------------------------------------------------
   2) PLAYABLE "pretty wave" divider  (canvas 2D + WebAudio, silent until tap)
   ------------------------------------------------------------------------- */
const wcv = document.getElementById('wave');
const wctx = wcv.getContext('2d');
const whint = document.getElementById('wavehint');
let wDPR=1, plucks=[], audio=null, ampBoost=0;

function sizeWave(){
  wDPR = Math.min(devicePixelRatio||1, 2);
  wcv.width  = wcv.clientWidth * wDPR;
  wcv.height = wcv.clientHeight * wDPR;
}
function rose(){ return getComputedStyle(document.documentElement).getPropertyValue('--rose').trim() || '#c27b8c'; }

function drawWave(t){
  const w = wcv.width, h = wcv.height, mid = h/2;
  wctx.clearRect(0,0,w,h);
  wctx.lineWidth = 2*wDPR;
  wctx.strokeStyle = rose();
  wctx.globalAlpha = 0.95;
  wctx.beginPath();
  const idle = 0.06;                                  // gentle breathing baseline
  const step = 2*wDPR;
  for(let x=0;x<=w;x+=step){
    const u = x/w;
    let y = Math.sin(u*10 + t*1.4) * (idle + ampBoost*0.5);
    for(const pk of plucks){                          // decaying pluck bumps
      const age = t - pk.t0; if(age>pk.life) continue;
      const env = (1-age/pk.life);
      const dx = (u - pk.u);
      y += Math.sin(age*pk.freq)*env*env * Math.exp(-dx*dx*60) * 0.42 * pk.dir;
    }
    const py = mid + y*h*0.42;
    x===0 ? wctx.moveTo(x,py) : wctx.lineTo(x,py);
  }
  wctx.stroke();
  wctx.globalAlpha = 1;
  plucks = plucks.filter(pk=> (t-pk.t0) < pk.life);
  ampBoost *= 0.94;
}

/* WebAudio — created on first user gesture only */
const SCALE=[0,2,4,7,9,12,14,16,19,21,24];            // major pentatonic
function pluck(u, dir){
  const now = performance.now()/1000;
  plucks.push({ u, t0:now, life:1.1, freq:26+u*22, dir });
  ampBoost = Math.min(ampBoost+0.5, 1.1);
  whint && whint.classList.add('gone');
  try{
    if(!audio) audio = new (window.AudioContext||window.webkitAudioContext)();
    if(audio.state==='suspended') audio.resume();
    const semi = SCALE[Math.min(SCALE.length-1, Math.floor(u*SCALE.length))];
    const freq = 220 * Math.pow(2, semi/12);
    const o = audio.createOscillator(), g = audio.createGain();
    o.type='triangle'; o.frequency.value=freq;
    const t0=audio.currentTime;
    g.gain.setValueAtTime(0.0001,t0);
    g.gain.exponentialRampToValueAtTime(0.06, t0+0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+0.9);
    o.connect(g).connect(audio.destination);
    o.start(t0); o.stop(t0+0.95);
  }catch(_){}
}
function waveU(e){ const r=wcv.getBoundingClientRect(); return Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)); }
let wDown=false, lastU=-1;
wcv.addEventListener('pointerdown', e=>{ wDown=true; wcv.setPointerCapture?.(e.pointerId); const u=waveU(e); lastU=u; pluck(u, e.clientY < wcv.getBoundingClientRect().top+wcv.clientHeight/2 ? -1:1); });
wcv.addEventListener('pointermove', e=>{ if(!wDown) return; const u=waveU(e); if(Math.abs(u-lastU)>0.07){ lastU=u; pluck(u, (Math.random()<.5?-1:1)); } });
addEventListener('pointerup', ()=>{ wDown=false; });

/* -------------------------------------------------------------------------
   3) SPOTLIGHT + HIDDEN EGGS  (mask reveal in the margins; idle-drift on touch)
   ------------------------------------------------------------------------- */
// little title winks in the top margins
const TITLE_EGGS = ['i am','moving on','do you?','pretty waves','the descent','i miss you',
              'insecure','you hurt me','worth it','made with love','curious?'];
// real song lyrics hidden through the dark "descent" — search around to find them
const DARK_LYRICS = ["moving on","you don't care about it","cause you never asked me",
              "why don't you say it","i don't sleep in no more","now look at you",
              "i'm just feeling so insecure","made with love","do you?","the descent"];

function buildEggs(){
  eggLayer.innerHTML='';
  const wrap = document.querySelector('.wrap');
  const wr = wrap.getBoundingClientRect();
  const sw = stage.clientWidth;
  const leftEdge  = wr.left + 20;                 // content column left
  const rightEdge = wr.right - 20;                // content column right
  const marginL = leftEdge, marginR = sw - rightEdge;

  // (a) title winks in the top margins — only where the column leaves clean room
  const top0 = 110, bottom = descent.offsetTop - 90;
  if(sw >= 1080 && Math.min(marginL, marginR) >= 120 && bottom-top0 > 200){
    TITLE_EGGS.forEach((txt,i)=>{
      const left = i%2===0;
      const el = document.createElement('span');
      el.className='egg'; el.textContent=txt;
      el.style.fontSize=(14+Math.random()*7).toFixed(0)+'px';
      el.style.top=(top0 + (bottom-top0)*((i+0.5)/TITLE_EGGS.length) + (Math.random()*30-15)).toFixed(0)+'px';
      el.style.transform=`translate(-50%,-50%) rotate(${(Math.random()*8-4).toFixed(1)}deg)`;
      el.style.left='0px';
      eggLayer.appendChild(el);
      const hw = el.offsetWidth/2 + 8;                 // clamp fully inside the outer margin
      let cx;
      if(left){ if(leftEdge-8 < hw*2){ el.remove(); return; } cx = Math.min(Math.max(hw, 12+Math.random()*(leftEdge-24-hw*2)+hw), leftEdge-8-hw); }
      else    { if(sw-rightEdge-8 < hw*2){ el.remove(); return; } cx = Math.min(Math.max(rightEdge+8+hw, rightEdge+8+hw+Math.random()*(marginR-16-hw*2)), sw-8-hw); }
      el.style.left=cx.toFixed(0)+'px';
    });
  }

  // (b) hidden song lyrics scattered through the dark descent — always
  buildDarkLyrics(sw);
  eggLayer.style.display = eggLayer.children.length ? '' : 'none';
}

function buildDarkLyrics(sw){
  const top = descent.offsetTop, h = descent.offsetHeight;
  if(h < 300) return;
  const cx = sw/2, cy = top + h/2;                    // centre holds the logo + button
  const exW = Math.min(sw*0.5, 380), exH = 220;       // keep clear of that centre
  const maxN = sw < 560 ? 6 : (sw < 900 ? 8 : 10);    // fewer on tight screens
  const placed = [];
  for(let k=0; k<DARK_LYRICS.length && placed.length<maxN; k++){
    const el = document.createElement('span');
    el.className = 'egg egg-dark'; el.textContent = DARK_LYRICS[k];
    el.style.fontSize = (14+Math.random()*5).toFixed(0)+'px';
    el.style.left='0px'; el.style.top='-9999px';
    eggLayer.appendChild(el);
    const ew = el.offsetWidth, eh = el.offsetHeight;
    let ok=false, x=0, y=0;
    for(let tries=0; tries<44 && !ok; tries++){
      x = Math.min(Math.max(ew/2+12, sw*0.10 + Math.random()*(sw*0.80)), sw-ew/2-12);
      y = top + 70 + Math.random()*(h-140);
      if(Math.abs(x-cx) < (exW+ew)/2 && Math.abs(y-cy) < (exH+eh)/2) continue;   // clear the centre
      ok = !placed.some(p=> Math.abs(x-p.x) < (ew+p.w)/2+16 && Math.abs(y-p.y) < (eh+p.h)/2+12); // no overlap
    }
    if(!ok){ el.remove(); continue; }
    el.style.left = x.toFixed(0)+'px'; el.style.top = y.toFixed(0)+'px';
    el.style.transform = `translate(-50%,-50%) rotate(${(Math.random()*10-5).toFixed(1)}deg)`;
    placed.push({x,y,w:ew,h:eh});
  }
}

// keep the inscription (Greek + English) on ONE line, scaled to fit its width
function fitInscription(){
  const m = document.getElementById('mystery'); if(!m) return;
  const g = m.querySelector('.m-greek'), e = m.querySelector('.m-trans');
  m.style.fontSize = '';                                            // reset to the CSS clamp
  const base = parseFloat(getComputedStyle(m).fontSize) || 24;
  const avail = Math.min(690, (m.parentElement.clientWidth || 360) * 0.94);
  const w = Math.max(g.scrollWidth, e.scrollWidth);
  if(w > 6) m.style.fontSize = Math.min(30, Math.max(12, base*avail/w)).toFixed(1)+'px';
}
function moveSpot(sx,sy){
  P.sx=sx; P.sy=sy;
  spot.style.transform=`translate3d(${sx}px,${sy}px,0)`;
  eggLayer.style.setProperty('--sx', sx+'px');
  eggLayer.style.setProperty('--sy', sy+'px');
}

/* -------------------------------------------------------------------------
   4) REACTIVE "pretty waves" text
   ------------------------------------------------------------------------- */
const waveWord = document.querySelector('.wave');
let waveHot=false;
if(waveWord){
  const txt = waveWord.getAttribute('data-wave')||waveWord.textContent;
  waveWord.textContent='';
  [...txt].forEach(ch=>{
    const s=document.createElement('span'); s.className='wl';
    s.textContent = ch===' ' ? ' ' : ch;
    waveWord.appendChild(s);
  });
  waveWord.addEventListener('pointerenter',()=>waveHot=true);
  waveWord.addEventListener('pointerleave',()=>waveHot=false);
  waveWord.addEventListener('pointerdown',()=>{waveHot=true; setTimeout(()=>waveHot=false,900);});
}
function tickWaveWord(t){
  if(!waveWord) return;
  const ls = waveWord.children;
  for(let i=0;i<ls.length;i++){
    const y = waveHot ? Math.sin(t*7 - i*0.5)*5 : 0;
    ls[i].style.transform = y ? `translateY(${y.toFixed(2)}px)` : '';
  }
}

/* -------------------------------------------------------------------------
   5) BIO photos bloom on hover (the other recedes)
   ------------------------------------------------------------------------- */
const bios = document.querySelector('.bios');
document.querySelectorAll('.bio').forEach(b=>{
  b.addEventListener('pointerenter',()=>{ if(coarse) return; b.classList.add('lit'); bios.classList.add('hovering'); });
  b.addEventListener('pointerleave',()=>{ b.classList.remove('lit'); bios.classList.remove('hovering'); });
});

/* -------------------------------------------------------------------------
   6) THE DESCENT — scroll white -> black, broadcast bg for iOS chrome
   ------------------------------------------------------------------------- */
const root = document.documentElement;
const themeMeta = document.querySelector('meta[name="theme-color"]');
function lerpHex(a,b,t){
  const p=(h)=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
  const A=p(a),B=p(b); const c=A.map((v,i)=>Math.round(v+(B[i]-v)*t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
let lastBg='', host=null;   // host = {vh, top} of the embedding iframe, when embedded
function updateDescent(){
  // standalone: use our own viewport. embedded (auto-grown iframe doesn't scroll internally):
  // the parent posts its viewport height + the iframe's top, so we can place the doorway for real.
  const vh = host ? host.vh : innerHeight;
  descent.style.minHeight = Math.round(vh) + 'px';   // full-screen so the "i am" moment centres vertically
  const rectTop = host ? (host.top + descent.offsetTop) : descent.getBoundingClientRect().top;
  // start the fade only once the doorway itself is climbing into view, so the
  // inscription just above it stays on clean white (no low-contrast grey stretch)
  const p = Math.max(0, Math.min(1, (vh*0.60 - rectTop) / (vh*0.44)));
  root.style.setProperty('--t', p.toFixed(3));
  const bg = lerpHex('#ffffff','#08070a', p);
  const fg = lerpHex('#1a1a1a','#f4f1ee', p);
  root.style.setProperty('--bg', bg);
  root.style.setProperty('--fg', fg);
  if(uniforms) uniforms.uInk.value = p;
  // keep the spotlight lit through the descent — the "spotlight from i am" roams the black
  if(bg!==lastBg){
    lastBg=bg;
    const hex = '#'+bg.match(/\d+/g).map(n=>(+n).toString(16).padStart(2,'0')).join('');
    if(themeMeta) themeMeta.setAttribute('content', hex);
    try{ parent.postMessage({cki:'about', type:'bg', color:hex}, '*'); }catch(_){}
  }
}

/* -------------------------------------------------------------------------
   7) auto-grow the embedding iframe
   ------------------------------------------------------------------------- */
let lastH=0;
function postHeight(){
  const h = Math.ceil(document.body.scrollHeight);
  if(Math.abs(h-lastH) > 8){ lastH=h; try{ parent.postMessage({cki:'about', type:'height', h}, '*'); }catch(_){} }
}

/* -------------------------------------------------------------------------
   8) mystery inscription (reveal translation) — from the reference
   ------------------------------------------------------------------------- */
(function(){
  const T={ en:"If you die before you die, you won't die when you die.",
    es:"Si mueres antes de morir, no morirás cuando mueras.",
    fr:"Si tu meurs avant de mourir, tu ne mourras pas quand tu mourras.",
    de:"Wenn du stirbst, bevor du stirbst, wirst du nicht sterben, wenn du stirbst.",
    it:"Se muori prima di morire, non morirai quando morirai.",
    pt:"Se morreres antes de morrer, não morrerás quando morreres.",
    nl:"Als je sterft voordat je sterft, zul je niet sterven wanneer je sterft.",
    ru:"Если ты умрёшь прежде, чем умрёшь, ты не умрёшь, когда умрёшь.",
    ja:"死ぬ前に死ねば、死ぬときに死なない。", zh:"如果你在死亡之前死去，你死时就不会死。",
    ko:"죽기 전에 죽으면, 죽을 때 죽지 않는다.", ar:"إذا مُتَّ قبل أن تموت، فلن تموت عندما تموت.",
    hi:"यदि तुम मरने से पहले मर जाओ, तो जब तुम मरोगे तब नहीं मरोगे।" };
  const lang=(navigator.language||'en').slice(0,2).toLowerCase();
  const trans=document.getElementById('mTrans');
  trans.textContent = T[lang]||T.en; trans.setAttribute('lang', T[lang]?lang:'en');
  if(lang==='ar') trans.setAttribute('dir','rtl');
  const m=document.getElementById('mystery');
  if(!matchMedia('(hover:hover)').matches) m.addEventListener('click',function(){this.classList.toggle('revealed');});
  m.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){e.preventDefault();this.classList.toggle('revealed');}});
})();

/* -------------------------------------------------------------------------
   pointer + idle drift wiring
   ------------------------------------------------------------------------- */
function onMove(cx,cy){
  P.cx=cx; P.cy=cy; P.active=true; P.last=performance.now();
  P.mx = (cx/innerWidth)*2-1; P.my = -((cy/innerHeight)*2-1);
  const r = stage.getBoundingClientRect();
  moveSpot(cx-r.left, cy-r.top);
  if(!spot.classList.contains('on') && !coarse) spot.classList.add('on');
}
addEventListener('pointermove', e=>{ if(e.pointerType!=='touch') onMove(e.clientX,e.clientY); }, {passive:true});
addEventListener('pointerleave', ()=>{ P.active=false; });

/* host (embedding iframe) tells us where it sits so the descent tracks the real scroll */
addEventListener('message', e=>{
  const d=e.data||{};
  if(d.ckiHost==='about'){ host={vh:d.vh, top:d.top}; updateDescent(); }
});

/* -------------------------------------------------------------------------
   ONE render loop, gated on visibility + on-screen
   ------------------------------------------------------------------------- */
let visible=true, running=false;
const io = new IntersectionObserver(es=>{ visible = es[0].isIntersecting; if(visible) kick(); }, {threshold:0});
io.observe(canvas);
function kick(){ if(!running && visible && !document.hidden){ running=true; requestAnimationFrame(loop); } }

function loop(ts){
  if(!visible || document.hidden){ running=false; return; }
  const t = ts/1000;

  // idle / touch: drift the spotlight on a slow lissajous over whatever's on screen,
  // so hidden lyrics get revealed wherever you've scrolled (top winks or dark descent)
  if((!P.active || coarse) && performance.now()-P.last > (coarse?0:2500)){
    const sw = stage.clientWidth;
    const vis = host ? {top:-host.top, h:host.vh} : {top:scrollY, h:innerHeight};
    const dx = sw*(0.5 + 0.40*Math.sin(t*0.32));                // stage-space x
    const dy = vis.top + vis.h*(0.5 + 0.42*Math.sin(t*0.21+1.3));  // roam the visible band (document)
    moveSpot(dx, dy);
    P.mx = (dx/(sw||innerWidth))*2-1;
    P.my = -(((dy - scrollY)/innerHeight)*2-1);                // document -> canvas clip
    if(!spot.classList.contains('on')) spot.classList.add('on');
  }

  if(contextOK && renderer){
    uniforms.uTime.value = t;
    uniforms.uMouse.value.set(P.mx, P.my);
    followScroll();
    renderer.render(scene, cam);
  }
  drawWave(t);
  tickWaveWord(t);
  requestAnimationFrame(loop);
}

/* keep the lens under the cursor while scrolling (no pointermove fires) */
addEventListener('scroll', ()=>{
  followScroll();
  if(P.active && !coarse){
    const r = stage.getBoundingClientRect();
    moveSpot(P.cx-r.left, P.cy-r.top);
  }
  updateDescent();
}, {passive:true});

/* -------------------------------------------------------------------------
   boot + lifecycle
   ------------------------------------------------------------------------- */
function relayout(){ sizeWave(); updateDescent(); buildEggs(); fitInscription(); postHeight(); }  // descent sized before eggs are placed
addEventListener('resize', ()=>{ if(renderer) sizePollen(); relayout(); });
// real viewport can appear after load (embedded / fronted preview) -> re-render synchronously
new ResizeObserver(()=>{
  if(renderer) sizePollen();
  relayout();
  if(contextOK && renderer){ uniforms.uTime.value = performance.now()/1000; renderer.render(scene,cam); }
  drawWave(performance.now()/1000);
}).observe(document.documentElement);
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) kick(); });
document.fonts && document.fonts.ready.then(relayout);
addEventListener('pageshow', e=>{                                   // bfcache: repaint / recover context
  if(e.persisted){ if(renderer && renderer.getContext().isContextLost()){ location.reload(); return; } if(renderer) sizePollen(); kick(); }
});

try{ if(!reduce) initPollen(); }catch(_){ /* WebGL fail -> text-only, still perfect */ }
sizeWave();
updateDescent();
buildEggs();
fitInscription();
postHeight();
kick();
setTimeout(()=>{ fitInscription(); postHeight(); }, 400);   // after fonts/images settle

/* debug */
window.__about = {
  P, pollenOK:()=>contextOK, height:postHeight, eggs:buildEggs,
  renderOnce(t=1.5){ if(renderer){ uniforms.uTime.value=t; uniforms.uMouse.value.set(P.mx,P.my); followScroll(); renderer.render(scene,cam); } drawWave(t); tickWaveWord(t); },
  spotAt(cx,cy){ const r=stage.getBoundingClientRect(); moveSpot(cx-r.left,cy-r.top); P.mx=(cx/innerWidth)*2-1; P.my=-((cy/innerHeight)*2-1); spot.classList.add('on'); },
  probe(){
    if(!renderer) return 'no renderer';
    uniforms.uTime.value=2.0; uniforms.uMouse.value.set(-9,-9); renderer.render(scene,cam);
    const gl=renderer.getContext(); const w=gl.drawingBufferWidth, h=gl.drawingBufferHeight;
    const px=new Uint8Array(w*h*4); gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
    let lit=0,maxA=0; for(let i=3;i<px.length;i+=4){ if(px[i]>0){lit++; if(px[i]>maxA)maxA=px[i];} }
    return {bufW:w,bufH:h,litPixels:lit,maxAlpha:maxA};
  }
};
