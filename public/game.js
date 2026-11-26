import {stickSVG,keypadSVG,PHONE_FLIP,MOUSE,SWIPE} from './controls.js';
import {Gyro,yawPitchOf} from './gyro.js';
(async function(){
'use strict';
const $=s=>document.querySelector(s);
if(!window.THREE){ $('#go').textContent='The 3D engine did not load. Reload the page to try again.'; return; }
const V3=THREE.Vector3, UP=new V3(0,1,0);
let seed=20260918;
const rnd=()=>{seed=(seed*16807)%2147483647;return (seed-1)/2147483646;};
const R=(a,b)=>a+rnd()*(b-a);
const pick=a=>a[(rnd()*a.length)|0];
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const isTouch=matchMedia('(pointer: coarse)').matches||'ontouchstart' in window;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- renderer, scene ---------------- */
const canvas=$('#c');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
const Q={
  full:{lod:24,hi:11,mid:34,pr:Math.min(devicePixelRatio,1.75),fillIn:.92,fillOut:.74,walk:1500,stand:520,walkIn:34},
  light:{lod:14,hi:6,mid:20,pr:Math.min(devicePixelRatio,1.15),fillIn:.46,fillOut:.3,walk:560,stand:190,walkIn:18}
};
let quality=isTouch?'light':'full';
renderer.setPixelRatio(Q[quality].pr);
renderer.setSize(innerWidth,innerHeight,false);
renderer.toneMapping=THREE.NoToneMapping;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const MAXANI=Math.min(8,renderer.capabilities.getMaxAnisotropy());

const scene=new THREE.Scene();
const FOG_OUT=new THREE.Color('#c99a80'), FOG_IN=new THREE.Color('#6a4a2c');
scene.fog=new THREE.FogExp2(FOG_OUT.clone(),0.0032);
const camera=new THREE.PerspectiveCamera(72,innerWidth/innerHeight,0.1,1400);
camera.rotation.order='YXZ';

/* post: HDR target → bright pass → 3-level blur → GTA-style grade (bloom, ACES, warm highs / cool shadows, S-curve, vignette, grain) */
const post=(()=>{
  const hf=THREE.HalfFloatType;
  const main=new THREE.WebGLRenderTarget(1,1,{type:hf,samples:renderer.capabilities.isWebGL2?4:0});
  const lv=[0,1,2].map(()=>[0,1].map(()=>new THREE.WebGLRenderTarget(1,1,{type:hf,depthBuffer:false})));
  const fsScene=new THREE.Scene(),fsCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const tri=new THREE.BufferGeometry();tri.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));tri.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,2,0,0,2],2));
  const quad=new THREE.Mesh(tri);quad.frustumCulled=false;fsScene.add(quad);
  const VS='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const sm=(u,fs)=>new THREE.ShaderMaterial({uniforms:u,vertexShader:VS,fragmentShader:fs,depthTest:false,depthWrite:false});
  const bright=sm({t:{value:null},th:{value:.9}},`uniform sampler2D t;uniform float th;varying vec2 vUv;void main(){vec3 c=texture2D(t,vUv).rgb;if(any(isnan(c))||any(isinf(c)))c=vec3(0.);c=min(c,vec3(64.));float l=max(c.r,max(c.g,c.b));gl_FragColor=vec4(c*max(l-th,0.)/max(l,1e-4),1.);}`);
  const blur=sm({t:{value:null},d:{value:new THREE.Vector2()}},`uniform sampler2D t;uniform vec2 d;varying vec2 vUv;void main(){vec3 c=texture2D(t,vUv).rgb*.227;c+=(texture2D(t,vUv+d*1.385).rgb+texture2D(t,vUv-d*1.385).rgb)*.316;c+=(texture2D(t,vUv+d*3.231).rgb+texture2D(t,vUv-d*3.231).rgb)*.07;gl_FragColor=vec4(c,1.);}`);
  const comp=sm({t:{value:main.texture},b0:{value:lv[0][1].texture},b1:{value:lv[1][1].texture},b2:{value:lv[2][1].texture},uExp:{value:1},uBloom:{value:.6},uTime:{value:0},uDrunk:{value:0},uDT:{value:0}},
  `uniform sampler2D t,b0,b1,b2;uniform float uExp,uBloom,uTime,uDrunk,uDT;varying vec2 vUv;
  vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
  vec3 toSRGB(vec3 c){return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c));}
  void main(){
    vec3 c=texture2D(t,vUv).rgb;
    if(uDrunk>.002){vec2 o=vec2(sin(uDT*.71),cos(uDT*.53))*.0085*uDrunk;vec3 c2=texture2D(t,vUv+o).rgb;if(!(any(isnan(c2))||any(isinf(c2))))c=mix(c,c2,.38*uDrunk);}
    if(any(isnan(c))||any(isinf(c)))c=vec3(0.);
    vec3 bl=texture2D(b0,vUv).rgb*.5+texture2D(b1,vUv).rgb*.75+texture2D(b2,vUv).rgb;
    c=aces((c+bl*uBloom)*uExp*.92);
    float l=dot(c,vec3(.2126,.7152,.0722));
    c=clamp(mix(vec3(l),c,1.2),0.,1.);
    c*=mix(vec3(.9,.99,1.1),vec3(1.),smoothstep(0.,.35,l));
    c*=mix(vec3(1.),vec3(1.07,1.,.87),smoothstep(.4,1.,l));
    c=clamp(c,0.,1.);c=c*c*(3.-2.*c)*.35+c*.65;
    vec2 q=vUv-.5;c*=1.-.45*pow(dot(q,q)*1.9,1.3);
    c=toSRGB(clamp(c,0.,1.));
    c+=(fract(sin(dot(vUv*913.+uTime,vec2(12.9898,78.233)))*43758.5453)-.5)*.006;
    gl_FragColor=vec4(c,1.);
  }`);
  function pass(m,target){quad.material=m;renderer.setRenderTarget(target);renderer.render(fsScene,fsCam);}
  return{
    exposure(v){comp.uniforms.uExp.value=v;},
    drunk(v,t){comp.uniforms.uDrunk.value=v;comp.uniforms.uDT.value=t;},
    setSize(){const pr=renderer.getPixelRatio(),w=Math.max(1,Math.floor(innerWidth*pr)),h=Math.max(1,Math.floor(innerHeight*pr));main.setSize(w,h);let f=2;for(const[a,b]of lv){a.setSize(Math.max(1,w/f|0),Math.max(1,h/f|0));b.setSize(Math.max(1,w/f|0),Math.max(1,h/f|0));f*=2;}},
    info:{tris:0,calls:0},
    render(){renderer.setRenderTarget(main);renderer.render(scene,camera);this.info.tris=renderer.info.render.triangles;this.info.calls=renderer.info.render.calls;
      bright.uniforms.t.value=main.texture;pass(bright,lv[0][1]);let src=lv[0][1];
      for(const[a,b]of lv){blur.uniforms.t.value=src.texture;blur.uniforms.d.value.set(1/a.width,0);pass(blur,a);blur.uniforms.t.value=a.texture;blur.uniforms.d.value.set(0,1/a.height);pass(blur,b);src=b;}
      comp.uniforms.uTime.value=(performance.now()*.001)%10;pass(comp,null);}
  };
})();
post.setSize();

const SUN_DIR=new V3(-0.5,0.25,0.83).normalize();
const sky=new THREE.Mesh(new THREE.SphereGeometry(1000,32,16),new THREE.ShaderMaterial({
  side:THREE.BackSide,depthWrite:false,fog:false,
  uniforms:{uSun:{value:SUN_DIR},uFog:{value:FOG_OUT}},
  vertexShader:`varying vec3 vDir;void main(){vDir=normalize(position);vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}`,
  fragmentShader:`varying vec3 vDir;uniform vec3 uSun;uniform vec3 uFog;
  void main(){vec3 d=normalize(vDir);float h=d.y;
    vec3 zen=vec3(.05,.12,.36), mid=vec3(.30,.42,.68);
    vec3 c=mix(uFog*1.15,mid,smoothstep(0.,.25,h)); c=mix(c,zen,smoothstep(.25,.9,h));
    float s=max(dot(normalize(vec3(d.x,0.,d.z)),normalize(vec3(uSun.x,0.,uSun.z))),0.);
    float glow=pow(s,5.)*(1.-smoothstep(-.02,.32,h));
    float sd=max(dot(d,normalize(uSun)),0.);
    c+=vec3(1.0,.5,.2)*glow*1.4 + vec3(1.,.6,.3)*pow(sd,60.)*.9 + vec3(7.,4.4,2.2)*smoothstep(.9993,.9997,sd);
    c=mix(c,uFog,smoothstep(.02,-.08,h));
    gl_FragColor=vec4(c,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`
}));
sky.renderOrder=-10;
scene.add(sky);

const hemi=new THREE.HemisphereLight(0xa9bde6,0x6b4a32,1.55);
scene.add(hemi);
const sun=new THREE.DirectionalLight(0xffb27a,4.3);
sun.castShadow=true;
sun.shadow.mapSize.set(isTouch?1024:2048,isTouch?1024:2048);
Object.assign(sun.shadow.camera,{left:-85,right:85,top:85,bottom:-85,near:1,far:420});
sun.shadow.bias=-0.0004; sun.shadow.normalBias=0.04;
scene.add(sun,sun.target);

/* ---------------- helpers ---------------- */
function mkCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function tex(c,repeat){const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=MAXANI;if(repeat){t.wrapS=t.wrapT=THREE.RepeatWrapping;}return t;}
function speckle(g,w,h,n,amt){for(let i=0;i<n;i++){const v=(rnd()-.5)*amt;g.fillStyle=v>0?`rgba(255,255,255,${v})`:`rgba(0,0,0,${-v})`;const s=rnd()*2.4+.6;g.fillRect(rnd()*w,rnd()*h,s,s);}}
function hexRGB(h){const n=parseInt(h.slice(1),16);return[(n>>16)&255,(n>>8)&255,n&255];}
function shade(h,f){const c=hexRGB(h).map(v=>clamp(Math.round(f>0?v+(255-v)*f:v*(1+f)),0,255));return`rgb(${c[0]},${c[1]},${c[2]})`;}
function lum(h){const c=hexRGB(h);return(.299*c[0]+.587*c[1]+.114*c[2])/255;}
function box(w,h,d,x=0,y=0,z=0){return new THREE.BoxGeometry(w,h,d).translate(x,y,z);}
function cyl(rt,rb,h,seg,x=0,y=0,z=0,open=false){return new THREE.CylinderGeometry(rt,rb,h,seg,1,open).translate(x,y,z);}
function sph(r,x,y,z,det=1){return new THREE.IcosahedronGeometry(r,det).translate(x,y,z);}
function merge(list){
  let nv=0,ni=0;const items=list.map(o=>{const g=o.g,c=g.attributes.position.count;const idx=g.index?g.index.array:Uint32Array.from({length:c},(_,i)=>i);nv+=c;ni+=idx.length;return[g,o,idx];});
  const pos=new Float32Array(nv*3),nor=new Float32Array(nv*3),ind=nv>65535?new Uint32Array(ni):new Uint16Array(ni);
  const hasCol=list.some(o=>o.c),hasPart=list.some(o=>o.part!==undefined);
  const col=hasCol?new Float32Array(nv*3):null,pl=hasPart?new Float32Array(nv*2):null;
  let off=0,io=0;const cc=new THREE.Color();
  for(const[g,o,idx]of items){const c=g.attributes.position.count;pos.set(g.attributes.position.array,off*3);nor.set(g.attributes.normal.array,off*3);
    for(let i=0;i<idx.length;i++)ind[io+i]=idx[i]+off;io+=idx.length;
    if(col){cc.set(o.c||'#ffffff');for(let i=0;i<c;i++){col[(off+i)*3]=cc.r;col[(off+i)*3+1]=cc.g;col[(off+i)*3+2]=cc.b;}}
    if(pl){for(let i=0;i<c;i++){pl[(off+i)*2]=o.part||0;pl[(off+i)*2+1]=o.limb||0;}}
    off+=c;}
  const out=new THREE.BufferGeometry();
  out.setAttribute('position',new THREE.BufferAttribute(pos,3));out.setAttribute('normal',new THREE.BufferAttribute(nor,3));out.setIndex(new THREE.BufferAttribute(ind,1));
  if(col)out.setAttribute('color',new THREE.BufferAttribute(col,3));
  if(pl)out.setAttribute('aPL',new THREE.BufferAttribute(pl,2));
  out.computeBoundingSphere();return out;
}
function quad(a,b,c,d,ur=1,vr=1){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([...a,...b,...c,...d],3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,ur,0,ur,vr,0,vr],2));g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();return g;}
function tri(a,b,c){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([...a,...b,...c],3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,.5,1],2));g.setIndex([0,1,2]);g.computeVertexNormals();return g;}
function mesh(parent,geo,mat,cast=true,recv=true){const m=new THREE.Mesh(geo,mat);m.castShadow=cast;m.receiveShadow=recv;parent.add(m);return m;}
const _q=new THREE.Quaternion(),_s=new V3(),_p=new V3();
function M4(x,y,z,ry=0,s=1){return new THREE.Matrix4().compose(_p.set(x,y,z),_q.setFromAxisAngle(UP,ry),_s.set(s,s,s));}
function inst(geo,mat,mats,cast=true,recv=true){const m=new THREE.InstancedMesh(geo,mat,Math.max(1,mats.length));mats.forEach((M,i)=>m.setMatrixAt(i,M));m.count=mats.length;m.castShadow=cast;m.receiveShadow=recv;m.computeBoundingSphere();return m;}
function beam(p1,p2,r,mat,parent,seg=6){const d=new V3().subVectors(p2,p1);const L=d.length();const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,L,seg),mat);m.position.copy(p1).addScaledVector(d,.5);m.quaternion.setFromUnitVectors(UP,d.normalize());m.castShadow=true;parent.add(m);return m;}
function catenary(a,b,sag,step){const pts=[];const L=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);const n=Math.max(2,Math.round(L/step));for(let i=0;i<=n;i++){const t=i/n;pts.push([lerp(a[0],b[0],t),lerp(a[1],b[1],t)-sag*4*t*(1-t),lerp(a[2],b[2],t)]);}return pts;}
function qb(p0,p1,p2,n){const o=[];for(let i=1;i<=n;i++){const t=i/n,u=1-t;o.push([u*u*p0[0]+2*u*t*p1[0]+t*t*p2[0],u*u*p0[1]+2*u*t*p1[1]+t*t*p2[1]]);}return o;}
function resample(poly,step){const o=[poly[0]];let acc=0;for(let i=1;i<poly.length;i++){const a=poly[i-1],b=poly[i];const d=Math.hypot(b[0]-a[0],b[1]-a[1]);let t=step-acc;while(t<=d){o.push([lerp(a[0],b[0],t/d),lerp(a[1],b[1],t/d)]);t+=step;}acc=(acc+d)%step;}return o;}

/* collision rectangles (world, axis aligned) */
const rects=[];let crowdRects=[],TALL=false;
function rectW(x0,x1,z0,z1,list=rects){list.push({x0:Math.min(x0,x1),x1:Math.max(x0,x1),z0:Math.min(z0,z1),z1:Math.max(z0,z1),tall:TALL});}
function hitTall(x,z){for(const b of rects)if(b.tall&&x>b.x0-.2&&x<b.x1+.2&&z>b.z0-.2&&z<b.z1+.2)return true;return false;}
function rectL(obj,x0,x1,z0,z1,list=rects){const a=obj.localToWorld(new V3(x0,0,z0)),b=obj.localToWorld(new V3(x1,0,z1));rectW(a.x,b.x,a.z,b.z,list);}

/* glow points (string lights, bulbs) */
const glowTex=tex((()=>{const c=mkCanvas(64,64),g=c.getContext('2d');const gr=g.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.18,'rgba(255,238,205,.85)');gr.addColorStop(.45,'rgba(255,186,105,.22)');gr.addColorStop(1,'rgba(255,150,70,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);return c;})());
function glow(arr,halo=1.05,core=.2,color=0xffc27a,colors=null){
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));
  if(colors)geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  const g=new THREE.Group();
  const h=new THREE.Points(geo,new THREE.PointsMaterial({map:glowTex,color,size:halo,transparent:true,opacity:.5,depthWrite:false,blending:THREE.AdditiveBlending,vertexColors:!!colors}));
  const c=new THREE.Points(geo,new THREE.PointsMaterial({map:glowTex,color:colors?0xffffff:0xfff2d8,size:core,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,vertexColors:!!colors}));
  h.renderOrder=c.renderOrder=5;g.add(h,c);g.userData.geo=geo;return g;
}
const outGlow=[],inGlowLocal=[];

/* wait for fonts so canvas lettering uses them */
try{await Promise.race([Promise.all([document.fonts.load('64px "UnifrakturMaguntia"'),document.fonts.load('800 64px "Grenze Gotisch"'),document.fonts.load('600 32px "Grenze"')]),new Promise(r=>setTimeout(r,3000))]);}catch(e){}
const DISPLAY='"UnifrakturMaguntia","Grenze Gotisch",Georgia,serif', GOT='"Grenze Gotisch",Georgia,serif', BODY='"Grenze",Georgia,serif';

/* ---------------- shared textures ---------------- */
function rauten(g,x,y,w,h,dw){g.save();g.beginPath();g.rect(x,y,w,h);g.clip();g.fillStyle='#f3f5f7';g.fillRect(x,y,w,h);g.fillStyle='#2f78c0';const dh=dw*1.3;
  for(let j=-2;j<h/(dh/2)+3;j+=2){for(let i=-1;i<w/dw+2;i++){const cx=x+i*dw,cy=y+j*dh/2;g.beginPath();g.moveTo(cx,cy-dh/2);g.lineTo(cx+dw/2,cy);g.lineTo(cx,cy+dh/2);g.lineTo(cx-dw/2,cy);g.closePath();g.fill();}}g.restore();}
const rautenTex=tex((()=>{const c=mkCanvas(256,160);rauten(c.getContext('2d'),0,0,256,160,32);return c;})());

const asphalt=tex((()=>{const c=mkCanvas(512,512),g=c.getContext('2d');g.fillStyle='#5b5752';g.fillRect(0,0,512,512);speckle(g,512,512,9000,.22);
  g.globalAlpha=.12;for(let i=0;i<14;i++){g.fillStyle=rnd()<.5?'#2c2a28':'#8a847b';g.beginPath();g.ellipse(rnd()*512,rnd()*512,R(20,90),R(10,40),rnd()*3,0,7);g.fill();}g.globalAlpha=1;return c;})(),true);
asphalt.repeat.set(110,110);
const gravel=tex((()=>{const c=mkCanvas(256,256),g=c.getContext('2d');g.fillStyle='#8f8473';g.fillRect(0,0,256,256);speckle(g,256,256,7000,.35);return c;})(),true);

/* ground */
mesh(scene,new THREE.PlaneGeometry(1600,1600).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({map:asphalt,roughness:.95}),false,true);

/* ---------------- tents ---------------- */
const TENTS=[
  {name:'Festhalle Sonnenwirt',short:'Sonnenwirt',side:'L',z:-20,color:'#b5862f',trim:'#f4ead6',roof:'#2b5a8e',since:'Wiesnwirt seit 1898',enter:true},
  {name:'Alpenrose',short:'Alpenrose',side:'L',z:-125,color:'#7c2431',trim:'#efe2c8',roof:'#7c2431',since:'Festzelt seit 1907'},
  {name:'Hopfengarten',short:'Hopfengarten',side:'L',z:85,color:'#3c6a46',trim:'#efe8d3',roof:'#3c6a46',since:'Festhalle seit 1911'},
  {name:'Kreuzbräu',short:'Kreuzbräu',side:'R',z:-75,color:'#2a4f86',trim:'#f1ece0',roof:'#2a4f86',since:'Bierzelt seit 1894'},
  {name:'Edelweiß',short:'Edelweiß',side:'R',z:30,color:'#e2d9c4',trim:'#6b3a1f',roof:'#9a3b2a',since:'Festzelt seit 1926'},
  {name:'Zum Goldenen Hirsch',short:'Goldener Hirsch',side:'R',z:135,color:'#583a6c',trim:'#f0e6d0',roof:'#583a6c',since:'Festhalle seit 1903'}
];

function facadeTex(t){
  const FW=50,cw=1280,ch=512,s=cw/FW;const X=x=>(x+FW/2)*s,Y=y=>ch-y*s;
  const cm=mkCanvas(cw,ch),ce=mkCanvas(cw,ch),g=cm.getContext('2d'),e=ce.getContext('2d');
  e.fillStyle='#000';e.fillRect(0,0,cw,ch);
  const ped=[[-13,12],...qb([-13,12],[-11.5,15.6],[-6.5,16.3],12),[-4.2,18.4],...qb([-4.2,18.4],[0,20.4],[4.2,18.4],16),[6.5,16.3],...qb([6.5,16.3],[11.5,15.6],[13,12],12)];
  const sil=c=>{c.beginPath();c.moveTo(X(-25),Y(0));c.lineTo(X(-25),Y(12.6));for(const p of ped)c.lineTo(X(p[0]),Y(p[1]+.6));c.lineTo(X(25),Y(12.6));c.lineTo(X(25),Y(0));c.closePath();};
  g.fillStyle=t.color;sil(g);g.fill();
  g.save();sil(g);g.clip();
  const gr=g.createLinearGradient(0,0,0,ch);gr.addColorStop(0,'rgba(255,255,255,.12)');gr.addColorStop(1,'rgba(0,0,0,.2)');g.fillStyle=gr;g.fillRect(0,0,cw,ch);
  speckle(g,cw,ch,6000,.06);
  g.fillStyle='rgba(28,16,8,.5)';g.fillRect(0,Y(1.8),cw,1.8*s);
  g.fillStyle=t.trim;for(const px of[-24.6,-16.5,-8.6,8.6,16.5,24.6])g.fillRect(X(px-.3),Y(12),.6*s,10.2*s);
  g.fillRect(0,Y(12.6),cw,.6*s);
  rauten(g,0,Y(11.85),cw,.8*s,.8*s);
  g.restore();
  g.lineWidth=.32*s;g.strokeStyle=t.trim;sil(g);g.stroke();
  // crest
  const cx=X(0),cy=Y(15.9);g.fillStyle=t.trim;g.beginPath();g.arc(cx,cy,1.95*s,0,7);g.fill();
  g.save();g.beginPath();g.arc(cx,cy,1.6*s,0,7);g.clip();rauten(g,cx-1.6*s,cy-1.6*s,3.2*s,3.2*s,.75*s);g.restore();
  // windows
  const arch=(c,x0,x1,y0,y1)=>{const r=(x1-x0)/2;c.beginPath();c.moveTo(X(x0),Y(y0));c.lineTo(X(x0),Y(y1));c.arc(X((x0+x1)/2),Y(y1),r*s,Math.PI,0,false);c.lineTo(X(x1),Y(y0));c.closePath();};
  for(const wx of[-20.6,-12.6,12.6,20.6]){const x0=wx-1.6,x1=wx+1.6;
    g.fillStyle='#2a2838';arch(g,x0,x1,3.2,8.2);g.fill();
    const eg=e.createLinearGradient(0,Y(9.8),0,Y(3.2));eg.addColorStop(0,'#ffcf8c');eg.addColorStop(1,'#ff8f3a');e.fillStyle=eg;arch(e,x0,x1,3.2,8.2);e.fill();
    for(const c of[g,e]){c.strokeStyle=c===g?t.trim:'#000';c.lineWidth=(c===g?.22:.12)*s;arch(c,x0,x1,3.2,8.2);c.stroke();c.beginPath();c.moveTo(X(wx),Y(3.2));c.lineTo(X(wx),Y(9.8));for(const hy of[4.9,6.6,8.2]){c.moveTo(X(x0),Y(hy));c.lineTo(X(x1),Y(hy));}c.lineWidth=.1*s;c.stroke();}}
  // door
  const door=c=>{c.beginPath();c.moveTo(X(-3.5),Y(0));c.lineTo(X(-3.5),Y(3.6));c.arc(X(0),Y(3.6),3.5*s,Math.PI,0,false);c.lineTo(X(3.5),Y(0));c.closePath();};
  if(t.enter){g.save();g.globalCompositeOperation='destination-out';door(g);g.fill();g.restore();}
  else{g.fillStyle='#24160d';door(g);g.fill();const dg=e.createLinearGradient(0,Y(7),0,Y(0));dg.addColorStop(0,'#ffb35e');dg.addColorStop(1,'#d06a22');e.fillStyle=dg;door(e);e.fill();
    e.fillStyle='rgba(20,10,4,.85)';for(let i=0;i<9;i++){const px=R(-3,3),ph=R(1.4,1.85);e.beginPath();e.ellipse(X(px),Y(ph*.55),.24*s,ph*.5*s,0,0,7);e.fill();e.beginPath();e.arc(X(px),Y(ph+.12),.13*s,0,7);e.fill();}}
  g.lineWidth=.35*s;g.strokeStyle=t.trim;door(g);g.stroke();
  // sign board
  const dark=lum(t.trim)>.55?'#24170e':'#f6eedd';
  g.fillStyle=t.trim;g.fillRect(X(-7.4),Y(10.7),14.8*s,3.3*s);g.strokeStyle=shade(t.color,-.35);g.lineWidth=.18*s;g.strokeRect(X(-7.2),Y(10.5),14.4*s,2.9*s);
  e.fillStyle='rgba(255,236,200,.32)';e.fillRect(X(-7.4),Y(10.7),14.8*s,3.3*s);
  for(const c of[g,e]){c.fillStyle=c===g?dark:(dark==='#24170e'?'#000':'rgba(255,240,210,.9)');let fs=2.15*s;c.font=`400 ${fs}px ${DISPLAY}`;const w=c.measureText(t.name).width;if(w>13.4*s){fs*=13.4*s/w;c.font=`400 ${fs}px ${DISPLAY}`;}
    c.textAlign='center';c.textBaseline='alphabetic';c.fillText(t.name,X(0),Y(8.85));c.font=`600 ${.72*s}px ${GOT}`;c.fillText(t.since,X(0),Y(7.75));}
  // bulbs
  const bulbs=[];
  for(let x=-24.6;x<=-13.2;x+=.9)bulbs.push([x,12.95]);for(let x=13.2;x<=24.6;x+=.9)bulbs.push([x,12.95]);
  for(const p of resample(ped.map(p=>[p[0],p[1]+.95]),.9))bulbs.push(p);
  for(let x=-7.1;x<=7.1;x+=.71){bulbs.push([x,10.95]);bulbs.push([x,7.15]);}
  for(let y=7.15;y<=10.95;y+=.76){bulbs.push([-7.65,y]);bulbs.push([7.65,y]);}
  for(const[bx,by]of bulbs){g.fillStyle='#fff1d2';g.beginPath();g.arc(X(bx),Y(by),.1*s,0,7);g.fill();const rg=e.createRadialGradient(X(bx),Y(by),0,X(bx),Y(by),.32*s);rg.addColorStop(0,'#fff0cf');rg.addColorStop(1,'rgba(255,170,80,0)');e.fillStyle=rg;e.fillRect(X(bx)-.32*s,Y(by)-.32*s,.64*s,.64*s);}
  return{map:tex(cm),em:tex(ce),bulbs};
}
function towerTex(t){const s=30,c=mkCanvas(135,510),e=mkCanvas(135,510),g=c.getContext('2d'),f=e.getContext('2d');const Y=y=>510-y*s;
  g.fillStyle=t.color;g.fillRect(0,0,135,510);speckle(g,135,510,900,.07);g.fillStyle='rgba(28,16,8,.5)';g.fillRect(0,Y(1.8),135,1.8*s);
  g.fillStyle=t.trim;g.fillRect(0,0,9,510);g.fillRect(126,0,9,510);g.fillRect(0,Y(12.6),135,.6*s);g.fillRect(0,Y(16.6),135,.5*s);rauten(g,0,Y(11.85),135,.8*s,.8*s);
  f.fillStyle='#000';f.fillRect(0,0,135,510);
  const w=(c2,col)=>{c2.fillStyle=col;c2.beginPath();c2.moveTo(45,Y(8));c2.lineTo(45,Y(10));c2.arc(67.5,Y(10),22.5,Math.PI,0);c2.lineTo(90,Y(8));c2.closePath();c2.fill();c2.beginPath();c2.arc(67.5,Y(14.4),15,0,7);c2.fill();};
  w(g,'#2a2838');w(f,'#ffb766');return{map:tex(c),em:tex(e)};}
function sideTex(t){const s=48,c=mkCanvas(576,384),e=mkCanvas(576,384),g=c.getContext('2d'),f=e.getContext('2d');const Y=y=>384-y*s;
  g.fillStyle='#e7dfcc';g.fillRect(0,0,576,384);speckle(g,576,384,2500,.06);
  g.fillStyle=t.color;for(const bx of[0,6,12])g.fillRect(bx*s-.6*s,0,1.2*s,384);
  g.fillStyle='#4a3020';g.fillRect(0,Y(1.4),576,1.4*s);g.strokeStyle='rgba(0,0,0,.3)';for(let x=0;x<576;x+=14){g.beginPath();g.moveTo(x,Y(1.4));g.lineTo(x,384);g.stroke();}
  g.fillStyle=shade(t.color,-.15);g.fillRect(0,0,576,.7*s);for(let x=0;x<576;x+=24){g.beginPath();g.arc(x+12,.7*s,12,0,Math.PI);g.fill();}
  f.fillStyle='#000';f.fillRect(0,0,576,384);
  for(const wx of[3,9]){const x0=(wx-1.1)*s,x1=(wx+1.1)*s;for(const[c2,col]of[[g,'#2a2838'],[f,'#ffad5a']]){c2.fillStyle=col;c2.beginPath();c2.moveTo(x0,Y(3));c2.lineTo(x0,Y(4.6));c2.arc((x0+x1)/2,Y(4.6),1.1*s,Math.PI,0);c2.lineTo(x1,Y(3));c2.closePath();c2.fill();c2.fillStyle=c2===g?'#e7dfcc':'#000';c2.fillRect((x0+x1)/2-2,Y(5.7),4,2.7*s);c2.fillRect(x0,Y(4.3),x1-x0,4);}}
  return{map:tex(c,true),em:tex(e,true)};}
function stripeTex(a,b,n=2,w=256,h=64){const c=mkCanvas(w,h),g=c.getContext('2d');for(let i=0;i<n;i++){g.fillStyle=i%2?b:a;g.fillRect(i*w/n,0,w/n,h);}speckle(g,w,h,400,.08);return tex(c,true);}

const cream=new THREE.MeshStandardMaterial({color:0xe5dcc8,roughness:.9});
const poleMat=new THREE.MeshStandardMaterial({color:0xd9d4c8,roughness:.5,metalness:.4});
const woodMat=new THREE.MeshStandardMaterial({color:0xa98559,roughness:.85});
const darkWood=new THREE.MeshStandardMaterial({color:0x4b2f1c,roughness:.8});
const flags=[];
const flagGeo=new THREE.PlaneGeometry(2.6,1.6).translate(1.3,0,0);
const flagMat=new THREE.MeshStandardMaterial({map:rautenTex,side:THREE.DoubleSide,roughness:.9});

const tableGeo=merge([{g:box(2.2,.05,.8,0,.76,0)},{g:box(.06,.72,.62,-.86,.37,0)},{g:box(.06,.72,.62,.86,.37,0)},{g:box(1.7,.05,.06,0,.2,0)},
  {g:box(2.2,.05,.26,0,.465,.62)},{g:box(2.2,.05,.26,0,.465,-.62)},{g:box(.05,.44,.2,-.9,.22,.62)},{g:box(.05,.44,.2,.9,.22,.62)},{g:box(.05,.44,.2,-.9,.22,-.62)},{g:box(.05,.44,.2,.9,.22,-.62)}]);
const tableMat=new THREE.MeshStandardMaterial({color:0xb79067,roughness:.8});
const mugGeo=merge([{g:cyl(.06,.055,.17,8,0,.085,0),c:'#e09a1d'},{g:cyl(.062,.062,.035,8,0,.18,0),c:'#f3ece0'},{g:box(.02,.1,.04,.075,.09,0),c:'#e8d9b8'}]);
const mugMat=new THREE.MeshLambertMaterial({vertexColors:true});
const fenceGeo=merge([{g:box(.1,1.05,.1,0,.52,0)},{g:box(2,.07,.05,1,.88,0)},{g:box(2,.07,.05,1,.45,0)}]);
const seatSlots={out:[],in:[]};
const standSpots={out:[],in:[]};
const gardens=[];

function buildTent(t){
  const grp=new THREE.Group();grp.position.set(t.side==='L'?-30:30,0,t.z);grp.rotation.y=t.side==='L'?Math.PI/2:-Math.PI/2;scene.add(grp);grp.updateMatrixWorld(true);
  t.grp=grp;t.rot=grp.rotation.y;
  const W=22,D=60;
  const fac=facadeTex(t);
  mesh(grp,new THREE.PlaneGeometry(50,20).translate(0,10,0),new THREE.MeshStandardMaterial({map:fac.map,emissiveMap:fac.em,emissive:0xffffff,emissiveIntensity:1.5,alphaTest:.5,roughness:.85}));
  for(const[bx,by]of fac.bulbs){const p=grp.localToWorld(new V3(bx,by,.14));outGlow.push(p.x,p.y,p.z);}
  const tw=towerTex(t),towMat=new THREE.MeshStandardMaterial({map:tw.map,emissiveMap:tw.em,emissive:0xffffff,emissiveIntensity:1.3,roughness:.85});
  const capMat=new THREE.MeshStandardMaterial({color:new THREE.Color(t.roof),roughness:.7});
  for(const sx of[-1,1]){const m=mesh(grp,new THREE.BoxGeometry(4.5,17,4.5),towMat);m.position.set(sx*22.75,8.5,.8);
    const cap=mesh(grp,new THREE.ConeGeometry(3.4,5.5,4),capMat);cap.rotation.y=Math.PI/4;cap.position.set(sx*22.75,19.75,.8);
    const pole=mesh(grp,new THREE.CylinderGeometry(.06,.08,4.4,6),poleMat,false);pole.position.set(sx*22.75,24.6,.8);
    const fl=new THREE.Mesh(flagGeo,flagMat);fl.position.set(sx*22.75,25.9,.8);fl.castShadow=true;grp.add(fl);flags.push(fl);
    const p=grp.localToWorld(new V3(sx*22.75,22.6,.8));outGlow.push(p.x,p.y,p.z);}
  const st=sideTex(t),sideMat=new THREE.MeshStandardMaterial({map:st.map,emissiveMap:st.em,emissive:0xffffff,emissiveIntensity:1.2,roughness:.9,side:THREE.DoubleSide});
  for(const sx of[-1,1])mesh(grp,quad([sx*W,0,-.4],[sx*W,0,-D],[sx*W,8,-D],[sx*W,8,-.4],(D-.4)/12,1),sideMat);
  mesh(grp,quad([-W,0,-D],[W,0,-D],[W,8,-D],[-W,8,-D],2*W/12,1),sideMat);
  const roofMat=new THREE.MeshStandardMaterial({map:stripeTex(t.roof,'#ebe5d8'),roughness:.85,side:THREE.DoubleSide});
  for(const sx of[-1,1])mesh(grp,quad([sx*(W+.6),8,-.25],[sx*(W+.6),8,-D-.3],[0,13.5,-D-.3],[0,13.5,-.25],(D+.05)/3,1),roofMat);
  mesh(grp,tri([-W,8,-D],[W,8,-D],[0,13.5,-D]),new THREE.MeshStandardMaterial({color:0xe7dfcc,roughness:.9,side:THREE.DoubleSide}));
  // collision
  TALL=true;
  if(t.enter){rectL(grp,-25,-3.5,-.9,.3);rectL(grp,3.5,25,-.9,.3);rectL(grp,-22.4,-21.4,-D-.4,.3);rectL(grp,21.4,22.4,-D-.4,.3);rectL(grp,-22.4,22.4,-D-.4,-D+.4);
    rectL(grp,-25,-20.5,-1.45,3.05);rectL(grp,20.5,25,-1.45,3.05);}
  else{rectL(grp,-22.4,22.4,-D-.4,.3);rectL(grp,-25,-20.5,-1.45,3.05);rectL(grp,20.5,25,-1.45,3.05);}
  TALL=false;
  buildGarden(t);
  if(t.enter)buildInterior(t);
}

function buildGarden(t){
  const grp=t.grp;
  mesh(grp,new THREE.PlaneGeometry(43,13.4).rotateX(-Math.PI/2).translate(0,.012,7.6),new THREE.MeshStandardMaterial({map:gravel.clone(),roughness:1}),false,true).material.map.repeat.set(10,3);
  gravel.needsUpdate=true;
  const tm=[],mm=[];
  for(let i=0;i<5;i++){const z=3.4+i*2.45;for(const sx of[-1,1])for(let j=0;j<6;j++){const x=sx*(6.5+j*2.4);tm.push(M4(x,0,z));rectL(grp,x-1.15,x+1.15,z-.92,z+.92);
    for(const sz of[-1,1])for(const ox of[-.81,-.27,.27,.81]){const p=grp.localToWorld(new V3(x+ox,0,z+sz*.62));seatSlots.out.push({x:p.x,y:0,z:p.z,ry:t.rot+(sz>0?Math.PI:0)});
      if(rnd()<.55)mm.push(M4(x+ox+R(-.08,.08),.785,z+sz*.24,rnd()*6));}}}
  grp.add(inst(tableGeo,tableMat,tm));grp.add(inst(mugGeo,mugMat,mm,false,true));
  const fm=[];
  for(let x=-21.5;x<-4.6;x+=2)fm.push(M4(x,0,14.3));for(let x=4.5;x<21.4;x+=2)fm.push(M4(x,0,14.3));
  for(let z=.8;z<14.2;z+=2){fm.push(M4(-21.6,0,z,-Math.PI/2));fm.push(M4(21.6,0,z,-Math.PI/2));}
  grp.add(inst(fenceGeo,woodMat,fm));
  rectL(grp,-21.8,-4.4,14.1,14.5);rectL(grp,4.4,21.8,14.1,14.5);rectL(grp,-21.8,-21.4,.3,14.5);rectL(grp,21.4,21.8,.3,14.5);
  // string lights fanning out from the facade to fence poles
  const poles=[];
  for(const x of[-21.5,-15,-8.5,-4.6,4.6,8.5,15,21.5]){poles.push(M4(x,0,14.3));
    const a=[x*.82,7.2,.6],b=[x,3.6,14.3];for(const p of catenary(a,b,.7,.75)){const w=grp.localToWorld(new V3(p[0],p[1],p[2]));outGlow.push(w.x,w.y,w.z);}}
  for(const seg of[[-21.5,-4.6],[4.6,21.5]])for(const p of catenary([seg[0],3.6,14.3],[seg[1],3.6,14.3],.35,.8)){const w=grp.localToWorld(new V3(p[0],p[1],p[2]));outGlow.push(w.x,w.y,w.z);}
  grp.add(inst(cyl(.05,.07,3.7,6,0,1.85,0),poleMat,poles));
  const a=grp.localToWorld(new V3(-21.6,0,0)),b=grp.localToWorld(new V3(21.6,0,14.4));
  gardens.push({t,x0:Math.min(a.x,b.x),x1:Math.max(a.x,b.x),z0:Math.min(a.z,b.z),z1:Math.max(a.z,b.z)});
}

/* ---------------- interior of Festhalle Sonnenwirt ---------------- */
let interior=null,interiorBox=null,stageW=null,doorW=null,bandI=null;const tentLights=[];
function buildInterior(t){
  const grp=t.grp;interior=new THREE.Group();grp.add(interior);
  const s=48;
  const wall=(()=>{const c=mkCanvas(480,370),e=mkCanvas(480,370),g=c.getContext('2d'),f=e.getContext('2d');const Y=y=>370-y*s;
    g.fillStyle='#efe6d2';g.fillRect(0,0,480,370);speckle(g,480,370,2000,.05);
    g.fillStyle='#5a3520';g.fillRect(0,Y(2.4),480,2.4*s);g.strokeStyle='#7a4c2d';g.lineWidth=4;for(let x=8;x<480;x+=80)g.strokeRect(x,Y(2.2),64,1.9*s);
    g.fillStyle='#3d2414';g.fillRect(0,Y(2.5),480,8);
    g.strokeStyle='#4f7a3a';g.lineWidth=12;g.beginPath();for(let x=0;x<=480;x+=120){g.moveTo(x,Y(6.9));g.quadraticCurveTo(x+60,Y(6.1),x+120,Y(6.9));}g.stroke();
    g.fillStyle='#b8303a';for(let x=0;x<=480;x+=120){g.fillRect(x-5,Y(6.95),10,34);}
    f.fillStyle='#000';f.fillRect(0,0,480,370);
    for(const[c2,col]of[[g,'#26324f'],[f,'#22305e']]){c2.fillStyle=col;c2.fillRect(70,Y(5.5),100,1.9*s);c2.fillRect(310,Y(5.5),100,1.9*s);}
    for(const c2 of[g,f]){c2.fillStyle=c2===g?'#f3e3c0':'#ffc878';c2.beginPath();c2.arc(240,Y(3.3),9,0,7);c2.fill();}
    return{map:tex(c,true),em:tex(e,true)};})();
  const wallMat=new THREE.MeshStandardMaterial({map:wall.map,emissiveMap:wall.em,emissive:0xffffff,emissiveIntensity:1,roughness:.9,side:THREE.DoubleSide});
  const skyTex=tex((()=>{const c=mkCanvas(1024,512),g=c.getContext('2d');const gr=g.createLinearGradient(0,0,0,512);gr.addColorStop(0,'#3f74b8');gr.addColorStop(1,'#a9c8e8');g.fillStyle=gr;g.fillRect(0,0,1024,512);
    for(let i=0;i<46;i++){const x=rnd()*1024,y=R(40,470),r=R(30,90);g.fillStyle='rgba(255,255,255,.55)';for(const ox of[-1024,0,1024]){g.save();g.filter='blur(10px)';g.beginPath();g.ellipse(x+ox,y,r*1.7,r*.6,0,0,7);g.ellipse(x+ox+r*.7,y-r*.25,r,r*.55,0,0,7);g.fill();g.restore();}}return c;})(),true);
  const ceilMat=new THREE.MeshStandardMaterial({map:skyTex,roughness:1,side:THREE.DoubleSide,emissive:0x1a2a44,emissiveIntensity:.6});
  const floorTex=tex((()=>{const c=mkCanvas(512,512),g=c.getContext('2d');for(let i=0;i<16;i++){g.fillStyle=shade('#8a6440',R(-.18,.12));g.fillRect(0,i*32,512,32);g.fillStyle='rgba(0,0,0,.35)';g.fillRect(0,i*32,512,2);for(let k=0;k<3;k++)g.fillRect(rnd()*512,i*32,2,32);}speckle(g,512,512,4000,.1);return c;})(),true);
  floorTex.repeat.set(11,15);
  const IW=21.7,FZ=-.7,BZ=-59.6,WH=7.7,RH=12.9;
  mesh(interior,new THREE.PlaneGeometry(2*IW,59).rotateX(-Math.PI/2).translate(0,.02,-30.1),new THREE.MeshStandardMaterial({map:floorTex,roughness:.85}),false,true);
  for(const sx of[-1,1])mesh(interior,quad([sx*IW,0,FZ],[sx*IW,0,BZ],[sx*IW,WH,BZ],[sx*IW,WH,FZ],(FZ-BZ)/10,1),wallMat,false);
  mesh(interior,quad([-IW,0,BZ],[IW,0,BZ],[IW,WH,BZ],[-IW,WH,BZ],2*IW/10,1),wallMat,false);
  mesh(interior,quad([-IW,0,FZ],[-3.5,0,FZ],[-3.5,WH,FZ],[-IW,WH,FZ],1.8,1),wallMat,false);
  mesh(interior,quad([3.5,0,FZ],[IW,0,FZ],[IW,WH,FZ],[3.5,WH,FZ],1.8,1),wallMat,false);
  mesh(interior,quad([-3.5,5.6,FZ],[3.5,5.6,FZ],[3.5,WH,FZ],[-3.5,WH,FZ],.7,(WH-5.6)/WH),cream,false);
  const gable=new THREE.MeshStandardMaterial({color:0xefe6d2,roughness:.9,side:THREE.DoubleSide});
  mesh(interior,tri([-IW,WH,FZ],[IW,WH,FZ],[0,RH,FZ]),gable,false);mesh(interior,tri([-IW,WH,BZ],[IW,WH,BZ],[0,RH,BZ]),gable,false);
  for(const sx of[-1,1])mesh(interior,quad([sx*IW,WH,FZ],[sx*IW,WH,BZ],[0,RH,BZ],[0,RH,FZ],3,1),ceilMat,false);
  // trusses + ridge
  const truss=new THREE.MeshStandardMaterial({color:0x6b4a2e,roughness:.8});
  mesh(interior,box(.45,.45,59,0,RH-.25,-30.1),truss,false);
  const ang=Math.atan2(RH-WH,IW);
  for(let z=-4.5;z>-59;z-=7.4)for(const sx of[-1,1]){const m=mesh(interior,box(Math.hypot(IW,RH-WH)+.2,.32,.26),truss,false);m.position.set(sx*IW/2,(WH+RH)/2-.35,z);m.rotation.z=-sx*ang;}
  // hop garlands + bunting
  const ceilY=x=>WH+(RH-WH)*(1-Math.abs(x)/IW);
  const gl=[],bunt=[],buntCol=[];const bc1=new THREE.Color('#2f78c0'),bc2=new THREE.Color('#f3f5f7');
  for(let z=-8.2;z>-58;z-=7.4){const pts=[];for(let i=0;i<=40;i++){const x=-IW+.4+i*(2*IW-.8)/40;pts.push(new V3(x,ceilY(x)-.75-.65*Math.abs(Math.sin(x*.36)),z));}
    gl.push({g:new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),80,.17,5,false)});
    for(let i=0;i<pts.length;i++){const p=pts[i];bunt.push(M4(p.x,p.y-.12,z+.02));buntCol.push(i%2?bc2:bc1);}}
  mesh(interior,merge(gl),new THREE.MeshStandardMaterial({color:0x4a7a35,roughness:1}),false);
  const btri=new THREE.BufferGeometry();btri.setAttribute('position',new THREE.Float32BufferAttribute([-.25,0,0,.25,0,0,0,-.45,0],3));btri.computeVertexNormals();
  const bm=inst(btri,new THREE.MeshLambertMaterial({side:THREE.DoubleSide}),bunt,false,false);buntCol.forEach((c,i)=>bm.setColorAt(i,c));interior.add(bm);
  // chandeliers
  const iron=new THREE.MeshStandardMaterial({color:0x2a2220,roughness:.6,metalness:.5});
  for(const z of[-9,-19.5,-40.5,-51]){const ring=mesh(interior,new THREE.TorusGeometry(1.45,.07,6,40).rotateX(Math.PI/2),iron,false);ring.position.set(0,7.1,z);
    mesh(interior,cyl(.03,.03,RH-7.3,4,0,(RH+7.1)/2,z),iron,false);
    for(let i=0;i<14;i++){const a=i/14*Math.PI*2;inGlowLocal.push(Math.cos(a)*1.45,7.2,z+Math.sin(a)*1.45);}}
  for(let z=FZ-5;z>BZ;z-=10)for(const sx of[-1,1])inGlowLocal.push(sx*(IW-.15),3.3,z);
  // bandstand
  const SZ=-30;
  mesh(interior,cyl(4.6,4.9,1.4,8,0,.7,SZ),darkWood);
  mesh(interior,new THREE.CylinderGeometry(4.7,4.7,.95,16,1,true,.2,Math.PI*2-.4).translate(0,1.88,SZ),new THREE.MeshStandardMaterial({color:0x7a4c2d,roughness:.8,side:THREE.DoubleSide}),false);
  // the stairs up to the band, facing the door: guarded by two Ordner
  {const NST=8,STL=3.0,STW=1.5,TOP=1.4,z0=SZ+4.45;
    for(let i=0;i<NST;i++){const h=TOP*(NST-i)/NST,d=STL/NST;mesh(interior,box(STW,h,d,0,h/2,z0+(i+.5)*d),darkWood);mesh(interior,box(STW+.02,.035,d*.92,0,h+.017,z0+(i+.5)*d),new THREE.MeshStandardMaterial({color:0x9a6a40,roughness:.7}),false);}
    for(const sx of[-1,1]){const rail=mesh(interior,box(.07,.07,Math.hypot(STL,TOP)+.2,0,0,0),darkWood,false);rail.position.set(sx*(STW/2+.03),TOP/2+.95,z0+STL/2);rail.rotation.x=Math.atan2(TOP,STL);
      for(const k of[0,1])mesh(interior,cyl(.04,.04,.95,6,sx*(STW/2+.03),(k?0:TOP)+.47,z0+(k?STL-.1:.1)),darkWood,false);}
    // a rope barrier (red) from each guard post to the stairs makes the gap obvious
    for(const sx of[-1,1]){mesh(interior,cyl(.06,.08,1.0,8,sx*2.35,.5,SZ+8.2),new THREE.MeshStandardMaterial({color:0xc9a34a,metalness:.7,roughness:.35}),false);
      const rope=mesh(interior,cyl(.025,.025,Math.hypot(1.6,.6),6,0,0,0),new THREE.MeshStandardMaterial({color:0xa01826,roughness:.6}),false);rope.position.set(sx*1.55,.86,SZ+7.9);rope.rotation.set(Math.PI/2,0,sx*0.36);rope.rotation.order='YXZ';rope.rotation.y=sx*-1.2;}
  }
  for(let i=0;i<4;i++){const a=i/4*Math.PI*2+Math.PI/4;mesh(interior,cyl(.09,.09,5.2,6,Math.cos(a)*4.2,4,SZ+Math.sin(a)*4.2),darkWood,false);}
  const can=mesh(interior,new THREE.ConeGeometry(5.8,2.4,8),new THREE.MeshStandardMaterial({map:stripeTex('#2f78c0','#f3f5f7',2,256,64),roughness:.9}),false);can.position.set(0,7.75,SZ);can.material.map.repeat.set(8,1);
  for(let i=0;i<24;i++){const a=i/24*Math.PI*2;inGlowLocal.push(Math.cos(a)*5.6,6.5,SZ+Math.sin(a)*5.6);}
  rectL(grp,-5.1,5.1,SZ-5.1,SZ+5.1);rects[rects.length-1].band=true;
  const goldMat=new THREE.MeshStandardMaterial({color:0xd9a441,metalness:.9,roughness:.3});
  const tubaM=[];
  for(let i=0;i<11;i++){const a=i/11*Math.PI*2,x=Math.cos(a)*2.9,z=SZ+Math.sin(a)*2.9;const p=grp.localToWorld(new V3(x,0,z));
    const ry=Math.atan2(x,z-SZ)+t.rot;standSpots.in.push({x:p.x,y:1.4,z:p.z,ry,musician:true});
    if(i%3===0)tubaM.push(M4(x*1.12,2.55,SZ+(z-SZ)*1.12,Math.atan2(x,z-SZ)+Math.PI/2));}
  interior.add(inst(new THREE.TorusGeometry(.3,.08,8,18),goldMat,tubaM,false));
  // galleries along both side walls
  const galleryMat=new THREE.MeshStandardMaterial({color:0x6a4128,roughness:.8});
  const tm=[],mm=[];
  for(const sx of[-1,1]){
    mesh(interior,box(5.3,.3,48,sx*19.05,3.15,-32),galleryMat);
    mesh(interior,box(.1,.95,48,sx*16.45,3.78,-32),new THREE.MeshStandardMaterial({color:0x8b5a35,roughness:.8}),false);
    mesh(interior,box(.18,.1,48,sx*16.45,4.28,-32),darkWood,false);
    for(let z=-9;z>-56;z-=6){mesh(interior,cyl(.14,.14,3,8,sx*16.8,1.5,z),darkWood);rectL(grp,sx*16.8-.2,sx*16.8+.2,z-.2,z+.2);}
    for(let z=-10.2;z>-54.5;z-=2.4){tm.push(M4(sx*19.1,3.3,z));
      for(const sz of[-1,1])for(const ox of[-.81,-.27,.27,.81]){const p=grp.localToWorld(new V3(sx*19.1+ox,0,z+sz*.62));seatSlots.in.push({x:p.x,y:3.3,z:p.z,ry:t.rot+(sz>0?Math.PI:0)});if(rnd()<.6)mm.push(M4(sx*19.1+ox,4.085,z+sz*.24,rnd()*6));}}
    for(let z=-12;z>-56;z-=8)inGlowLocal.push(sx*16.45,4.45,z);
  }
  // main floor tables
  for(let i=0;i<22;i++){const z=-5.6-i*2.35;if(Math.abs(z+18)<1.1||Math.abs(z+42)<1.1)continue;
    for(const sx of[-1,1])for(let j=0;j<6;j++){const x=sx*(2.9+j*2.4);if(Math.hypot(x,z-SZ)<7.9)continue;
      tm.push(M4(x,0,z));rectL(grp,x-1.15,x+1.15,z-.95,z+.95);
      for(const sz of[-1,1])for(const ox of[-.81,-.27,.27,.81]){const p=grp.localToWorld(new V3(x+ox,0,z+sz*.62));seatSlots.in.push({x:p.x,y:0,z:p.z,ry:t.rot+(sz>0?Math.PI:0)});if(rnd()<.6)mm.push(M4(x+ox+R(-.06,.06),.785,z+sz*.24,rnd()*6));}}}
  interior.add(inst(tableGeo,tableMat,tm));interior.add(inst(mugGeo,mugMat,mm,false,true));
  // standing spots: around bandstand, under galleries, by the door
  for(let i=0;i<30;i++){const a=rnd()*Math.PI*2,r=R(5.7,6.8),x=Math.cos(a)*r,z=SZ+Math.sin(a)*r;if(Math.abs(x)<2.8&&z>SZ)continue;const p=grp.localToWorld(new V3(x,0,z));standSpots.in.push({x:p.x,y:0,z:p.z,ry:Math.atan2(-x,SZ-z)+t.rot,cheer:rnd()<.5});}
  for(let i=0;i<46;i++){const sx=rnd()<.5?-1:1,x=sx*R(18.8,21.2),z=R(-8,-56);const p=grp.localToWorld(new V3(x,0,z));standSpots.in.push({x:p.x,y:0,z:p.z,ry:rnd()*6.28});}
  for(let i=0;i<12;i++){const x=R(-12,12)*(rnd()<.5?1:-1)*.2+R(-9,9),z=R(-2.2,-4);if(Math.abs(x)<2.6)continue;const p=grp.localToWorld(new V3(x,0,z));standSpots.in.push({x:p.x,y:0,z:p.z,ry:rnd()*6.28});}
  // interior glow + lights
  const ig=glow(inGlowLocal,.9,.16);interior.add(ig);
  for(const z of[-11,-24,-37,-50]){const L=new THREE.PointLight(0xffb36a,0,30,1.7);L.position.copy(grp.localToWorld(new V3(0,9.6,z)));scene.add(L);tentLights.push(L);}
  const a=grp.localToWorld(new V3(-IW,0,FZ)),b=grp.localToWorld(new V3(IW,0,BZ));
  interiorBox={x0:Math.min(a.x,b.x),x1:Math.max(a.x,b.x),z0:Math.min(a.z,b.z),z1:Math.max(a.z,b.z)};
  stageW=grp.localToWorld(new V3(0,2,SZ));doorW=grp.localToWorld(new V3(0,0,.5));
  grp.updateMatrixWorld(true);bandI={grp,SZ,rot:t.rot,inv:grp.matrixWorld.clone().invert()};
  t.lanesIn=[[0,-4,0,-19.4],[0,-38.5,0,-57],[-18.3,-5,-18.3,-57],[18.3,-5,18.3,-57],[-16,-18,16,-18],[-16,-42,16,-42]].map(([x0,z0,x1,z1])=>{const p=grp.localToWorld(new V3(x0,0,z0)),q=grp.localToWorld(new V3(x1,0,z1));return[p.x,p.z,q.x,q.z];});
}

/* ---------------- booths ---------------- */
const BOOTHS=[{name:'Lebkuchenherzen',color:'#a8243a',goods:'hearts'},{name:'Gebrannte Mandeln',color:'#2d5d8f',goods:'almonds'},{name:'Brezn',color:'#7a4b23',goods:'pretzel'},
  {name:'Hendl & Würstl',color:'#b8661b',goods:'chicken'},{name:'Steckerlfisch',color:'#2f6f68',goods:'fish'},{name:'Andenken',color:'#5e3b78',goods:'souvenir'}];
function heartPath(g,cx,cy,s){g.beginPath();g.moveTo(cx,cy+s*.95);g.bezierCurveTo(cx-s*1.35,cy+s*.1,cx-s*.95,cy-s*.95,cx,cy-s*.35);g.bezierCurveTo(cx+s*.95,cy-s*.95,cx+s*1.35,cy+s*.1,cx,cy+s*.95);g.closePath();}
function drawGoods(g,kind,x0,y0,w,h){
  g.save();g.beginPath();g.rect(x0,y0,w,h);g.clip();
  if(kind==='hearts'){const words=['Servus','I mog di','Prost','Schatzi','Gaudi','Bussi','Spatzl','Herzerl','Oans'];const ic=['#f2a1b6','#fff4e0','#ffd65a','#9ccbf0'];let k=0;
    for(let r=0;r<2;r++)for(let c=0;c<5;c++){const cx=x0+w*(c+.5)/5,cy=y0+h*(.3+r*.42),s=h*.17;g.strokeStyle='#d8c9a8';g.lineWidth=2;g.beginPath();g.moveTo(cx,y0);g.lineTo(cx,cy-s*.4);g.stroke();
      heartPath(g,cx,cy,s);g.fillStyle='#8b4a21';g.fill();g.setLineDash([4,3]);g.strokeStyle=ic[k%4];g.lineWidth=3;heartPath(g,cx,cy,s*.86);g.stroke();g.setLineDash([]);
      g.fillStyle='#fff4e6';g.font=`800 ${s*.42}px ${GOT}`;g.textAlign='center';g.textBaseline='middle';g.fillText(words[k%words.length],cx,cy+s*.05);k++;}}
  else if(kind==='almonds'){for(let i=0;i<9;i++){const cx=x0+w*(i+.5)/9,cy=y0+h*.62;g.fillStyle=i%2?'#c43a3a':'#f2ead8';g.beginPath();g.moveTo(cx-16,cy-22);g.lineTo(cx+16,cy-22);g.lineTo(cx,cy+26);g.closePath();g.fill();g.fillStyle='#8a4a1c';g.beginPath();g.ellipse(cx,cy-24,15,7,0,0,7);g.fill();}
    g.fillStyle='#b06a33';g.beginPath();g.arc(x0+w*.5,y0+h*.18,30,0,Math.PI);g.fill();}
  else if(kind==='pretzel'){for(let r=0;r<2;r++)for(let c=0;c<6;c++){const cx=x0+w*(c+.5)/6,cy=y0+h*(.3+r*.42),s=h*.16;g.strokeStyle='#8a4a1a';g.lineWidth=s*.38;g.lineCap='round';g.beginPath();g.arc(cx-s*.42,cy,s*.5,Math.PI*.9,Math.PI*2.25);g.stroke();g.beginPath();g.arc(cx+s*.42,cy,s*.5,Math.PI*.75,Math.PI*2.1);g.stroke();g.beginPath();g.moveTo(cx-s*.5,cy+s*.75);g.lineTo(cx+s*.3,cy-s*.1);g.moveTo(cx+s*.5,cy+s*.75);g.lineTo(cx-s*.3,cy-s*.1);g.stroke();
      g.fillStyle='#fff';for(let k=0;k<6;k++)g.fillRect(cx+R(-s,s),cy+R(-s*.5,s*.5),2,2);}}
  else if(kind==='chicken'){for(let r=0;r<3;r++){const cy=y0+h*(.22+r*.28);g.strokeStyle='#999';g.lineWidth=3;g.beginPath();g.moveTo(x0,cy);g.lineTo(x0+w,cy);g.stroke();for(let c=0;c<6;c++){g.fillStyle=['#c98522','#b46e19','#d99a3a'][c%3];g.beginPath();g.ellipse(x0+w*(c+.5)/6,cy,w/16,h*.1,0,0,7);g.fill();}}}
  else if(kind==='fish'){for(let c=0;c<8;c++){const cx=x0+w*(c+.5)/8,cy=y0+h*.5;g.save();g.translate(cx,cy);g.rotate(-1.2);g.strokeStyle='#d8c39a';g.lineWidth=3;g.beginPath();g.moveTo(-h*.4,0);g.lineTo(h*.45,0);g.stroke();g.fillStyle='#b5822f';g.beginPath();g.ellipse(0,0,h*.24,h*.07,0,0,7);g.fill();g.beginPath();g.moveTo(h*.22,0);g.lineTo(h*.32,-h*.06);g.lineTo(h*.32,h*.06);g.fill();g.restore();}}
  else{for(let c=0;c<6;c++){const cx=x0+w*(c+.5)/6,cy=y0+h*.35;g.fillStyle=['#2f4a2f','#4a3b2a','#2b3550'][c%3];g.fillRect(cx-16,cy-14,32,22);g.fillRect(cx-26,cy+6,52,6);g.fillStyle='#e9e1cf';g.fillRect(cx-14,y0+h*.62,26,32);g.fillStyle='#2f78c0';g.fillRect(cx-14,y0+h*.62,26,8);}}
  g.restore();
}
const boothMats={};
function boothMat(b){if(boothMats[b.name])return boothMats[b.name];
  const s=128,W=512,H=360,c=mkCanvas(W,H),e=mkCanvas(W,H),g=c.getContext('2d'),f=e.getContext('2d');const Y=y=>H-y*s;
  g.fillStyle='#e8dcc2';g.fillRect(0,0,W,H);speckle(g,W,H,1200,.07);g.fillStyle=b.color;g.fillRect(0,0,W,16);g.fillRect(0,0,16,H);g.fillRect(W-16,0,16,H);
  g.fillStyle='#5a3a22';g.fillRect(0,Y(.95),W,.95*s);g.fillStyle=b.color;g.fillRect(0,Y(.95),W,12);g.strokeStyle='rgba(0,0,0,.3)';for(let x=24;x<W;x+=48){g.strokeRect(x,Y(.8),36,.65*s);}
  f.fillStyle='#000';f.fillRect(0,0,W,H);
  const ox=.25*s,oy=Y(2.55),ow=3.5*s,oh=1.6*s;
  const ig=g.createLinearGradient(0,oy,0,oy+oh);ig.addColorStop(0,'#fde0ae');ig.addColorStop(1,'#d79a55');g.fillStyle=ig;g.fillRect(ox,oy,ow,oh);
  const eg=f.createLinearGradient(0,oy,0,oy+oh);eg.addColorStop(0,'#ffcf86');eg.addColorStop(1,'#b0611e');f.fillStyle=eg;f.fillRect(ox,oy,ow,oh);
  drawGoods(g,b.goods,ox,oy,ow,oh);f.globalAlpha=.8;drawGoods(f,b.goods,ox,oy,ow,oh);f.globalAlpha=1;
  const front=new THREE.MeshStandardMaterial({map:tex(c),emissiveMap:tex(e),emissive:0xffffff,emissiveIntensity:1.1,roughness:.9});
  const sc=mkCanvas(512,96),se=mkCanvas(512,96),sg=sc.getContext('2d'),sf=se.getContext('2d');
  sg.fillStyle=b.color;sg.fillRect(0,0,512,96);sg.strokeStyle='#f3e8cf';sg.lineWidth=4;sg.strokeRect(8,8,496,80);sf.fillStyle='#000';sf.fillRect(0,0,512,96);
  for(const[c2,col]of[[sg,'#f8efd9'],[sf,'#ffeccc']]){c2.fillStyle=col;let fs=56;c2.font=`800 ${fs}px ${GOT}`;const w=c2.measureText(b.name).width;if(w>440){fs*=440/w;c2.font=`800 ${fs}px ${GOT}`;}c2.textAlign='center';c2.textBaseline='middle';c2.fillText(b.name,256,52);}
  for(let x=16;x<=496;x+=24)for(const y of[4,92]){sg.fillStyle='#fff0cc';sg.beginPath();sg.arc(x,y,3.5,0,7);sg.fill();sf.fillStyle='#ffd590';sf.beginPath();sf.arc(x,y,4.5,0,7);sf.fill();}
  const sign=new THREE.MeshStandardMaterial({map:tex(sc),emissiveMap:tex(se),emissive:0xffffff,emissiveIntensity:1.2,roughness:.9});
  const awn=new THREE.MeshStandardMaterial({map:stripeTex(b.color,'#f2ead8',2,128,32),roughness:.9,side:THREE.DoubleSide});awn.map.repeat.set(5,1);
  const body=new THREE.MeshStandardMaterial({color:new THREE.Color(b.color).lerp(new THREE.Color('#e8dcc2'),.55),roughness:.9});
  return boothMats[b.name]={front,sign,awn,body};}
const boothFronts=[];
function buildBooth(x,z,face,b){
  const grp=new THREE.Group();grp.position.set(x,0,z);grp.rotation.y=face;scene.add(grp);grp.updateMatrixWorld(true);
  const m=boothMat(b);
  mesh(grp,box(4,2.8,3,0,1.4,0),[m.body,m.body,m.body,m.body,m.front,m.body]);
  mesh(grp,quad([-2.15,2.3,2.7],[2.15,2.3,2.7],[2.15,2.85,1.45],[-2.15,2.85,1.45]),m.awn);
  mesh(grp,new THREE.PlaneGeometry(4.2,.8).translate(0,3.38,1.56),m.sign,false);
  mesh(grp,box(4.3,.95,.1,0,3.38,1.48),darkWood);
  TALL=true;rectL(grp,-2.1,2.1,-1.6,1.6);TALL=false;
  for(const ox of[-1.6,0,1.6]){const p=grp.localToWorld(new V3(ox,2.25,2.6));outGlow.push(p.x,p.y,p.z);}
  boothFronts.push({x:grp.localToWorld(new V3(0,0,2.8)).x,z:grp.localToWorld(new V3(0,0,2.8)).z,ry:face+Math.PI});
}

/* ---------------- rides, lamps, skyline ---------------- */
let wheel,gondolas,wheelBulbs,carousel;
function buildWheel(){
  const fw=new THREE.Group();fw.position.set(30,0,218);fw.rotation.y=-.25;scene.add(fw);
  const metal=new THREE.MeshStandardMaterial({color:0xe9e3d6,roughness:.55,metalness:.35});
  wheel=new THREE.Group();wheel.position.y=28;fw.add(wheel);
  const parts=[];
  for(const z of[-1.5,1.5]){parts.push({g:new THREE.TorusGeometry(24,.22,6,120).translate(0,0,z)});parts.push({g:new THREE.TorusGeometry(8,.16,6,60).translate(0,0,z)});
    for(let i=0;i<32;i++){const a=i/32*Math.PI*2;parts.push({g:cyl(.07,.07,24,4,0,12,0).rotateZ(a-Math.PI/2).translate(0,0,z)});}}
  for(let i=0;i<32;i++){const a=i/32*Math.PI*2;parts.push({g:cyl(.07,.07,3,4).rotateX(Math.PI/2).translate(Math.cos(a)*24,Math.sin(a)*24,0)});}
  parts.push({g:cyl(1,1,4,12).rotateX(Math.PI/2)});
  mesh(wheel,merge(parts),metal,true,false);
  for(const sz of[-1,1])for(const sx of[-1,1])beam(new V3(sx*11,0,sz*4.5),new V3(0,28,sz*1.9),.35,metal,fw);
  const gm=new THREE.InstancedMesh(box(1.7,1.9,1.5,0,-1.5,0),new THREE.MeshStandardMaterial({roughness:.7}),32);
  const gc=['#c0392b','#f1c40f','#2e86c1','#27ae60','#f39c12','#8e44ad','#ecf0f1','#d35400'];
  for(let i=0;i<32;i++)gm.setColorAt(i,new THREE.Color(gc[i%gc.length]));gm.castShadow=true;fw.add(gm);gondolas=gm;gm.frustumCulled=false;
  const bp=[],bc=[];const pal=[[1,.85,.5],[1,.3,.25],[.4,.7,1],[1,1,1]];
  for(const z of[-1.6,1.6])for(let i=0;i<120;i++){const a=i/120*Math.PI*2;bp.push(Math.cos(a)*24.3,Math.sin(a)*24.3,z);bc.push(...pal[i%4]);}
  for(let i=0;i<32;i++){const a=i/32*Math.PI*2;for(let r=10;r<24;r+=2.2){bp.push(Math.cos(a)*r,Math.sin(a)*r,1.6);bc.push(...pal[(i+((r/2.2)|0))%4]);}}
  wheelBulbs=glow(bp,2.2,.45,0xffffff,bc);wheel.add(wheelBulbs);
  rectW(fw.position.x-13,fw.position.x+13,fw.position.z-6,fw.position.z+6);
}
function buildCarousel(){
  const g=new THREE.Group();g.position.set(-40,0,34);scene.add(g);
  mesh(g,cyl(9,9.3,.6,28,0,.3,0),darkWood);
  mesh(g,cyl(.55,.75,15,12,0,7.5,0),new THREE.MeshStandardMaterial({color:0xd9c69a,roughness:.5,metalness:.3}));
  const top=new THREE.Group();top.position.y=14.6;g.add(top);
  const st=stripeTex('#b8303a','#f3ead8',2,128,32);st.repeat.set(12,1);
  mesh(top,new THREE.ConeGeometry(5.8,2.6,28).translate(0,1.3,0),new THREE.MeshStandardMaterial({map:st,roughness:.8}));
  mesh(top,cyl(5.8,5.8,.9,28,0,-.2,0,true),new THREE.MeshStandardMaterial({color:0xe9c46a,roughness:.6,side:THREE.DoubleSide}));
  const bp=[];for(let i=0;i<48;i++){const a=i/48*Math.PI*2;bp.push(Math.cos(a)*5.85,-.2,Math.sin(a)*5.85);bp.push(Math.cos(a)*4,1.6,Math.sin(a)*4);}
  top.add(glow(bp,1.6,.3));
  const chains=new THREE.InstancedMesh(cyl(.025,.025,6,3),poleMat,24),seats=new THREE.InstancedMesh(box(.55,.5,.6,0,-.15,0),new THREE.MeshStandardMaterial({color:0x2f78c0,roughness:.6}),24);
  chains.frustumCulled=seats.frustumCulled=false;top.add(chains,seats);
  carousel={top,chains,seats,phase:0,omega:0};
  rectW(-49.5,-30.5,24.5,43.5);
}
function buildLamps(){
  const pm=[],gm=[];
  for(let z=-160;z<=160;z+=26){for(const sx of[-1,1]){const x=sx*13.2,zz=z+(sx>0?13:0);if(zz>165)continue;pm.push(M4(x,0,zz));for(const[ox,oz]of[[0,0],[.8,0],[-.8,0]]){gm.push(M4(x+ox,7.6+(ox?-.5:0),zz+oz));outGlow.push(x+ox,7.6+(ox?-.5:0),zz+oz);}rectW(x-.25,x+.25,zz-.25,zz+.25);}}
  scene.add(inst(merge([{g:cyl(.11,.16,8,8,0,4,0)},{g:box(1.8,.1,.1,0,7.3,0)}]),new THREE.MeshStandardMaterial({color:0x2c3a2f,roughness:.6,metalness:.4}),pm));
  scene.add(inst(new THREE.SphereGeometry(.26,12,8),new THREE.MeshBasicMaterial({color:0xffe2b0}),gm,false,false));
}
function buildSkyline(){
  const wc=mkCanvas(64,128),g=wc.getContext('2d');g.fillStyle='#000';g.fillRect(0,0,64,128);for(let y=4;y<124;y+=8)for(let x=3;x<61;x+=8)if(rnd()<.28){g.fillStyle=rnd()<.8?'#ffcf8a':'#cfe0ff';g.fillRect(x,y,4,5);}
  const wt=tex(wc);const mats=[];
  for(let i=0;i<150;i++){const a=rnd()*Math.PI*2,r=R(330,470);const m=new THREE.Matrix4().compose(new V3(Math.cos(a)*r,0,Math.sin(a)*r),new THREE.Quaternion().setFromAxisAngle(UP,-a),new V3(R(18,50),R(12,38),R(14,30)));mats.push(m);}
  scene.add(inst(box(1,1,1,0,.5,0),new THREE.MeshLambertMaterial({color:0x151a2a,emissive:0xffffff,emissiveMap:wt,emissiveIntensity:.7}),mats,false,false));
  const stone=new THREE.MeshLambertMaterial({color:0x2a2c3a});
  const ch=new THREE.Group();ch.position.set(140,0,-300);ch.rotation.y=.4;scene.add(ch);
  mesh(ch,box(22,24,56,0,12,0),stone,false,false);mesh(ch,box(11,64,11,0,32,-30),stone,false,false);mesh(ch,new THREE.ConeGeometry(7.5,34,8).translate(0,81,-30),stone,false,false);
  mesh(ch,new THREE.CircleGeometry(2.4,20).translate(0,52,-24.4),new THREE.MeshBasicMaterial({color:0xffe1a6}),false,false);
  const bv=new THREE.Group();bv.position.set(-300,0,30);bv.rotation.y=Math.PI/2;scene.add(bv);
  mesh(bv,cyl(70,110,14,24,0,7,0),new THREE.MeshLambertMaterial({color:0x1d2a24}),false,false);
  mesh(bv,box(90,13,12,0,20.5,-18),stone,false,false);
  for(let x=-42;x<=42;x+=6)mesh(bv,box(2,1,2,x,27.5,-12),stone,false,false);
  mesh(bv,box(9,10,9,0,19,4),stone,false,false);
  const fig=new THREE.MeshLambertMaterial({color:0x3a3426});
  mesh(bv,cyl(2,3.2,13,10,0,30.5,4),fig,false,false);mesh(bv,sph(1.6,0,38.6,4),fig,false,false);
  mesh(bv,cyl(.5,.6,6,6).rotateZ(-.5).translate(2.6,38.5,4),fig,false,false);
}

/* ---------------- build the static world ---------------- */
for(const t of TENTS)buildTent(t);
const SW=TENTS[0];
// booths in the gaps between tents
const gapsL=[[-170,-151],[-101,-48],[6,18],[48,61],[110,165]],gapsR=[[-170,-101],[-50,4],[56,111],[161,170]];
let bi=0;
for(const[g0,g1]of gapsL)for(let z=g0+3;z<=g1-2;z+=5.6)buildBooth(-15.6,z,Math.PI/2,BOOTHS[(bi++)%BOOTHS.length]);
for(const[g0,g1]of gapsR)for(let z=g0+3;z<=g1-2;z+=5.6)buildBooth(15.6,z,-Math.PI/2,BOOTHS[(bi++)%BOOTHS.length]);
buildWheel();buildCarousel();buildLamps();buildSkyline();
scene.add(glow(outGlow));

/* ---------------- crowd: Blender-made Trachten characters, GPU-skinned from baked bone textures ---------------- */
const crowdU={uTime:{value:0},uProsit:{value:0},uSchunkel:{value:0},uDrink:{value:0}};
const TR=await (await fetch('data/trachten.json')).json();
function b64(s,T){const bin=atob(s),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return new T(u.buffer);}
const NB=TR.bones.length;
const AN={},A_=n=>{const a=TR.anims.find(x=>x.name===n);return[a.start,a.frames];};
Object.assign(AN,{prone:A_('Prone'),pin:A_('Pin'),guard:A_('Guard'),ko:A_('KnockOut'),walk:A_('Walk'),idle:A_('Idle'),sit:A_('Sit'),sway:A_('Schunkeln'),cheer:A_('Cheer'),pstand:A_('PrositStand')[0],psit:A_('PrositSit')[0],
  walkBeer:A_('WalkBeer'),drinkStand:A_('DrinkStand')[0],drinkSit:A_('DrinkSit')[0],sip:A_('Sip'),serveWalk:A_('ServeWalk'),serveIdle:A_('ServeIdle')});
const STRIDE=['Bursch','Madl','Kellnerin'].map(n=>TR.chars[n].stride||1.1);
function trMat(boneTex,hi){
  const m=new THREE.MeshLambertMaterial({vertexColors:true});
  m.onBeforeCompile=sh=>{
    Object.assign(sh.uniforms,crowdU,{uBones:{value:boneTex}});
    sh.vertexShader=(hi?'#define LOD_HI\n':'')+`uniform float uTime;uniform float uProsit;uniform float uSchunkel;uniform float uDrink;uniform highp sampler2D uBones;
attribute vec4 aJ;attribute vec4 aW;attribute float aPart;attribute float aMh;
attribute vec4 iA;attribute vec4 iB;attribute vec4 iC;attribute vec4 iC0;attribute vec4 iC1;attribute vec4 iC2;attribute vec4 iC3;attribute vec4 iD;
varying float vPartF;varying float vCheck;varying vec3 vObj;varying float vMh;varying float vFill;
mat4 bm(int f,int b){int x=b*3;vec4 r0=texelFetch(uBones,ivec2(x,f),0),r1=texelFetch(uBones,ivec2(x+1,f),0),r2=texelFetch(uBones,ivec2(x+2,f),0);
  return mat4(r0.x,r1.x,r2.x,0.,r0.y,r1.y,r2.y,0.,r0.z,r1.z,r2.z,0.,r0.w,r1.w,r2.w,1.);}
float wrapf(float a,float n){return a-n*floor((a+.5)/n);}
mat4 sk(float f){int fi=int(f+.5);return aW.x*bm(fi,int(aJ.x+.5))+aW.y*bm(fi,int(aJ.y+.5))+aW.z*bm(fi,int(aJ.z+.5))+aW.w*bm(fi,int(aJ.w+.5));}
`+sh.vertexShader.replace('#include <beginnormal_vertex>',`
  float tt=uTime*iB.w+iB.z;float f0=floor(tt);
  mat4 S=sk(iB.x+wrapf(f0,iB.y));
  #ifdef LOD_HI
  S=S*(1.-(tt-f0))+sk(iB.x+wrapf(f0+1.,iB.y))*(tt-f0);
  #endif
  if(iC.w>.5&&uSchunkel>.01)S=S*(1.-uSchunkel)+sk(${AN.sway[0]}.+wrapf(floor(uTime*24.25),${AN.sway[1]}.))*uSchunkel;
  float beer=mod(iC.y,2.),hat=mod(floor(iC.y*.5),2.);
  float la=uTime-iD.x,lR=0.,lD=0.;
  if(la>0.&&la<4.3){lR=smoothstep(0.,.35,la)*(1.-smoothstep(1.05,1.4,la));lD=smoothstep(1.05,1.4,la)*(1.-smoothstep(3.5,4.2,la));}
  float wR=max(uProsit,lR),wD=max(uDrink,lD);
  if(iC.z>=0.&&beer>.5&&wR>.01)S=S*(1.-wR)+sk(iC.z+wrapf(floor(uTime*12.+iB.z),24.))*wR;
  if(iC.z>=0.&&beer>.5&&wD>.01)S=S*(1.-wD)+sk((iC.z>${(AN.pstand+AN.psit)/2}.?${AN.drinkSit}.:${AN.drinkStand}.)+wrapf(floor(uTime*20.+iB.z),24.))*wD;
  vec3 lp=(S*vec4(position,1.)).xyz;vec3 ln=mat3(S)*normal;
  if((aPart>6.5&&aPart<8.5&&beer<.5)||(((aPart>8.5&&aPart<9.5)||(aPart>16.5&&aPart<18.5))&&hat<.5))lp=vec3(0.,1.,0.);
  float cr=cos(iA.w),sr=sin(iA.w);
  vec3 crowdPos=vec3(cr*lp.x+sr*lp.z,lp.y,-sr*lp.x+cr*lp.z)*iC.x+iA.xyz;
  vec3 on=vec3(cr*ln.x+sr*ln.z,ln.y,-sr*ln.x+cr*ln.z);
  vec3 objectNormal=dot(on,on)>1e-8?normalize(on):vec3(0.,1.,0.);
  vPartF=aPart;vCheck=floor(iC.y*.25);vObj=position;vMh=aMh;vFill=iC3.w;
  #ifdef USE_TANGENT
  vec3 objectTangent=vec3(tangent.xyz);
  #endif
`).replace('#include <begin_vertex>','vec3 transformed=crowdPos;')
  .replace('#include <color_vertex>',`
  #ifdef USE_COLOR
  float cPart=aPart;vec3 cc;
  vec3 cShirt=iC0.xyz,cPants=vec3(iC0.w,iC1.xy),cSkin=vec3(iC1.zw,iC2.x),cHair=iC2.yzw,cApron=iC3.xyz;
  cc=cSkin;
  if(cPart>.5&&cPart<1.5)cc=cShirt;
  else if(cPart>1.5&&cPart<2.5)cc=cPants;
  else if(cPart>2.5&&cPart<3.5)cc=cApron;
  else if(cPart>3.5&&cPart<4.5)cc=cHair;
  else if(cPart>4.5&&cPart<5.5)cc=cApron;
  else if(cPart>5.5&&cPart<6.5)cc=cPants;
  else if(cPart>6.5&&cPart<7.5)cc=vec3(.80,.42,.04);
  else if(cPart>7.5&&cPart<8.5)cc=vec3(.80,.84,.82);
  else if(cPart>8.5&&cPart<9.5)cc=mix(vec3(.10,.14,.08),vec3(.17,.15,.12),fract(iB.z*.37));
  else if(cPart>9.5&&cPart<10.5)cc=vec3(.08,.05,.03);
  else if(cPart>10.5&&cPart<11.5)cc=vec3(.9,.88,.83);
  else if(cPart>11.5&&cPart<12.5)cc=vec3(.03,.025,.03);
  else if(cPart>12.5&&cPart<13.5)cc=mix(cApron,vec3(.75,.12,.15),.55);
  else if(cPart>13.5&&cPart<14.5)cc=cPants*1.5+vec3(.03,.025,0.);
  else if(cPart>14.5&&cPart<15.5)cc=cSkin*vec3(.8,.52,.52);
  else if(cPart>15.5&&cPart<16.5)cc=vec3(.78,.77,.72);
  else if(cPart>16.5&&cPart<17.5)cc=vec3(.34,.29,.24);
  else if(cPart>17.5)cc=vec3(.12,.24,.13);
  vColor=cc;
  #endif
`);
    sh.fragmentShader='varying float vPartF;varying float vCheck;varying vec3 vObj;varying float vMh;varying float vFill;\n'+sh.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
  if(vPartF>.5&&vPartF<1.5&&vCheck>.5){float ga=step(.5,fract((vObj.x+vObj.z)*24.)),gb=step(.5,fract(vObj.y*24.));diffuseColor.rgb=mix(vec3(.92,.9,.86),diffuseColor.rgb,(ga+gb)*.5);}
  if(vPartF>4.5&&vPartF<5.5){diffuseColor.rgb*=.93+.07*sin(vObj.y*90.+atan(vObj.x,vObj.z)*8.);}
  if(vPartF>6.5&&vPartF<7.5){float lv=.07+.86*vFill;vec3 glass=vec3(.74,.79,.77);
    diffuseColor.rgb=vMh<.055?glass*.85:vMh<lv?vec3(.80,.42,.04)*(.82+.25*vMh):vMh<lv+.075*step(.02,vFill)?vec3(.96,.93,.86):glass;}`);
  };
  m.customProgramCacheKey=()=>'trachten3-'+boneTex.uuid+(hi?'-hi':'-lo');
  return m;
}

const BT={};
const CHARS=['Bursch','Madl','Kellnerin'].map(name=>{
  const ch=TR.chars[name],src=ch.matsFrom||name;
  if(!BT[src]){const c2=TR.chars[src];const bt=new THREE.DataTexture(b64(c2.mats,Float32Array),NB*3,c2.frames,THREE.RGBAFormat,THREE.FloatType);
    bt.minFilter=bt.magFilter=THREE.NearestFilter;bt.needsUpdate=true;BT[src]=bt;}
  const bt=BT[src];
  const geos=['hi','mid','lo'].map(k=>{const L=ch[k],g=new THREE.InstancedBufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(b64(L.pos,Float32Array),3));g.setAttribute('normal',new THREE.BufferAttribute(b64(L.nor,Float32Array),3));
    g.setAttribute('aJ',new THREE.BufferAttribute(b64(L.ji,Uint8Array),4));g.setAttribute('aW',new THREE.BufferAttribute(b64(L.jw,Uint8Array),4,true));
    g.setAttribute('aPart',new THREE.BufferAttribute(b64(L.part,Uint8Array),1));g.setAttribute('aMh',new THREE.BufferAttribute(b64(L.mh,Uint8Array),1,true));
    g.setIndex(new THREE.BufferAttribute(b64(L.idx,Uint16Array),1));return g;});
  return{name,bt,geos,mats:[trMat(bt,true),trMat(bt,false),trMat(bt,false)]};
});
const blobTex=tex((()=>{const c=mkCanvas(64,64),g=c.getContext('2d');const gr=g.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,'rgba(0,0,0,.55)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);return c;})());
const blobGeo=new THREE.PlaneGeometry(.95,.95).rotateX(-Math.PI/2);
const blobMat=new THREE.MeshBasicMaterial({map:blobTex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
const C=(h)=>new THREE.Color(h);
const DIRNDL=['#7d1f2c','#2e5a3a','#1f2e57','#57152e','#1e5c61','#a9822a','#b9647b','#1b1b22','#6b2a63','#3c6c8c'].map(C);
const APRON=['#eadbc8','#c9d8e8','#f1cad1','#d9e5c8','#f4f0ea','#a8c3df','#e9d27a','#cfc2e6','#2b2b33'].map(C);
const CHECK=['#a63a3f','#3a5e9a','#8db0d8','#4c7a4a','#c78aa0','#6f8fbf','#b85c3b','#2f4f8a','#7a9a5a'].map(C);
const SOCKS=['#d9cfb8','#cfc6b0','#8a7f6a','#e4dccb','#6f6a5c'].map(C);
const LEDER=['#5a3b22','#3f2a19','#6c4a2b','#4a3524'].map(C);
const CASUAL=['#2b2f3a','#e2ddd2','#7a2b2b','#2f4d6e','#5f6b3a','#c9a03c','#8a8f99','#3d3d44','#b4492f'].map(C);
const JEANS=['#34445f','#2a3448','#4b5d7e','#25262b','#59544b'].map(C);
const SKIN=['#f2cfb1','#e6b48f','#d29a74','#b07650','#8a5a3c','#664029','#f6dcc6','#e9c09c'].map(C);
const HAIR=['#2a1d14','#55361f','#86643a','#c8a15c','#151515','#8e8e8e','#a34f24','#3b2a1e'].map(C);
const SOCK=C('#d9cfb8'),WHITE=C('#f2efe8');
function palette(f,kind){
  const skin=pick(SKIN),hair=pick(HAIR);
  if(kind==='music')return{shirt:WHITE,pants:pick(LEDER),apron:SOCK,skin,hair};
  if(f){if(kind==='serve'||rnd()<.88)return{shirt:WHITE,pants:pick(DIRNDL),apron:pick(APRON),skin,hair};const j=pick(JEANS);return{shirt:pick(CASUAL),pants:j,apron:pick(APRON),skin,hair};}
  if(rnd()<.88)return{shirt:pick(CHECK),pants:pick(LEDER),apron:pick(SOCKS),skin,hair,tracht:true};
  return{shirt:pick(CASUAL),pants:pick(LEDER),apron:pick(SOCKS),skin,hair};
}
function writeMat(a,i,x,y,z,ry,s){const c=Math.cos(ry)*s,n=Math.sin(ry)*s,o=i*16;a[o]=c;a[o+1]=0;a[o+2]=-n;a[o+3]=0;a[o+4]=0;a[o+5]=s;a[o+6]=0;a[o+7]=0;a[o+8]=n;a[o+9]=0;a[o+10]=c;a[o+11]=0;a[o+12]=x;a[o+13]=y;a[o+14]=z;a[o+15]=1;}
/* g: 0 outside static, 1 inside static, 2 walker, 4 player */
function agent(g,x,y,z,ry,kind,opt={}){
  const f=opt.f!==undefined?opt.f:rnd()<.5,p=palette(f,opt.kind);
  const beer=opt.beer!==undefined?opt.beer:(rnd()<.75?1:0);
  const hat=!f&&(opt.kind==='music'||(p.tracht&&rnd()<.55))?1:0;
  const kel=!!opt.kellnerin,A=kel?AN.serveWalk:kind==='walk'&&beer?AN.walkBeer:AN[kind],pk=kel?-1:kind==='sit'?AN.psit:(kind==='idle'||kind==='cheer')?AN.pstand:-1;
  const rec=new Float32Array(32);rec[28]=-99;
  rec.set([x,y,z,ry,A[0],A[1],rnd()*A[1],opt.rate||24*R(.85,1.15),opt.sc||(f?R(.95,1.03):R(.94,1.05)),beer+2*hat+4*(p.tracht?1:0),pk,kind==='sit'&&g===1?1:0]);
  rec.set([p.shirt.r,p.shirt.g,p.shirt.b,p.pants.r,p.pants.g,p.pants.b,p.skin.r,p.skin.g,p.skin.b,p.hair.r,p.hair.g,p.hair.b,p.apron.r,p.apron.g,p.apron.b,kel?1:R(.3,1)],12);
  return{c:kel?2:f?1:0,g,rec,kel};
}
let crowd={agents:[],walkers:[],kellner:[],slots:[],blobDyn:null,blobStatic:null,total:0,drawn:0,showIn:true,showOut:true},player=null;
/* the drinking game: score, what is left in your Maß, how many sips you have had */
const guards=[];
const G={strikeT:[],esc:null,take:null,stageEsc:0,partners:0,tired:0,strikes:0,stun:0,stageT:-999,escort:0,seen:0,score:0,fill:1,hasBeer:true,sips:0,drunk:0,sipT:-9,sipDone:true,emptyAt:0,refillAt:-9,cheerUntil:-9,st:{t:-9,side:1,amp:0,fwd:0},roll:0,ko:0,koShown:false,warned:0};
function disposeCrowd(){
  for(const S of crowd.slots){scene.remove(S.mesh);S.geo.dispose();}
  for(const m of[crowd.blobDyn,crowd.blobStatic])if(m){scene.remove(m);m.geometry.dispose();}
}
function buildCrowd(qname){
  disposeCrowd();const q=Q[qname];seed=4242;
  const ag=[],walkers=[],blobS=[];
  for(const s of seatSlots.out)if(rnd()<q.fillOut){ag.push(rnd()<.025?agent(0,s.x,s.y+.465,s.z,s.ry,'cheer'):agent(0,s.x,s.y,s.z,s.ry,'sit'));}
  for(const s of seatSlots.in)if(rnd()<q.fillIn){ag.push(rnd()<.035?agent(1,s.x,s.y+.465,s.z,s.ry,'cheer'):agent(1,s.x,s.y,s.z,s.ry,'sit'));}
  for(const s of standSpots.in){if(s.musician){ag.push(agent(1,s.x,s.y,s.z,s.ry,'idle',{f:false,kind:'music',beer:0,rate:30}));continue;}
    if(rnd()<q.fillIn){const a=agent(1,s.x,s.y,s.z,s.ry,s.cheer?'cheer':'idle');ag.push(a);blobS.push(a);}}
  const nGroups=Math.round(q.stand/3.4);
  for(let k=0;k<nGroups;k++){const sx=rnd()<.5?-1:1,cx=sx*R(9.4,12.6),cz=R(-166,166);const n=2+((rnd()*4)|0);
    for(let i=0;i<n;i++){const a=i/n*Math.PI*2+rnd(),r=R(.5,.75);const x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r;const A=agent(0,x,0,z,Math.atan2(cx-x,cz-z),'idle');ag.push(A);blobS.push(A);}}
  for(const b of boothFronts){const n=(rnd()*3.2)|0;for(let i=0;i<n;i++){const A=agent(0,b.x+R(-1.4,1.4)*Math.abs(Math.cos(b.ry))+Math.sin(b.ry)*-R(.2,1.6),0,b.z+R(-1.4,1.4)*Math.abs(Math.sin(b.ry))+Math.cos(b.ry)*-R(.2,1.6),b.ry,'idle');ag.push(A);blobS.push(A);}}
  const mkWalker=(x,z0,dx,dz,len,inside,opt)=>{const v=(inside?R(1.1,1.6):R(1.0,1.55))*(rnd()<.5?1:-1);
    const A=agent(2,x,0,z0,0,'walk',opt);A.rec[7]=24*Math.abs(v)/STRIDE[A.c];A.w={ax:x,az:z0,dx,dz,len,s:rnd()*len,v,wob:inside?R(.1,.35):R(.2,.9),ph:rnd()*6.28,ox:0,oz:0};ag.push(A);walkers.push(A);};
  for(let k=0;k<q.walk;k++){const z0=-R(150,176);mkWalker(R(-8.6,8.6),z0,0,1,R(150,176)-z0,false,{beer:rnd()<.12?1:0});}
  for(let k=0;k<q.walkIn;k++){const L=SW.lanesIn[k%SW.lanesIn.length];const dx=L[2]-L[0],dz=L[3]-L[1],len=Math.hypot(dx,dz);const kel=k%5<2;mkWalker(L[0],L[1],dx/len,dz/len,len,true,kel?{f:true,kind:'serve',beer:1,kellnerin:true}:{f:rnd()<.55,beer:1});}
  guards.length=0;
  if(bandI)for(const sx of[-1,1]){const p=bandI.grp.localToWorld(new V3(sx*1.5,0,bandI.SZ+8.15));const a=agent(1,p.x,0,p.z,bandI.rot,'idle',{f:false,beer:0,sc:1.09});
    a.guard=true;a.sx=sx;a.look=0;a.lag=0;a.post=[sx*1.5,bandI.SZ+8.15];blobS.push(a);const r=a.rec;r[4]=AN.guard[0];r[5]=AN.guard[1];r[6]=sx>0?20:0;r[7]=24;r[9]=0;r[10]=-1;
    r.set([.13,.15,.2,.07,.07,.08],12);r.set([.09,.09,.1],24);ag.push(a);guards.push(a);}
  player=agent(4,0,0,0,0,'idle',{f:false,beer:1,sc:1});const pr=player.rec;pr[9]=(G.hasBeer?1:0)+2+4;pr.set([.651,.227,.247,.29,.196,.125,.902,.706,.561,.333,.212,.122,.851,.812,.722,G.fill],12);ag.push(player);
  const cnt=[0,0,0];for(const a of ag)cnt[a.c]++;
  crowd={agents:ag,walkers,kellner:walkers.filter(a=>a.kel),slots:[],total:ag.length-1,drawn:0,showIn:true,showOut:true};
  for(let c=0;c<3;c++)for(let l=0;l<3;l++){const CH=CHARS[c],geo=new THREE.InstancedBufferGeometry();
    for(const k of['position','normal','aJ','aW','aPart','aMh'])geo.setAttribute(k,CH.geos[l].attributes[k]);geo.setIndex(CH.geos[l].index);
    const arr=new Float32Array(Math.max(1,cnt[c])*32),ib=new THREE.InstancedInterleavedBuffer(arr,32,1);ib.setUsage(THREE.DynamicDrawUsage);
    ['iA','iB','iC','iC0','iC1','iC2','iC3','iD'].forEach((k,i)=>geo.setAttribute(k,new THREE.InterleavedBufferAttribute(ib,4,i*4)));
    geo.instanceCount=0;const mesh=new THREE.Mesh(geo,CH.mats[l]);mesh.frustumCulled=false;mesh.receiveShadow=true;scene.add(mesh);
    crowd.slots.push({geo,ib,arr,mesh,n:0});}
  crowd.blobDyn=new THREE.InstancedMesh(blobGeo,blobMat,walkers.length+1);crowd.blobDyn.frustumCulled=false;crowd.blobDyn.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(crowd.blobDyn);
  crowd.blobStatic=new THREE.InstancedMesh(blobGeo,blobMat,Math.max(1,blobS.length));blobS.forEach((a,i)=>writeMat(crowd.blobStatic.instanceMatrix.array,i,a.rec[0],a.rec[1]+.025,a.rec[2],0,1));crowd.blobStatic.count=blobS.length;crowd.blobStatic.computeBoundingSphere();scene.add(crowd.blobStatic);
  crowdRects=[];for(const a of blobS)if(a.rec[1]<.5)rectW(a.rec[0]-.22,a.rec[0]+.22,a.rec[2]-.22,a.rec[2]+.22,crowdRects);
  return crowd.total;
}
const _fr=new THREE.Frustum(),_pm=new THREE.Matrix4(),_sp=new THREE.Sphere(new V3(),1.3);
function crowdCull(){
  camera.updateMatrixWorld();_pm.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);_fr.setFromProjectionMatrix(_pm);
  const cx=camera.position.x,cz=camera.position.z,q=Q[quality],h2=q.hi*q.hi,m2=q.mid*q.mid,S=crowd.slots;
  for(const s of S)s.n=0;let drawn=0;
  for(const a of crowd.agents){
    if((a.g===1&&!crowd.showIn)||(a.g===0&&!crowd.showOut)||(a.g===4&&(firstPerson||!started)))continue;
    const r=a.rec;_sp.center.set(r[0],r[1]+.9,r[2]);if(!_fr.intersectsSphere(_sp))continue;
    const dx=r[0]-cx,dz=r[2]-cz,d2=dx*dx+dz*dz,l=a.g===4||d2<h2?0:d2<m2?1:2;
    const s=S[a.c*3+l];s.arr.set(r,s.n*32);s.n++;drawn++;}
  for(const s of S){s.geo.instanceCount=s.n;if(s.n){s.ib.updateRange.offset=0;s.ib.updateRange.count=s.n*32;s.ib.needsUpdate=true;}}
  crowd.drawn=drawn-(started&&!firstPerson?1:0);
}
function estimate(qname){const q=Q[qname];return Math.round(seatSlots.out.length*q.fillOut+(seatSlots.in.length+standSpots.in.length)*q.fillIn+q.stand*1.05+q.walk+q.walkIn+boothFronts.length*1.1);}
const fmt=n=>n.toLocaleString('en-US');
$('#nFull').textContent='≈ '+fmt(Math.round(estimate('full')/100)*100);
$('#nLight').textContent='≈ '+fmt(Math.round(estimate('light')/100)*100);
let walkPhase=0,heading=2.46,firstPerson=false,boom=3.2;
buildCrowd(quality);
function setQualityButtons(){$('#qFull').setAttribute('aria-pressed',quality==='full');$('#qLight').setAttribute('aria-pressed',quality==='light');}
setQualityButtons();
const _sh=new V3(),_bk=new V3();
for(const[id,q]of[['#qFull','full'],['#qLight','light']])$(id).addEventListener('click',()=>{if(quality===q)return;quality=q;setQualityButtons();renderer.setPixelRatio(Q[q].pr);renderer.setSize(innerWidth,innerHeight,false);post.setSize();buildCrowd(q);});

/* ---------------- audio: crowd murmur, oom-pah waltz, Prosit ---------------- */
let AC=null,master,bandBus,bandLP,bandGain,verbSend,murmurGain,babbleBus,muted=false,nextSyl=0,babbleRate=14;
const band={state:'song',bar:0,beat:0,next:0,loops:0,until:0};
const BEAT=60/168;
const PROG=['F','F','C','C','C','C','F','F','F','F','B','B','F','C','F','F'];
const CH={F:[60,65,69],C:[58,64,67],B:[62,65,70]},BASS={F:[41,36],C:[36,31],B:[34,41]};
const MEL=[[[72,3]],[[69,1],[72,1],[77,1]],[[76,2],[74,1]],[[72,3]],[[70,1],[72,1],[74,1]],[[76,2],[79,1]],[[77,2],[72,1]],[[69,3]],
  [[72,1],[69,1],[72,1]],[[77,2],[76,1]],[[74,2],[77,1]],[[74,3]],[[72,1],[69,1],[65,1]],[[67,1],[70,1],[76,1]],[[77,3]],[[0,3]]];
const hz=m=>440*Math.pow(2,(m-69)/12);
function noiseBuf(sec){const b=AC.createBuffer(1,AC.sampleRate*sec,AC.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;return b;}
/* iOS plays Web Audio in the 'ambient' session, which the ring/silent switch mutes. A looping silent
   <audio> element (started inside the tap) moves the page to the 'playback' session, like a music player. */
function unlockIOSAudio(){try{
  const n=4000,b=new ArrayBuffer(44+n*2),v=new DataView(b),w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
  w(0,'RIFF');v.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
  v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*2,true);
  const a=new Audio(URL.createObjectURL(new Blob([b],{type:'audio/wav'})));a.loop=true;a.setAttribute('playsinline','');a.play().catch(()=>{});unlockIOSAudio.el=a;
}catch(e){}}
function initAudio(){
  if(AC)return;
  try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch(e){}
  unlockIOSAudio();
  try{AC=new(window.AudioContext||window.webkitAudioContext)();}catch(e){AC=null;return;}
  const wake=()=>{if(AC&&!paused&&AC.state!=='running')AC.resume().catch(()=>{});};
  addEventListener('touchend',wake,{passive:true});addEventListener('pointerdown',wake);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)wake();});
  master=AC.createGain();master.gain.value=.8;master.connect(AC.destination);
  const verb=AC.createConvolver();const L=AC.sampleRate*2.4,ir=AC.createBuffer(2,L,AC.sampleRate);for(let c=0;c<2;c++){const d=ir.getChannelData(c);for(let i=0;i<L;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/L,3.2);}verb.buffer=ir;
  verbSend=AC.createGain();verbSend.gain.value=.25;verbSend.connect(verb);verb.connect(master);
  bandBus=AC.createGain();bandLP=AC.createBiquadFilter();bandLP.type='lowpass';bandLP.frequency.value=700;bandGain=AC.createGain();bandGain.gain.value=.15;
  bandBus.connect(bandLP).connect(bandGain);bandGain.connect(master);bandGain.connect(verbSend);
  const nz=AC.createBufferSource();nz.buffer=noiseBuf(3);nz.loop=true;const bp=AC.createBiquadFilter();bp.type='bandpass';bp.frequency.value=620;bp.Q.value=.7;
  const lp=AC.createBiquadFilter();lp.type='lowpass';lp.frequency.value=1800;murmurGain=AC.createGain();murmurGain.gain.value=.05;
  nz.connect(bp).connect(lp).connect(murmurGain).connect(master);murmurGain.connect(verbSend);nz.start();
  babbleBus=AC.createGain();babbleBus.gain.value=.5;babbleBus.connect(master);babbleBus.connect(verbSend);
  band.next=AC.currentTime+.3;band.state='song';band.bar=0;band.beat=0;band.loops=0;nextSyl=AC.currentTime;
}
function tone(t,dur,m,{type='sawtooth',gain=.08,cut=1800,att=.012,detune=0,vib=0,dest=bandBus}={}){
  const o=AC.createOscillator();o.type=type;o.frequency.value=hz(m);o.detune.value=detune;
  const f=AC.createBiquadFilter();f.type='lowpass';f.frequency.value=cut;const g=AC.createGain();
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(gain,t+att);g.gain.setValueAtTime(gain,t+Math.max(att+.01,dur*.7));g.gain.linearRampToValueAtTime(0,t+dur);
  if(vib){const l=AC.createOscillator();l.frequency.value=5.4;const lg=AC.createGain();lg.gain.setValueAtTime(0,t);lg.gain.linearRampToValueAtTime(vib,t+Math.min(.3,dur));l.connect(lg).connect(o.detune);l.start(t);l.stop(t+dur+.05);}
  o.connect(f).connect(g).connect(dest);o.start(t);o.stop(t+dur+.05);
}
function hit(t,{freq=60,dur=.18,gain=.3,noise=false,hp=3000}={}){
  if(noise){const s=AC.createBufferSource();s.buffer=noiseBuf(.3);const f=AC.createBiquadFilter();f.type='highpass';f.frequency.value=hp;const g=AC.createGain();g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);s.connect(f).connect(g).connect(bandBus);s.start(t);s.stop(t+dur+.02);return;}
  const o=AC.createOscillator();o.frequency.setValueAtTime(freq*1.8,t);o.frequency.exponentialRampToValueAtTime(freq,t+.06);const g=AC.createGain();g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);o.connect(g).connect(bandBus);o.start(t);o.stop(t+dur+.02);
}
function scheduleBeat(t){
  const c=PROG[band.bar];
  if(band.beat===0){tone(t,BEAT*.9,BASS[c][band.bar%2],{gain:.2,cut:420,att:.02});hit(t,{freq:55,gain:.35});
    let tt=t;for(const[m,b]of MEL[band.bar]){if(m){const d=b*BEAT*.95;tone(tt,d,m,{gain:.05,cut:2600,detune:-7,vib:9});tone(tt,d,m,{gain:.05,cut:2600,detune:7,vib:9});tone(tt,d,m-12,{type:'square',gain:.016,cut:1500});}tt+=b*BEAT;}}
  else{for(const m of CH[c])tone(t,BEAT*.42,m,{type:'square',gain:.03,cut:1500});hit(t,{noise:true,gain:.06,dur:.07,hp:5000});}
}
/* Ein Prosit der Gemütlichkeit (Bernhard Dittrich, 1898, public domain), arranged for the synth brass band and a formant choir, then the countdown and cheer */
const PB=.4;
const PROSIT_MEL=[[69,.5,'D'],[74,1,'D'],[74,1.5,'D'],[74,.5,'D'],[78,1,'D'],[78,1.5,'D'],[78,.5,'D'],[81,.5,'D'],[81,1.5,'D'],[79,.5,'A'],[76,2,'A'],
  [69,.5,'D'],[74,1,'D'],[74,1.5,'D'],[74,.5,'D'],[78,1,'D'],[78,1.5,'D'],[76,.5,'A'],[79,.5,'A'],[79,1.5,'A'],[76,.5,'A'],[74,2.5,'D']];
const PROSIT_BEATS=PROSIT_MEL.reduce((a,n)=>a+n[1],0),P_SONG=PROSIT_BEATS*PB,P_TOTAL=P_SONG+4.2;
const PCH={D:[62,66,69],A:[61,64,67]},PBASS={D:[38,45],A:[33,40]};
function shout(t,n,gain){for(let i=0;i<n;i++)syllable(t+Math.random()*.16,gain);
  const s=AC.createBufferSource();s.buffer=noiseBuf(.6);const f=AC.createBiquadFilter();f.type='bandpass';f.frequency.value=R(700,1100);f.Q.value=1.2;const g=AC.createGain();
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(gain*3,t+.04);g.gain.exponentialRampToValueAtTime(.005,t+.35);s.connect(f).connect(g).connect(babbleBus);s.start(t);s.stop(t+.5);}
/* formant choir: each voice is a vibrato sawtooth "voice box" through three vowel resonances; consonants are shared noise bursts */
const VOW={a:[730,1090,2440],e:[480,1900,2550],i:[290,2250,3000],o:[420,760,2550],u:[320,780,2250],y:[290,1700,2150],E:[500,1500,2450]};
const PROSIT_SYL=[['','ai','n'],['p','o',''],['s','i','t'],['','ai','n'],['p','o',''],['s','i','t'],['d','e','r'],['g','E',''],['m','y','t'],['l','i','ch'],['k','ai','t']];
function consonant(t,c,gain,dest=bandBus){
  if(!c||c==='n'||c==='m'||c==='l'||c==='r')return;
  const n=AC.createBufferSource();n.buffer=noiseBuf(.3);const f=AC.createBiquadFilter(),g=AC.createGain();
  let dur=.035,fr=2200,type='bandpass',q=1.2,amp=gain;
  if(c==='s'||c==='ts'){dur=.12;fr=5500;type='highpass';q=.7;amp=gain*.7;}
  else if(c==='ch'){dur=.11;fr=3600;q=2.5;amp=gain*.6;}
  else if(c==='f'){dur=.1;fr=2500;type='highpass';q=.5;amp=gain*.45;}
  else if(c==='k'||c==='g'){fr=1800;}else if(c==='t'||c==='d'){fr=3800;}else if(c==='p'){fr=900;}
  f.type=type;f.frequency.value=fr;f.Q.value=q;
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(amp,t+.006);g.gain.exponentialRampToValueAtTime(.001,t+dur);
  n.connect(f).connect(g).connect(dest);n.start(t);n.stop(t+dur+.02);
}
function choir(notes,start,stop,dest=bandBus,NV=7){
  for(let v=0;v<NV;v++){
    const fem=v>=4,sc=fem?1.17:1,oct=fem?0:-12,det=R(-.012,.012),lag=R(0,.045);
    const o=AC.createOscillator();o.type='sawtooth';
    const lfo=AC.createOscillator(),lg=AC.createGain();lfo.frequency.value=R(4.8,6.2);lg.gain.value=R(10,22);lfo.connect(lg).connect(o.detune);
    const pre=AC.createBiquadFilter();pre.type='lowpass';pre.frequency.value=4200;o.connect(pre);
    const env=AC.createGain();env.gain.setValueAtTime(0,start);
    const F=[0,1,2].map(k=>{const bp=AC.createBiquadFilter();bp.type='bandpass';bp.Q.value=[6,11,15][k];const gg=AC.createGain();gg.gain.value=[1,.55,.3][k]*(fem?.85:1);pre.connect(bp).connect(gg).connect(env);return bp;});
    env.connect(dest);
    const lvl=(fem?.05:.065)*R(.8,1.15);
    for(const n of notes){
      const t=n.t+lag,d=n.d,fq=hz(n.m+oct)*(1+det),vw=n.v.length>1?n.v:n.v+n.v;
      o.frequency.setTargetAtTime(fq,t,.03);
      if(n.glide)o.frequency.setTargetAtTime(fq*Math.pow(2,n.glide/12),t+d*.3,d*.4);
      const A=VOW[vw[0]],B=VOW[vw[1]];
      F.forEach((bp,k)=>{bp.frequency.setTargetAtTime(A[k]*sc,t,.02);if(vw[0]!==vw[1])bp.frequency.setTargetAtTime(B[k]*sc,t+d*.45,d*.18);});
      const L=lvl*(n.loud||1);
      env.gain.setTargetAtTime(L,t+.015,.025);env.gain.setTargetAtTime(L*(n.c1==='m'||n.c1==='n'?.5:.82),t+d*.6,d*.15);
      env.gain.setTargetAtTime(n.gap?0:L*.3,t+d-.05,.02);
    }
    env.gain.setTargetAtTime(0,stop,.08);
    o.start(start);lfo.start(start);o.stop(stop+.6);lfo.stop(stop+.6);
  }
  for(const n of notes){consonant(n.t,n.c0,.16*(n.loud||1),dest);if(n.c1)consonant(n.t+n.d-.06,n.c1==='n'||n.c1==='r'?'':n.c1,.1*(n.loud||1),dest);}
}
function scheduleProsit(t){
  for(let i=0;i<10;i++)hit(t+i*.05,{noise:true,gain:.02+i*.006,dur:.06,hp:2500});
  const t0=t+.55;let tt=t0;const chordAt=[];
  for(const[m,b,c]of PROSIT_MEL){const d=b*PB*.97,last=tt-t0>P_SONG-1.2;
    tone(tt,d,m,{gain:.06,cut:3400,detune:-7,vib:last?14:8});tone(tt,d,m,{gain:.06,cut:3400,detune:7,vib:last?14:8});
    tone(tt,d,m-12,{type:'square',gain:.02,cut:1800});tone(tt,d,m-5,{gain:.025,cut:2200,detune:3});
    for(let k=0;k<b*2;k++)chordAt.push(c);tt+=b*PB;}
  for(let i=0;i<PROSIT_BEATS;i++){const c=chordAt[i*2]||'D',bt=t0+i*PB;
    if(i%2===0){tone(bt,PB*.9,PBASS[c][(i/2)%2],{gain:.22,cut:420,att:.02});hit(bt,{freq:55,gain:.32});}
    else{for(const m of PCH[c])tone(bt,PB*.42,m,{type:'square',gain:.028,cut:1500});hit(bt,{noise:true,gain:.06,dur:.07,hp:5000});}}
  for(const m of PCH.D)tone(tt-2.5*PB,2.5*PB,m,{gain:.03,cut:1800});
  const sung=[];let st=t0;PROSIT_MEL.forEach(([m,b],i)=>{const y=PROSIT_SYL[i%11];sung.push({t:st,d:b*PB,m,c0:y[0],v:y[1],c1:y[2]});st+=b*PB;});
  const s0=t0+P_SONG+.45;
  const shouts=[{t:s0,d:.42,m:57,c0:'',v:'oa',c1:'s',glide:-3,loud:1.5,gap:1},{t:s0+.62,d:.42,m:58,c0:'ts',v:'oa',c1:'',glide:-3,loud:1.5,gap:1},
    {t:s0+1.24,d:.42,m:59,c0:'d',v:'ai',c1:'',glide:-3,loud:1.6,gap:1},{t:s0+1.9,d:.16,m:62,c0:'g',v:'u',c1:'',loud:1.8},{t:s0+2.06,d:.7,m:64,c0:'f',v:'a',c1:'',glide:-5,loud:1.9,gap:1}];
  choir(sung.concat(shouts),t0-.05,s0+2.9);
  for(let i=0;i<3;i++){shout(s0+i*.62,14,.05);hit(s0+i*.62,{freq:60,gain:.4,dur:.25});}
  const g0=s0+1.9;for(let i=0;i<12;i++)hit(g0-.3+i*.025,{noise:true,gain:.03+i*.005,dur:.05,hp:2500});hit(g0,{freq:48,gain:.55,dur:.5});
  const s=AC.createBufferSource();s.buffer=noiseBuf(2.5);const f=AC.createBiquadFilter();f.type='bandpass';f.frequency.value=950;f.Q.value=.9;const g=AC.createGain();
  g.gain.setValueAtTime(0,g0);g.gain.linearRampToValueAtTime(.5,g0+.12);g.gain.exponentialRampToValueAtTime(.01,g0+2.2);s.connect(f).connect(g).connect(babbleBus);s.start(g0);s.stop(g0+2.4);
  for(let i=0;i<90;i++)syllable(g0+Math.random()*1.5,.1);
}
function syllable(t,gain){
  const o=AC.createOscillator();o.type='sawtooth';const f0=Math.random()<.5?R(95,150):R(170,260);o.frequency.setValueAtTime(f0,t);o.frequency.linearRampToValueAtTime(f0*R(.85,1.2),t+.2);
  const f=AC.createBiquadFilter();f.type='bandpass';f.frequency.value=R(450,1900);f.Q.value=3.5;const g=AC.createGain();const d=R(.07,.22);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(gain,t+.02);g.gain.linearRampToValueAtTime(0,t+d);
  const p=AC.createStereoPanner?AC.createStereoPanner():null;
  if(p){p.pan.value=R(-.9,.9);o.connect(f).connect(g).connect(p).connect(babbleBus);}else o.connect(f).connect(g).connect(babbleBus);
  o.start(t);o.stop(t+d+.02);
}
let prositAt=-1,prositPending=false,schunkelTarget=0;
function audioTick(){
  if(!AC)return;const now=AC.currentTime;
  if(prositPending){prositPending=false;const st=Math.max(band.next,now+.05);band.state='prosit';band.until=st+P_TOTAL+.4;scheduleProsit(st);}
  while(band.next<now+.15){
    if(band.state==='song'){scheduleBeat(band.next);band.next+=BEAT;band.beat++;if(band.beat>2){band.beat=0;band.bar++;if(band.bar>15){band.bar=0;band.loops++;if(band.loops>=2){band.state='pause';band.until=band.next+14;band.loops=0;}}}}
    else{band.next+=BEAT;if(band.next>=band.until){band.state='song';band.bar=0;band.beat=0;}}
  }
  while(nextSyl<now+.2){syllable(nextSyl,R(.02,.05));nextSyl+=-Math.log(1-Math.random())/babbleRate;}
}

/* ---------------- input ---------------- */
const keys={};let started=false,paused=true,hadLock=false,mouseDown=false;
const P={x:4,z:-62,yaw:2.46,pitch:-.03,bob:0,vx:0,vz:0};
addEventListener('keydown',e=>{keys[e.code]=true;if(!started)return;
  if(e.code==='KeyP')prost();if(e.code==='KeyM')toggleSound();if(e.code==='KeyV')toggleView();if(e.code==='KeyF'&&!e.repeat&&!e.metaKey&&!e.ctrlKey)toggleFullscreen();
  if(e.code==='Escape'&&!document.pointerLockElement&&!G.ko&&!G.over&&!G.take){paused?resume():pause();}
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();});
addEventListener('keyup',e=>{keys[e.code]=false;});
addEventListener('blur',()=>{for(const k in keys)keys[k]=false;});
canvas.addEventListener('mousedown',e=>{mouseDown=true;if(started&&!paused&&!document.pointerLockElement&&!isTouch)tryLock();});
addEventListener('mouseup',()=>mouseDown=false);
addEventListener('mousemove',e=>{if(paused)return;if(document.pointerLockElement===canvas||mouseDown){P.yaw-=e.movementX*.0022;P.pitch=clamp(P.pitch-e.movementY*.0022,-1.35,1.35);}});
function tryLock(){try{const r=canvas.requestPointerLock();if(r&&r.catch)r.catch(()=>{});}catch(e){}}
document.addEventListener('mousedown',e=>{if(e.button===0&&document.pointerLockElement===canvas&&started&&!paused)prost();});
document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement===canvas){hadLock=true;}else if(hadLock&&started&&!paused)pause();});
/* touch: the Intus joystick (lower-left corner takes the thumb, the stick follows it) and drag anywhere else to look */
const stickZone=$('#stickZone'),stickPad=$('#stickPad'),knob=$('#knob');
stickPad.insertAdjacentHTML('afterbegin',stickSVG(112));
const stickArt=stickPad.querySelector('.stick-art'),stickFills=[...stickPad.querySelectorAll('.fill')];
const stk={x:0,y:0};let stickId=null,lookId=null,lx=0,ly=0,sx=0,sy=0,sr=56;
const stickMove=t=>{let x=(t.clientX-sx)/sr,y=(t.clientY-sy)/sr;const m=Math.hypot(x,y);if(m>1){x/=m;y/=m;}stk.x=x;stk.y=y;
  knob.style.transform=`translate(${x*20}px,${y*20}px)`;stickArt.classList.toggle('run',m>.95);
  for(const f of stickFills){const d=f.dataset.dir;f.classList.toggle('on',(d==='f'&&y<-.35)||(d==='b'&&y>.35)||(d==='l'&&x<-.35)||(d==='r'&&x>.35));}};
const stickStart=t=>{stickPad.style.transform='';const r=stickPad.getBoundingClientRect();sr=r.width/2;sx=r.left+sr;sy=r.top+sr;
  if(Math.hypot(t.clientX-sx,t.clientY-sy)>sr+12){const nx=clamp(t.clientX,sr+8,innerWidth-sr-8),ny=clamp(t.clientY,sr+8,innerHeight-sr-8);stickPad.style.transform=`translate(${nx-sx}px,${ny-sy}px)`;sx=nx;sy=ny;}
  stickMove(t);};
stickZone.addEventListener('touchstart',e=>{e.preventDefault();if(paused)return;if(stickId!==null&&[...e.touches].some(t=>t.identifier===stickId))return;stickId=e.changedTouches[0].identifier;stickStart(e.changedTouches[0]);},{passive:false});
canvas.addEventListener('touchstart',e=>{e.preventDefault();if(paused)return;const t=e.changedTouches[0];lookId=t.identifier;lx=t.clientX;ly=t.clientY;},{passive:false});
addEventListener('touchmove',e=>{for(const t of e.changedTouches){
  if(t.identifier===stickId)stickMove(t);
  else if(t.identifier===lookId){const dx=t.clientX-lx,dy=t.clientY-ly;if(gyro.on)gyro.turn(-dx*.25);else{P.yaw-=dx*.0045;P.pitch=clamp(P.pitch-dy*.0045,-1.3,1.3);}lx=t.clientX;ly=t.clientY;}}},{passive:true});
const touchEnd=e=>{for(const t of e.changedTouches){
  if(t.identifier===stickId){stickId=null;stk.x=stk.y=0;knob.style.transform='';stickPad.style.transform='';stickArt.classList.remove('run');stickFills.forEach(f=>f.classList.remove('on'));}
  if(t.identifier===lookId)lookId=null;}};
addEventListener('touchend',touchEnd);addEventListener('touchcancel',touchEnd);

/* look around by moving the phone (Intus gyro) */
const gyro=new Gyro();
if(isTouch&&Gyro.supported){const btn=$('#gyroBtn');btn.querySelector('.gy').innerHTML=PHONE_FLIP;btn.hidden=false;
  btn.addEventListener('click',async e=>{e.stopPropagation();
    if(gyro.on){gyro.disable();btn.setAttribute('aria-pressed','false');showHint('Drag to look around',3);return;}
    try{await gyro.enable(P.yaw*180/Math.PI);btn.setAttribute('aria-pressed','true');showHint('Move your phone to look around',3);}
    catch(err){showHint(err.message==='denied'?'Motion access was not allowed':"This phone doesn't report how it's turned",4);}});}

/* full screen; where the browser can't (iPhone), the button explains Add to Home Screen */
const fsElement=()=>document.fullscreenElement||document.webkitFullscreenElement||null;
const fullscreenOK=!!(document.fullscreenEnabled||document.webkitFullscreenEnabled);
const standalone=navigator.standalone||matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
function toggleFullscreen(){if(!fullscreenOK)return;const el=document.documentElement;
  if(fsElement())(document.exitFullscreen||document.webkitExitFullscreen)?.call(document)?.catch?.(()=>{});
  else (el.requestFullscreen||el.webkitRequestFullscreen)?.call(el,{navigationUI:'hide'})?.catch?.(()=>{});}
{const fb=$('#fsBtn'),help=$('#fsHelp'),FS_IN=fb.querySelector('.fsi').innerHTML,FS_OUT=FS_IN.replace('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5','M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5');
  if(fullscreenOK){fb.hidden=false;const sync=()=>{const on=!!fsElement();fb.querySelector('.fsi').innerHTML=on?FS_OUT:FS_IN;fb.setAttribute('aria-pressed',String(on));fb.title=on?'Exit full screen (F)':'Full screen (F)';};
    sync();document.addEventListener('fullscreenchange',sync);document.addEventListener('webkitfullscreenchange',sync);fb.addEventListener('click',e=>{e.stopPropagation();toggleFullscreen();});}
  else if(!standalone&&isTouch){fb.hidden=false;const setHelp=open=>{help.hidden=!open;fb.setAttribute('aria-pressed',String(open));};
    fb.addEventListener('click',e=>{e.stopPropagation();setHelp(help.hidden);});$('#fsHelpX').addEventListener('click',()=>setHelp(false));
    addEventListener('pointerdown',e=>{if(!help.hidden&&!help.contains(e.target)&&!fb.contains(e.target))setHelp(false);});}}
if(isTouch)$('#bProst').hidden=false;

/* start screen: how to play, as pictures */
{const tile=(art,word,cls='')=>`<div class="how-tile ${cls}"><div class="how-art">${art}</div><span>${word}</span></div>`;
  const KEY=l=>`<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><rect x="12" y="12" width="40" height="40" rx="9"/><text x="32" y="33" stroke="none" text-anchor="middle" dominant-baseline="central">${l}</text></svg>`;
  $('#how').innerHTML=isTouch
    ?tile(stickSVG(132,true),'Walk','stick')+tile(SWIPE,'Look')+(Gyro.supported?tile(PHONE_FLIP,'Tilt','flip'):'')+tile('<b>Prost!</b>','Drink','prost')
    :tile(keypadSVG({arrows:false}),'Walk','wasd')+tile(MOUSE,'Look')+tile(KEY('P'),'Prost','key')+tile(KEY('V'),'View','key');
  $('#howNote').textContent=isTouch?'Push the stick to its edge to run. Drag anywhere else to look around. Tap Prost! to drink.':'P or left click to drink · Shift to run · M for sound · F for full screen · Esc pauses';}

/* radar: pre-drawn top-down map, rotated with the view each frame */
const MX0=-170,MZ0=-210,MS=2;
const mapImg=mkCanvas(680,900);
(()=>{const g=mapImg.getContext('2d');const X=x=>(x-MX0)*MS,Z=z=>(z-MZ0)*MS;
  g.fillStyle='#34402f';g.fillRect(0,0,680,900);
  g.fillStyle='#5d5d55';g.fillRect(X(-60),Z(-185),120*MS,410*MS);
  g.fillStyle='#9a978c';g.fillRect(X(-9.5),Z(-185),19*MS,410*MS);
  for(const t of TENTS){const pts=[[-22,-60],[22,-60],[22,0],[-22,0]].map(([x,z])=>t.grp.localToWorld(new V3(x,0,z)));
    const gp=[[-21.6,0],[21.6,0],[21.6,14.4],[-21.6,14.4]].map(([x,z])=>t.grp.localToWorld(new V3(x,0,z)));
    g.fillStyle='#7b6f58';g.beginPath();gp.forEach((p,i)=>i?g.lineTo(X(p.x),Z(p.z)):g.moveTo(X(p.x),Z(p.z)));g.fill();
    g.fillStyle=t.color;g.strokeStyle='rgba(0,0,0,.55)';g.lineWidth=2;g.beginPath();pts.forEach((p,i)=>i?g.lineTo(X(p.x),Z(p.z)):g.moveTo(X(p.x),Z(p.z)));g.closePath();g.fill();g.stroke();
    const c=t.grp.localToWorld(new V3(0,0,-30));g.save();g.translate(X(c.x),Z(c.z));g.fillStyle='rgba(255,248,230,.92)';g.font=`600 15px ${GOT}`;g.textAlign='center';g.textBaseline='middle';g.fillText(t.short,0,0);g.restore();}
  for(const b of boothFronts){g.fillStyle='#c09a5c';g.fillRect(X(b.x)-4,Z(b.z)-4,8,8);}
  g.strokeStyle='#e9e3d6';g.lineWidth=3;g.beginPath();g.arc(X(30),Z(218),13*MS,0,7);g.stroke();
  g.beginPath();g.arc(X(-40),Z(34),9*MS,0,7);g.stroke();
  g.fillStyle='#e8b44c';g.strokeStyle='#000';g.lineWidth=2;g.beginPath();g.arc(X(doorW.x),Z(doorW.z),9,0,7);g.fill();g.stroke();
  g.fillStyle='#1a1105';g.font=`800 13px ${GOT}`;g.textAlign='center';g.textBaseline='middle';g.fillText('S',X(doorW.x),Z(doorW.z)+1);
})();
const mapC=$('#map'),mctx=mapC.getContext('2d');
function drawRadar(){const W=mapC.width,H=mapC.height;mctx.setTransform(1,0,0,1,0,0);mctx.fillStyle='#34402f';mctx.fillRect(0,0,W,H);
  mctx.save();mctx.translate(W/2,H*.62);mctx.rotate(P.yaw);mctx.scale(1.35,1.35);mctx.drawImage(mapImg,-(P.x-MX0)*MS,-(P.z-MZ0)*MS);
  if(bandI&&guards.length&&Math.hypot(P.x-stageW.x,P.z-stageW.z)<34){
    for(const g of guards){const r=g.rec,x=(r[0]-P.x)*MS,y=(r[2]-P.z)*MS,a=Math.PI/2-r[3];
      mctx.fillStyle=g.away?'rgba(240,199,90,.18)':'rgba(230,60,45,.34)';mctx.beginPath();mctx.moveTo(x,y);mctx.arc(x,y,9*MS,a-.95,a+.95);mctx.closePath();mctx.fill();
      mctx.fillStyle='#e8402e';mctx.strokeStyle='#000';mctx.lineWidth=1.5;mctx.beginPath();mctx.arc(x,y,4,0,7);mctx.fill();mctx.stroke();}}
  if(!G.hasBeer){const pulse=.6+.4*Math.sin(performance.now()/180);mctx.fillStyle=`rgba(240,199,90,${pulse})`;mctx.strokeStyle='#000';mctx.lineWidth=1.5;
    for(const k of crowd.kellner){const x=(k.rec[0]-P.x)*MS,y=(k.rec[2]-P.z)*MS;mctx.beginPath();mctx.arc(x,y,4.5,0,7);mctx.fill();mctx.stroke();}
    const d=doorW;mctx.strokeStyle=`rgba(240,199,90,${pulse})`;mctx.lineWidth=3;mctx.beginPath();mctx.arc((d.x-P.x)*MS,(d.z-P.z)*MS,14,0,7);mctx.stroke();}
  mctx.restore();
  mctx.save();mctx.translate(W/2,H*.62);mctx.fillStyle='#fff';mctx.strokeStyle='#000';mctx.lineWidth=2.5;mctx.beginPath();mctx.moveTo(0,-13);mctx.lineTo(9,10);mctx.lineTo(0,5);mctx.lineTo(-9,10);mctx.closePath();mctx.stroke();mctx.fill();mctx.restore();
}
let areaTimer=0;
const DISTRICT={'Festhalle Sonnenwirt':'Festhalle · Wirtsbudenstraße','Wirtsbudenstraße':'Theresienwiese · München','Riesenrad':'Schaustellerstraße','Theresienwiese':'München'};
const startEl=$('#start'),hud=$('#hud'),go=$('#go'),hint=$('#hint');
function begin(){document.body.classList.add('playing');startEl.hidden=true;hud.hidden=false;paused=false;if(isTouch)stickZone.hidden=false;hudGame();
  if(!started){started=true;P.x=4;P.z=-62;P.yaw=2.46;P.pitch=-.03;initAudio();showHint(hint.textContent,14);lastAuto=performance.now()/1000;}
  if(AC&&AC.state==='suspended')AC.resume();
  if(!isTouch)tryLock();canvas.focus();}
function pause(){if(G.over||G.ko||G.take)return;document.body.classList.remove('playing');paused=true;startEl.hidden=false;stickZone.hidden=true;go.textContent='Continue walking';$('#eyebrow').textContent='Paused';if(AC&&AC.state==='running')AC.suspend();for(const k in keys)keys[k]=false;}
function resume(){begin();}
go.addEventListener('click',begin);
$('#bProsit').addEventListener('click',e=>{e.stopPropagation();prost();});
$('#bSound').addEventListener('click',e=>{e.stopPropagation();toggleSound();});
$('#bView').addEventListener('click',e=>{e.stopPropagation();toggleView();});
$('#bProst').addEventListener('click',e=>{e.stopPropagation();prost();});
function toggleView(){firstPerson=!firstPerson;hud.classList.toggle('fp',firstPerson);$('#bView').setAttribute('aria-pressed',String(firstPerson));}
function toggleSound(){muted=!muted;if(master)master.gain.setTargetAtTime(muted?0:.8,AC.currentTime,.05);$('#soundLabel').textContent=muted?'Sound off':'Sound on';const b=$('#bSound');b.classList.toggle('off',muted);b.setAttribute('aria-pressed',String(!muted));b.setAttribute('aria-label',muted?'Sound off':'Sound on');}
let prositStart=-99,prositEnd=-99,lastAuto=0;
function callProsit(){const now=performance.now()/1000;if(now<prositEnd+2)return;prositStart=now+.5;prositEnd=now+.5+P_SONG+2.9;if(AC)prositPending=true;lastAuto=now;}
let hintTimer=0;function showHint(text,sec){hint.textContent=text;hint.classList.remove('off');hintTimer=sec;}

/* ---------------- simulation ---------------- */
function collide(p){const r=.35;
  const up=bandI&&((P.y||0)>.3||inStairs(p.x,p.z));
  for(const list of[rects,crowdRects])for(const b of list){if(p.x+r<b.x0||p.x-r>b.x1||p.z+r<b.z0||p.z-r>b.z1)continue;if(up&&b.band)continue;
    const cx=clamp(p.x,b.x0,b.x1),cz=clamp(p.z,b.z0,b.z1);const dx=p.x-cx,dz=p.z-cz,d2=dx*dx+dz*dz;
    if(d2>1e-9){if(d2<r*r){const d=Math.sqrt(d2);p.x=cx+dx/d*r;p.z=cz+dz/d*r;}}
    else{const l=p.x-b.x0,rr=b.x1-p.x,t=p.z-b.z0,bb=b.z1-p.z,m=Math.min(l,rr,t,bb);if(m===l)p.x=b.x0-r;else if(m===rr)p.x=b.x1+r;else if(m===t)p.z=b.z0-r;else p.z=b.z1+r;}}
  p.x=clamp(p.x,-140,140);p.z=clamp(p.z,-200,205);}
function updatePlayer(dt){
  if(G.ko){koUpdate(dt);return;}
  if(G.take){takeUpdate(dt);return;}
  if(G.over)return;
  if(t_stun()){for(const k in keys)keys[k]=false;}
  if(gyro.on){const q=gyro.frame(dt);if(q){const yp=yawPitchOf(q);P.yaw=yp.yaw*Math.PI/180;P.pitch=clamp(yp.pitch*Math.PI/180,-1.3,1.3);}}
  let f=0,s=0,run=keys.ShiftLeft||keys.ShiftRight;
  if(keys.KeyW||keys.ArrowUp)f+=1;if(keys.KeyS||keys.ArrowDown)f-=1;if(keys.KeyD||keys.ArrowRight)s+=1;if(keys.KeyA||keys.ArrowLeft)s-=1;
  if(stickId!==null){f-=stk.y;s+=stk.x;if(Math.hypot(stk.x,stk.y)>.95)run=true;}
  const l=Math.hypot(f,s);if(l>1){f/=l;s/=l;}
  /* Rausch: the more sips, the more the walk drifts, the steering wanders and now and then you nearly fall */
  const d=G.drunk,t=performance.now()/1000,moving=l>.1?1:0;
  if(d>0){const wa=d*1.05*(Math.sin(t*.61+2)+.55*Math.sin(t*1.53+.7)+.25*Math.sin(t*3.1));const c0=Math.cos(wa),s0=Math.sin(wa);const f2=f*c0-s*s0;s=f*s0+s*c0;f=f2;
    P.yaw+=d*.32*(Math.sin(t*.37+1.1)+.4*Math.sin(t*1.7))*dt;}
  const sp=(run?6.2-2.2*d:3.1)*(1-.25*d),sn=Math.sin(P.yaw),cs=Math.cos(P.yaw);
  const tx=(-sn*f+cs*s)*sp,tz=(-cs*f-sn*s)*sp;const k=Math.min(1,dt*(10-7.5*d));P.vx+=(tx-P.vx)*k;P.vz+=(tz-P.vz)*k;
  let ex=0,ez=0;
  if(d>0){const dr=d*(.5+1.1*moving)*(Math.sin(t*.93)+.6*Math.sin(t*2.17+1.3)+.35*Math.sin(t*3.9+.4))*.75;ex+=cs*dr;ez+=-sn*dr;
    if(t-G.st.t>1.1&&Math.random()<dt*d*d*(.25+.7*moving+.6*(run?1:0))){G.st={t,side:Math.random()<.5?-1:1,amp:1.8+3.2*d,fwd:Math.random()<.45?1:0};popup(pick(['Hoppla!','Ups!','Obacht!','Hoppala!']),'small');}
    const st=t-G.st.t;if(st<1.4){const k2=G.st.amp*Math.exp(-st*2.6)*Math.min(1,st*8);ex+=(cs*G.st.side-sn*G.st.fwd*.6)*k2;ez+=(-sn*G.st.side-cs*G.st.fwd*.6)*k2;}}
  if(G.esc&&G.esc.phase!=='back'){escortPlayer(dt,t);ex=ez=0;}
  else{const px0=P.x,pz0=P.z;P.x+=(P.vx+ex)*dt;P.z+=(P.vz+ez)*dt;collide(P);bandFloor(px0,pz0,dt);}
  const v=Math.hypot(P.vx+ex,P.vz+ez);P.bob+=v*dt*2.1;
  {const st=t-G.st.t,sr=st<1.4?G.st.side*(.1+.22*d)*Math.sin(Math.min(1,st/.22)*Math.PI/2)*Math.exp(-st*2.1):0;
    G.roll=d*.09*Math.sin(t*.7)+d*.035*Math.sin(t*1.9)+sr;}
  camera.rotation.set(P.pitch+d*.05*Math.sin(t*1.13),P.yaw,G.roll);
  if(v>.25){const h=Math.atan2(P.vx+ex,P.vz+ez);let dd=h-heading;dd=Math.atan2(Math.sin(dd),Math.cos(dd));heading+=dd*Math.min(1,dt*10);}
  walkPhase=(walkPhase+dt*v/STRIDE[0])%1;const pr=player.rec;pr[0]=P.x;pr[1]=P.y||0;pr[2]=P.z;pr[3]=heading;pr[27]=G.fill;
  if(t-G.sipT<2.5){pr[4]=AN.sip[0];pr[5]=AN.sip[1];pr[6]=-G.sipT*24;pr[7]=24;}
  else if(v>.3){const A=G.hasBeer?AN.walkBeer:AN.walk;pr[4]=A[0];pr[5]=A[1];pr[6]=walkPhase*24;pr[7]=0;}
  else if(pr[4]!==AN.idle[0]){pr[4]=AN.idle[0];pr[5]=AN.idle[1];pr[6]=0;pr[7]=24;}
  writeMat(crowd.blobDyn.instanceMatrix.array,crowd.walkers.length,P.x,.025,P.z,0,1);
  if(firstPerson){camera.position.set(P.x,(P.y||0)+1.68+(reduced?0:Math.sin(P.bob*2)*(.03+.02*d)*Math.min(1,v/3))-.02*d,P.z);return;}
  _sh.set(.5,.22,0).applyEuler(camera.rotation).add(_p.set(P.x,1.58+(P.y||0),P.z));
  _bk.set(0,0,1).applyEuler(camera.rotation);
  const want=lerp(3.3,2.2,kIn);let bd=want;
  for(let k=1;k<=14;k++){const tt=want*k/14,x=_sh.x+_bk.x*tt,y=_sh.y+_bk.y*tt,z=_sh.z+_bk.z*tt;if(y<.35||(kIn>.4&&y>10.4)||hitTall(x,z)){bd=Math.max(.45,tt-.35);break;}}
  boom+=(bd-boom)*Math.min(1,dt*(bd<boom?25:4));
  camera.position.copy(_sh).addScaledVector(_bk,boom);
}
function updateWalkers(dt,t){
  const W=crowd.walkers,blob=crowd.blobDyn.instanceMatrix.array;
  for(let i=0;i<W.length;i++){const a=W[i],w=a.w,r=a.rec;
    const stop=a.kel&&w.stop>t;
    if(a.kel){const A=stop?AN.serveIdle:AN.serveWalk;if(r[4]!==A[0]){r[4]=A[0];r[5]=A[1];r[7]=stop?24:24*Math.abs(w.v)/STRIDE[2];}}
    if(!stop){w.s+=w.v*dt;if(w.s>w.len){w.s=w.len;w.v=-w.v;}else if(w.s<0){w.s=0;w.v=-w.v;}}
    const wob=Math.sin(t*.27+w.ph)*w.wob;
    let x=w.ax+w.dx*w.s+w.dz*wob,z=w.az+w.dz*w.s-w.dx*wob;
    const ex=x+w.ox-P.x,ez=z+w.oz-P.z,d2=ex*ex+ez*ez;
    if(d2<2.4&&!stop){const d=Math.sqrt(d2)||.01,push=(1.55-d)*dt*5;w.ox+=ex/d*push;w.oz+=ez/d*push;}else{w.ox*=1-dt*.35;w.oz*=1-dt*.35;}
    x+=w.ox;z+=w.oz;const sg=w.v>0?1:-1;r[0]=x;r[2]=z;
    if(stop){const want=Math.atan2(P.x-x,P.z-z);let dd=want-r[3];dd=Math.atan2(Math.sin(dd),Math.cos(dd));r[3]+=dd*Math.min(1,dt*5);}
    else{const want=Math.atan2(w.dx*sg,w.dz*sg);let dd=want-r[3];dd=Math.atan2(Math.sin(dd),Math.cos(dd));r[3]+=Math.abs(dd)>2.5&&!a.kel?dd:dd*Math.min(1,dt*(a.kel?6:30));}
    writeMat(blob,i,x,r[1]+.025,z,0,1);}
  crowd.blobDyn.instanceMatrix.needsUpdate=true;
}
const _m=new THREE.Matrix4(),_v=new V3();
function updateRides(dt,t){
  const a=t*.035;wheel.rotation.z=a;
  for(let i=0;i<32;i++){const th=i/32*Math.PI*2+a;_m.makeTranslation(Math.cos(th)*24,28+Math.sin(th)*24,0);gondolas.setMatrixAt(i,_m);}gondolas.instanceMatrix.needsUpdate=true;
  const cyc=t%44,target=cyc<26?1.05:0;carousel.omega+=(target-carousel.omega)*Math.min(1,dt*.35);carousel.top.rotation.y+=carousel.omega*dt;
  const phi=Math.atan(carousel.omega*carousel.omega*8/9.81);const sp=Math.sin(phi),cp=Math.cos(phi);
  for(let i=0;i<24;i++){const an=i/24*Math.PI*2,cx=Math.cos(an),cz=Math.sin(an);const px=cx*4.8,pz=cz*4.8;_v.set(cx*sp,-cp,cz*sp);
    _q.setFromUnitVectors(UP,_v);_m.compose(_p.set(px+_v.x*3,-.4+_v.y*3,pz+_v.z*3),_q,_s.set(1,1,1));carousel.chains.setMatrixAt(i,_m);
    _m.compose(_p.set(px+_v.x*6,-.4+_v.y*6,pz+_v.z*6),_q.setFromAxisAngle(UP,-an),_s);carousel.seats.setMatrixAt(i,_m);}
  carousel.chains.instanceMatrix.needsUpdate=carousel.seats.instanceMatrix.needsUpdate=true;
  if(((t*3)|0)!==updateRides.k){updateRides.k=(t*3)|0;const c=wheelBulbs.userData.geo.attributes.color;const pal=[[1,.85,.5],[1,.3,.25],[.4,.7,1],[1,1,1]];const sh=updateRides.k%4;for(let i=240;i<c.count;i++){const q=pal[(i+sh)%4];c.setXYZ(i,q[0],q[1],q[2]);}c.needsUpdate=true;}
  for(let i=0;i<flags.length;i++)flags[i].rotation.y=Math.sin(t*1.4+i*1.7)*.22;
}
let kIn=0,lastPlace='';
const tmpCol=new THREE.Color();
function updateEnv(dt,t){
  const inside=P.x>interiorBox.x0&&P.x<interiorBox.x1&&P.z>interiorBox.z0&&P.z<interiorBox.z1&&started;
  kIn+=((inside?1:0)-kIn)*Math.min(1,dt*1.6);
  hemi.intensity=lerp(1.55,.5,kIn);
  tmpCol.copy(FOG_OUT).lerp(FOG_IN,kIn);scene.fog.color.copy(tmpCol);scene.fog.density=lerp(.0032,.011,kIn);
  post.exposure(lerp(1.0,1.3,kIn));
  const near=Math.hypot(P.x-stageW.x,P.z-stageW.z)<80||inside;
  interior.visible=near;crowd.showIn=near;
  for(const L of tentLights)L.intensity=near?lerp(90,170,kIn):0;
  const dDoor=Math.hypot(P.x-doorW.x,P.z-doorW.z);
  const showOut=!(inside&&dDoor>16);
  crowd.showOut=showOut;
  sun.position.set(P.x+SUN_DIR.x*200,SUN_DIR.y*200,P.z+SUN_DIR.z*200);sun.target.position.set(P.x,0,P.z);
  // band and Prosit state for the shader
  const now=t;
  if(started&&now-lastAuto>85)callProsit();
  let sch;if(AC){sch=band.state==='song'?1:0;}else{sch=(now%50)<34?1:0;}
  crowdU.uSchunkel.value+=(sch-crowdU.uSchunkel.value)*Math.min(1,dt*1.2);
  const pr=(now>prositStart&&now<prositEnd)||now<G.cheerUntil?1:0;
  const dr=now>prositEnd-.3&&now<prositEnd+4.6?1:0;crowdU.uDrink.value+=(dr-crowdU.uDrink.value)*Math.min(1,dt*(dr?3:1.4));
  crowdU.uProsit.value+=(pr-crowdU.uProsit.value)*Math.min(1,dt*(pr?3.5:1.6));
  if(AC){const d=Math.hypot(P.x-stageW.x,P.z-stageW.z);const T=AC.currentTime;
    bandGain.gain.setTargetAtTime(inside?.48*clamp(1.25-d/50,.45,1):.2/(1+dDoor/22),T,.25);
    bandLP.frequency.setTargetAtTime(inside?9000:lerp(1400,420,clamp(dDoor/40,0,1)),T,.25);
    verbSend.gain.setTargetAtTime(inside?.45:.12,T,.3);
    murmurGain.gain.setTargetAtTime(inside?.1:.06,T,.4);
    babbleRate=inside?34:16;babbleBus.gain.setTargetAtTime(inside?.75:.45,T,.4);}
  let place='Wirtsbudenstraße';
  if(inside)place='Festhalle Sonnenwirt';
  else{for(const g of gardens)if(P.x>g.x0&&P.x<g.x1&&P.z>g.z0&&P.z<g.z1){place='Biergarten · '+g.t.short;break;}
    if(place==='Wirtsbudenstraße'&&(Math.abs(P.x)>16||Math.abs(P.z)>172))place=P.z>172?'Riesenrad':'Theresienwiese';}
  if(place!==lastPlace){$('#place').textContent=place;$('#district').textContent=DISTRICT[place]||'Wirtsgarten · Theresienwiese';$('#area').classList.remove('off');areaTimer=6;
    if(place==='Festhalle Sonnenwirt'&&lastPlace&&!updateEnv.seenIn){updateEnv.seenIn=true;showHint('Kellnerinnen carry fresh Maß between the tables. Prost with the people around you. Up on the bandstand one Prost gets the whole tent going, if the two Ordner at the stairs let you up.',10);}
    lastPlace=place;}
}
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight,false);post.setSize();});


/* ---------------- the drinking game ----------------
   Prost! takes a sip: a fifth of the Maß, 10 points. Five sips and the glass is empty; you leave it on the floor and look for a
   Kellnerin in the Festhalle. Walk up to her, she stops and hands you a fresh Maß: 50 points. Every sip adds to the Rausch. */
const SIP=.2,SIP_PTS=10,REFILL_PTS=50,WORST=30,KO_SIPS=50;   // 6 Maß: hardly able to walk; 10 Maß: knocked out
const ptsEl=$('#pts'),popsEl=$('#pops');
function popup(text,cls=''){const e=document.createElement('span');e.className='pop '+cls;e.textContent=text;popsEl.appendChild(e);setTimeout(()=>e.remove(),1700);}
function hudGame(){ptsEl.textContent=fmt(G.score);$('#barMass i').style.width=Math.round(G.fill*100)+'%';$('#barMood i').style.width=Math.round(Math.min(1,G.sips/KO_SIPS)*100)+'%';$('#barMood').classList.toggle('danger',G.sips>=40);
  $('#hud').classList.toggle('empty',!G.hasBeer);}
function audioAt(){return AC?Math.max(AC.currentTime,0)+.02:0;}
function clink(t,g=.07){if(!AC)return;for(const[f0,k]of[[R(2250,2450),1],[R(3100,3350),.6],[R(4700,5100),.3]]){const o=AC.createOscillator();o.type='sine';o.frequency.value=f0;
  const e=AC.createGain();e.gain.setValueAtTime(0,t);e.gain.linearRampToValueAtTime(g*k,t+.003);e.gain.exponentialRampToValueAtTime(.0005,t+.35);o.connect(e).connect(master);e.connect(verbSend);o.start(t);o.stop(t+.4);}}
function gulps(t,n=3){if(!AC)return;for(let i=0;i<n;i++){const t0=t+i*.24,o=AC.createOscillator();o.type='sine';o.frequency.setValueAtTime(R(170,200),t0);o.frequency.exponentialRampToValueAtTime(70,t0+.13);
  const e=AC.createGain();e.gain.setValueAtTime(0,t0);e.gain.linearRampToValueAtTime(.16,t0+.015);e.gain.exponentialRampToValueAtTime(.001,t0+.16);o.connect(e).connect(master);o.start(t0);o.stop(t0+.2);}}
function prostShout(t,loud=1){if(!AC)return;choir([{t,d:.42,m:57,c0:'p',v:'o',c1:'st',glide:-4,loud:1.5*loud,gap:1}],t-.04,t+.5,master,4);shout(t+.05,6,.035*loud);}
function thunk(t){if(!AC)return;hit(t,{freq:85,gain:.32,dur:.16});clink(t+.01,.035);clink(t+.13,.02);}

/* the Maß you hold, seen in first person */
scene.add(camera);
const vm=new THREE.Group();vm.scale.setScalar(.85);camera.add(vm);
const glassMat=new THREE.MeshPhongMaterial({color:0xdfe9e4,specular:0xffffff,shininess:90,transparent:true,opacity:.26,depthWrite:false,side:THREE.DoubleSide});
const glassMat2=new THREE.MeshPhongMaterial({color:0xd8e4df,specular:0xffffff,shininess:80,transparent:true,opacity:.55,depthWrite:false});
const beerMat=new THREE.MeshLambertMaterial({color:0xd27a10,emissive:0x3a1800});
const foamMat=new THREE.MeshLambertMaterial({color:0xf7f1e4,emissive:0x2a2620});
const vmBeer=new THREE.Mesh(new THREE.CylinderGeometry(.05,.048,1,20).translate(0,.5,0),beerMat);
const vmFoam=new THREE.Mesh(new THREE.CylinderGeometry(.051,.05,.026,20),foamMat);
const vmHandle=new THREE.Mesh(new THREE.TorusGeometry(.052,.011,8,18,Math.PI).rotateZ(-Math.PI/2).translate(.056,.115,0),glassMat2);
vm.add(new THREE.Mesh(new THREE.CylinderGeometry(.058,.055,.215,22,1,true).translate(0,.1075,0),glassMat),new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.022,22).translate(0,.011,0),glassMat2),vmBeer,vmFoam,vmHandle);
vmBeer.position.y=.022;vm.rotation.order='YXZ';
function updateViewModel(t,v){
  vm.visible=firstPerson&&started&&G.hasBeer;if(!vm.visible)return;
  const h=.172*G.fill;vmBeer.scale.y=Math.max(.001,h);vmBeer.visible=G.fill>.005;vmFoam.position.y=.022+h+.012;vmFoam.visible=G.fill>.005;
  const st=t-G.sipT,kc=st<2.5?Math.min(1,st/.35):0,ec=kc*kc*(3-2*kc),kd=st<2.5?(st<.95?0:st<1.3?(st-.95)/.35:st<2.1?1:Math.max(0,1-(st-2.1)/.4)):0,e=kd*kd*(3-2*kd);
  const wob=Math.sin(P.bob*2)*.012*Math.min(1,v/3),dk=G.drunk;
  const ce=ec*(1-e);
  vm.position.set(lerp(lerp(.27,.12,ce),.035,e)+dk*.02*Math.sin(t*.9),lerp(lerp(-.33,-.08,ce),-.16,e)+wob+dk*.015*Math.sin(t*1.3),lerp(lerp(-.55,-.62,ce),-.2,e));
  vm.rotation.set(lerp(lerp(0,-.12,ce),1.15,e),lerp(lerp(-.35,-.2,ce),-.1,e),lerp(-.05,.1,e)+G.roll*.4);
}

/* empty glasses stay where you leave them */
const emptyGeo=(()=>{const a=new THREE.CylinderGeometry(.058,.055,.215,12,1,false),b=new THREE.TorusGeometry(.05,.011,6,10,Math.PI).rotateZ(-Math.PI/2).translate(.056,.0,0);
  a.translate(0,0,0);const g=new THREE.BufferGeometry(),pos=[],nor=[];
  for(const x of[a.toNonIndexed(),b.toNonIndexed()]){pos.push(...x.attributes.position.array);nor.push(...x.attributes.normal.array);}
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));return g;})();
const empties=new THREE.InstancedMesh(emptyGeo,new THREE.MeshPhongMaterial({color:0xe2ece8,specular:0xffffff,shininess:70,transparent:true,opacity:.6,depthWrite:false}),60);
empties.count=0;empties.frustumCulled=false;scene.add(empties);let emptyN=0;
function dropGlass(){const a=heading+R(-.6,.6),x=P.x+Math.sin(heading)*.35+Math.cos(heading)*.25,z=P.z+Math.cos(heading)*.35-Math.sin(heading)*.25;
  const y=kIn>.5?0:0;_m.compose(_p.set(x,y+.058,z),_q.setFromEuler(new THREE.Euler(0,a,Math.PI/2,'YXZ')),_s.set(1,1,1));
  empties.setMatrixAt(emptyN%60,_m);emptyN++;empties.count=Math.min(60,emptyN);empties.instanceMatrix.needsUpdate=true;}

const PROST_R=3,PROST_PAUSE=40,PROST_EACH=10;
function prost(){
  if(!started||paused||G.ko||G.over||t_stun())return;const now=performance.now()/1000;
  if(onStage()){stageProst(now);return;}
  if(!G.hasBeer){showHint('Your Maß is empty. Find a Kellnerin in the Festhalle Sonnenwirt for a fresh one.',5);popup('Leer!','small');return;}
  if(now-G.sipT<2.7)return;
  G.sipT=now;G.sipDone=false;
  // everyone within 3 m with a Maß who has not just clinked with you raises theirs
  let n=0,tired=0;
  for(const a of crowd.agents){if(a===player||a.kel||a.guard||a.w)continue;const r=a.rec;
    if(r[10]<0||r[9]%2<1)continue;const dx=r[0]-P.x,dz=r[2]-P.z,dy=r[1]-(P.y||0);if(dx*dx+dz*dz>PROST_R*PROST_R||Math.abs(dy)>1.2)continue;
    if(now-(a.prostT||-99)<PROST_PAUSE){tired++;continue;}
    a.prostT=now;r[28]=now+R(.05,.35);n++;}
  G.partners=n;G.tired=tired;
  const t=audioAt();if(AC){clink(t);if(n)for(let i=0;i<Math.min(n,5);i++)clink(t+.06+i*.05+R(0,.03),.05);prostShout(t+.06,n?Math.min(1.6,.6+n*.15):.5);gulps(t+1.4,3);}
}
function tickGame(t){
  if(!G.sipDone&&t-G.sipT>1.65){G.sipDone=true;G.fill=Math.max(0,G.fill-SIP);if(G.fill<.02)G.fill=0;const pts=SIP_PTS+PROST_EACH*G.partners;G.score+=pts;G.sips++;G.drunk=Math.min(1,G.sips/WORST);
    popup('+'+pts+(G.partners?` Prost ×${G.partners}`:''),G.partners>=4?'big':'');
    if(!G.partners&&G.tired)showHint('They just clinked with you. Give them a little while, or find new people to prost with.',4);
    hudGame();
    if(G.sips>=KO_SIPS){knockOut(t+.45);return;}
    if(G.fill===0)G.emptyAt=t+.75;
    const m=G.sips/5;if(m===6&&G.warned<6){G.warned=6;showHint('Sechs Maß. The Wiesn is spinning: you can hardly walk straight.',6);}
    else if(m===8&&G.warned<8){G.warned=8;showHint('Acht Maß. Two more and you are out cold.',6);}
    else if(m===9&&G.warned<9){G.warned=9;showHint('Neun Maß! One more Maß and you go down.',6);}}
  if(G.emptyAt&&t>G.emptyAt){G.emptyAt=0;G.hasBeer=false;player.rec[9]=player.rec[9]-(player.rec[9]%2);dropGlass();thunk(audioAt());
    showHint(isTouch?'Ausgetrunken! Leave the glass and find a Kellnerin in the Festhalle Sonnenwirt: she carries fresh Maß.':'Ausgetrunken! Find a Kellnerin in the Festhalle Sonnenwirt: walk up to her for a fresh Maß.',9);hudGame();}
  if(G.ko)return;
  if(!G.hasBeer&&!G.emptyAt){let best=null,bd=9;
    for(const k of crowd.kellner){const dx=k.rec[0]-P.x,dz=k.rec[2]-P.z,d2=dx*dx+dz*dz;if(d2<bd){bd=d2;best=k;}}
    if(best){if(bd<2.8*2.8)best.w.stop=Math.max(best.w.stop||0,t+2.6);
      if(bd<1.55*1.55&&t-G.refillAt>2){G.refillAt=t;G.hasBeer=true;G.fill=1;G.score+=REFILL_PTS;player.rec[9]=player.rec[9]-(player.rec[9]%2)+1;best.w.stop=t+1.4;
        popup('+'+REFILL_PTS+' Frische Maß!','big');const a=audioAt();clink(a,.09);clink(a+.14,.06);if(AC)prostShout(a+.35,.7);showHint('Frische Maß! Prost!',3);hudGame();}}}
  player.rec[27]=G.fill;
}

/* ten Maß: knocked out, flat on your back, Game Over */
const P0={x:P.x,z:P.z,yaw:P.yaw,pitch:P.pitch};
const goEl=$('#gameover'),_c0=new V3(),_c1=new V3();
function knockOut(at){
  G.ko=at;G.koShown=false;G.hasBeer=false;G.fill=0;G.emptyAt=0;
  const pr=player.rec;pr[9]=pr[9]-(pr[9]%2);pr[10]=-1;
  heading=P.yaw+Math.PI;pr[3]=heading;P.vx=P.vz=0;
  for(const k in keys)keys[k]=false;stickZone.hidden=true;
  setTimeout(()=>{dropGlass();thunk(audioAt());},500);
  setTimeout(()=>{const t=audioAt();if(AC){hit(t,{freq:60,gain:.5,dur:.3});prostShout(t+.5,.6);}},1150);
  showHint('Zehn Maß. Gute Nacht!',4);
}
function koUpdate(dt){
  const t=performance.now()/1000,st=t-G.ko,pr=player.rec;
  if(st<0){pr[4]=AN.idle[0];pr[5]=AN.idle[1];pr[7]=24;}
  else if(st<2){pr[4]=AN.ko[0];pr[5]=AN.ko[1];pr[6]=-G.ko*24;pr[7]=24;}
  else{pr[4]=AN.ko[0];pr[5]=AN.ko[1];pr[6]=AN.ko[1]-1;pr[7]=0;}
  pr[0]=P.x;pr[2]=P.z;pr[27]=0;
  // body lies along the ground behind where it stood; the head ends up ~1.6 m back
  const fx=Math.sin(heading),fz=Math.cos(heading);
  const e=st<.35?0:Math.min(1,((st-.35)/.55)**2);
  if(firstPerson&&st<1.7){
    camera.position.set(P.x-fx*1.55*e,lerp(1.68,.2,e),P.z-fz*1.55*e);
    camera.rotation.set(lerp(P.pitch,1.25,e),P.yaw,lerp(G.roll,.5,e));
  }else{
    // then rise slowly above the body and look down on it
    const k=Math.min(1,Math.max(0,(st-(firstPerson?1.7:.6))/2.2)),kk=k*k*(3-2*k),a=st*.12;
    _c0.set(P.x-fx*.85,.25,P.z-fz*.85);
    _c1.set(_c0.x+Math.sin(heading+.9+a)*2.2,3.3,_c0.z+Math.cos(heading+.9+a)*2.2);
    if(!G.koCam){G.koCam=camera.position.clone();}
    camera.position.lerpVectors(G.koCam,_c1,kk);
    camera.lookAt(_c0);
  }
  if(st>3.2&&!G.koShown){G.koShown=true;gameOver();}
}
function gameOver(kind){
  G.over=true;paused=false;startEl.hidden=true;
  $('#goPts').textContent=fmt(G.score);
  if(kind==='caught'){$('#goTtl').textContent='Geschnappt!';$('#goEye').textContent='Drei Mal erwischt · Game Over';
    $('#goText').textContent='The Ordner caught you on their stairs three times and walked you out of the Festhalle.';}
  else{$('#goTtl').textContent='K.o.!';$('#goEye').textContent='Zehn Maß · Game Over';
    $('#goText').textContent=`${Math.floor(G.sips/5)} Maß, ${G.sips} sips and you are flat on your back on the Wiesn.`;}
  document.body.classList.remove('playing');goEl.hidden=false;hud.classList.add('ko');$('#again').focus();
  if(document.pointerLockElement)document.exitPointerLock();
}
function restart(){
  Object.assign(G,{score:0,fill:1,hasBeer:true,sips:0,drunk:0,sipT:-9,sipDone:true,emptyAt:0,refillAt:-9,cheerUntil:-9,roll:0,ko:0,koShown:false,koCam:null,warned:0,partners:0,tired:0,strikes:0,stun:0,stageT:-999,escort:0,seen:0,over:false,strikeT:[],esc:null,take:null,stageEsc:0});
  for(const g of guards){const p=bandI.grp.localToWorld(new V3(g.post[0],0,g.post[1]));g.rec[0]=p.x;g.rec[1]=0;g.rec[2]=p.z;g.rec[3]=bandI.rot;guardAnim(g,AN.guard,24);}
  for(const a of crowd.agents){a.prostT=-99;a.rec[28]=-99;}P.y=0;$('#hud').classList.remove('spotted');
  G.st={t:-9,side:1,amp:0,fwd:0};
  Object.assign(P,{x:P0.x,z:P0.z,yaw:P0.yaw,pitch:P0.pitch,vx:0,vz:0});heading=P.yaw+Math.PI;
  const pr=player.rec;pr[9]=pr[9]-(pr[9]%2)+1;pr[10]=AN.pstand;pr[4]=AN.idle[0];pr[5]=AN.idle[1];pr[6]=0;pr[7]=24;pr[27]=1;
  emptyN=0;empties.count=0;FG.on=false;flyMesh.visible=false;goEl.hidden=true;hud.classList.remove('ko');
  document.body.classList.add('playing');if(isTouch)stickZone.hidden=false;
  showHint('A fresh start and a full Maß. Prost!',4);hudGame();
  if(!isTouch)tryLock();
}
$('#again').addEventListener('click',e=>{e.stopPropagation();restart();});

/* ---------------- the bandstand: stairs, two Ordner and the Prosit for the whole tent ----------------
   Sneak up the stairs while the Ordner look away; from up there one Prost sets off Ein Prosit for the whole tent.
   Seen on the way up: they stop you and send you back. The third time you are geschnappt: game over. */
const _bl=new V3();
function toBand(x,z){_bl.set(x,0,z).applyMatrix4(bandI.inv);return _bl;}
const STAIR={w:.72,top:1.4,z0:4.45,len:3.0};
function inStairs(x,z){if(!bandI)return false;const L=toBand(x,z);return Math.abs(L.x)<STAIR.w&&L.z>bandI.SZ+STAIR.z0-.3&&L.z<bandI.SZ+STAIR.z0+STAIR.len;}
function onStage(){if(!bandI||(P.y||0)<1.2)return false;const L=toBand(P.x,P.z);return Math.hypot(L.x,L.z-bandI.SZ)<4.5;}
function bandFloor(px0,pz0,dt){
  if(!bandI){P.y=0;return;}
  const L=toBand(P.x,P.z),SZ=bandI.SZ,rr=Math.hypot(L.x,L.z-SZ);
  const stairs=Math.abs(L.x)<STAIR.w&&L.z>SZ+STAIR.z0-.3&&L.z<SZ+STAIR.z0+STAIR.len,plat=rr<4.4;
  const y0=P.y||0;
  if(y0>.25&&!stairs&&!plat){P.x=px0;P.z=pz0;P.vx*=.3;P.vz*=.3;return;}   // the railing keeps you up there
  let h=0;
  if(stairs)h=STAIR.top*clamp((SZ+STAIR.z0+STAIR.len-L.z)/STAIR.len,0,1);
  else if(plat&&y0>.9)h=STAIR.top;
  P.y=y0+(h-y0)*Math.min(1,dt*14);
}
function t_stun(){return performance.now()/1000<G.stun;}
const GUARD_LINES=[['Halt! Da rauf derfst du ned!','Stop! You are not allowed up there.'],['Du scho wieda? Schleich di!','You again? Get lost!'],['Jetzt langt\'s! Du bist gschnappt!','That is it. You are caught!']];
function say(de,en){const sub=$('#subtitle');sub.innerHTML=`<b>„${de}“</b><span>${en}</span>`;sub.hidden=false;clearTimeout(say.t);say.t=setTimeout(()=>sub.hidden=true,3200);
  try{if(window.speechSynthesis&&audioOn()){const u=new SpeechSynthesisUtterance(de);u.lang='de-DE';u.rate=.86;u.pitch=.42;u.volume=1;
    const v=guardVoice();if(v)u.voice=v;speechSynthesis.cancel();speechSynthesis.speak(u);}}catch(e){}}
// an older man's voice: prefer a male German voice the system has (they differ per browser and OS), pitched down
const MALE_DE=/(conrad|killian|stefan|markus|yannick|florian|bernd|hans|klaus|jonas|ralf|male|männ|mann)/i,FEMALE_DE=/(katja|hedda|anna|petra|helena|amala|seraphina|marlene|vicki|female|frau|google deutsch)/i;
let _gv=null;
function guardVoice(){if(_gv)return _gv;const vs=speechSynthesis.getVoices().filter(v=>/^de/i.test(v.lang));
  _gv=vs.find(v=>MALE_DE.test(v.name)&&/natural|online/i.test(v.name))||vs.find(v=>MALE_DE.test(v.name))||vs.find(v=>!FEMALE_DE.test(v.name))||vs[0]||null;return _gv;}
try{speechSynthesis.getVoices();speechSynthesis.addEventListener('voiceschanged',()=>{_gv=null;});}catch(e){}
function audioOn(){return !!AC&&AC.state==='running';}
const guardCyc={phase:'front',until:0};
function tickGuards(dt,t){
  if(!bandI||!guards.length)return;
  if(G.esc){escortGuards(dt,t);$('#hud').classList.remove('spotted');return;}
  if(G.take){$('#hud').classList.remove('spotted');return;}
  if(t>guardCyc.until){guardCyc.phase=guardCyc.phase==='front'?'away':'front';guardCyc.start=t;guardCyc.until=t+(guardCyc.phase==='front'?R(3,5.2):R(2.2,3.1));
    for(const g of guards)g.lag=R(0,.5);}
  const L=toBand(P.x,P.z),SZ=bandI.SZ;
  // the gap between the two Ordner, and the few metres in front of it
  const gap=Math.abs(L.x)<2.3&&L.z>SZ+7.2&&L.z<SZ+8.8,front=Math.abs(L.x)<2.6&&L.z>=SZ+8.8&&L.z<SZ+10.6;
  let seen=false;
  for(const g of guards){const r=g.rec;
    const away=guardCyc.phase==='away'&&t-guardCyc.start>g.lag&&guardCyc.until-t>g.lag*.5;
    // front: watch the way to the stairs, sweeping; away: look out over the tables to the side
    const want=bandI.rot+(away?g.sx*1.95+.25*Math.sin(t*.7+g.sx):.5*Math.sin(t*.55+g.sx*1.3));
    let dd=want-r[3];dd=Math.atan2(Math.sin(dd),Math.cos(dd));r[3]+=dd*Math.min(1,dt*3.2);
    g.away=away;
    const dx=P.x-r[0],dz=P.z-r[2],d=Math.hypot(dx,dz);
    if(d<9){const ang=Math.abs(Math.atan2(Math.sin(Math.atan2(dx,dz)-r[3]),Math.cos(Math.atan2(dx,dz)-r[3])));if(ang<.95||d<.9)seen=true;}
  }
  if(G.ko||G.over){G.seen=0;return;}
  // walking up to the gap while they watch, or slipping through it while either of them is not looking away
  const watched=front&&seen,through=gap&&guards.some(g=>!g.away);
  G.seen=through?G.seen+dt*3:watched?G.seen+dt:Math.max(0,G.seen-dt*2);
  $('#hud').classList.toggle('spotted',watched||through);
  if(G.seen>.3&&!t_stun()&&!onStage()&&!G.stageEsc)caught(t);
}
function caught(t){
  // the Ordner forget you after a minute
  G.strikeT=G.strikeT.filter(x=>t-x<60);G.strikeT.push(t);G.strikes=G.strikeT.length;
  G.seen=0;const i=Math.min(2,G.strikes-1);say(...GUARD_LINES[i]);
  const a=audioAt();if(AC){hit(a,{freq:110,gain:.25,dur:.12});}
  if(G.strikes>=3){takedown(t);return;}
  // escorted a few metres back towards the door
  const p=bandI.grp.localToWorld(new V3(R(-1.5,1.5),0,bandI.SZ+11.2));P.x=p.x;P.z=p.z;P.y=0;P.vx=P.vz=0;G.stun=t+1.4;
  popup(G.strikes===1?'Erwischt! 1/3':'Erwischt! 2/3','small');
  showHint(G.strikes===1?'The Ordner turn away now and then. Sneak past them while they look out over the tables. They forget you after a minute.':'Careful: one more time within the minute and you are geschnappt.',5);
}
function stageProst(now){
  if(!G.hasBeer){showHint('Up on the bandstand, but your Maß is empty. Get a fresh one first.',4);return;}
  if(now-G.sipT<2.7)return;
  if(now-G.stageT<75||now<prositEnd+2){showHint('The band needs a breather. Try again in a little while.',4);return;}
  G.stageT=now;G.sipT=now;G.sipDone=false;G.partners=0;
  let guests=0;for(const a of crowd.agents)if(a.g===1&&!a.guard&&a.rec[10]>=0)guests++;
  const pts=500+Math.round(guests/2);G.score+=pts;popup('+'+pts+' Ganzes Zelt!','big');hudGame();
  callProsit();const t=audioAt();if(AC){clink(t,.1);prostShout(t+.1,1.8);}
  say('Ein Prosit! Ein Prosit der Gemütlichkeit!','The whole tent raises its Maß with you.');
  G.stageEsc=now+2.7;   // you finish your sip up there, then the Ordner come for you
}
function tickStage(t){if(G.stageEsc&&t>G.stageEsc&&!G.esc){G.stageEsc=0;startEscort(t);}}

/* ---- moving the Ordner (and you) along paths in the tent's own coordinates */
function hLocal(x,z){const SZ=bandI.SZ;if(Math.abs(x)<STAIR.w+.1&&z>SZ+STAIR.z0-.3&&z<SZ+STAIR.z0+STAIR.len)return STAIR.top*clamp((SZ+STAIR.z0+STAIR.len-z)/STAIR.len,0,1);
  return Math.hypot(x,z-SZ)<4.6?STAIR.top:0;}
function pathLen(pts){let L=0;for(let i=1;i<pts.length;i++)L+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);return L;}
function along(pts,u){const L=pathLen(pts)*clamp(u,0,1);let acc=0;
  for(let i=1;i<pts.length;i++){const dx=pts[i][0]-pts[i-1][0],dz=pts[i][1]-pts[i-1][1],l=Math.hypot(dx,dz);
    if(acc+l>=L||i===pts.length-1){const k=l?clamp((L-acc)/l,0,1):1;return[pts[i-1][0]+dx*k,pts[i-1][1]+dz*k,dx/(l||1),dz/(l||1)];}acc+=l;}
  return[pts[0][0],pts[0][1],0,1];}
const _wv=new V3();
function toWorld(x,z){return _wv.set(x,0,z).applyMatrix4(bandI.grp.matrixWorld);}
function guardAnim(g,A,rate,off){const r=g.rec;if(r[4]!==A[0]||rate!==r[7]){r[4]=A[0];r[5]=A[1];r[7]=rate;if(off!==undefined)r[6]=off;}}
function placeOnPath(g,pts,u,speed){const[x,z,dx,dz]=along(pts,u),w=toWorld(x,z),r=g.rec;r[0]=w.x;r[2]=w.z;r[1]=hLocal(x,z);
  if(speed>.05){const want=Math.atan2(dx,dz)+bandI.rot;let dd=want-r[3];dd=Math.atan2(Math.sin(dd),Math.cos(dd));r[3]+=dd*.35;guardAnim(g,AN.walk,Math.round(24*speed/STRIDE[0]));}}
function startEscort(t){
  const L=toBand(P.x,P.z),SZ=bandI.SZ;G.stun=t+99;P.vx=P.vz=0;
  G.esc={phase:'rush',t0:t,L:[L.x,L.z]};
  for(const g of guards){const sx=g.sx;g.path=[[g.post[0],g.post[1]],[sx*.42,SZ+STAIR.z0+STAIR.len+.2],[sx*.42,SZ+STAIR.z0-.1],[L.x+sx*.55,L.z+.3]];}
  say('Ja spinnst du? Runter da, aber zackig!','Are you mad? Down from there, right now!');
}
function escortPlayer(dt,t){
  const e=G.esc;if(e.phase!=='lead'){P.vx=P.vz=0;return;}
  const u=clamp((t-e.t1)/e.dur,0,1),[x,z,dx,dz]=along(e.path,u),w=toWorld(x,z);
  const wx=w.x,wz=w.z;P.vx=(wx-P.x)/Math.max(dt,1e-3);P.vz=(wz-P.z)/Math.max(dt,1e-3);P.x=wx;P.z=wz;P.y=hLocal(x,z);
  const fy=Math.atan2(-dx,-dz)-bandI.rot*0+0;const dirW=toWorld(x+dx,z+dz);const yawW=Math.atan2(-(dirW.x-wx),-(dirW.z-wz));
  let dd=yawW-P.yaw;dd=Math.atan2(Math.sin(dd),Math.cos(dd));P.yaw+=dd*Math.min(1,dt*4);P.pitch*=1-Math.min(1,dt*3);
}
function escortGuards(dt,t){
  const e=G.esc,SZ=bandI.SZ;
  if(e.phase==='rush'){const u=clamp((t-e.t0)/2.2,0,1),uu=u*u*(3-2*u);
    for(const g of guards)placeOnPath(g,g.path,uu,u<1?pathLen(g.path)/2.2*1.2:0);
    if(u>=1){const L=e.L;e.phase='lead';e.t1=t+.5;e.path=[[L[0],L[1]],[0,SZ+STAIR.z0-.1],[0,SZ+STAIR.z0+STAIR.len+.2],[0,SZ+11.3]];e.dur=pathLen(e.path)/1.45;
      for(const g of guards){g.path=e.path.map((p,i)=>[p[0]+g.sx*(i===0?.55:.48),p[1]+(i===0?.3:0)]);guardAnim(g,AN.guard,24);}}
    return;}
  if(e.phase==='lead'){const u=clamp((t-e.t1)/e.dur,0,1);
    for(const g of guards)placeOnPath(g,g.path,u,t>e.t1&&u<1?1.45:0);
    if(u>=1){e.phase='back';e.t2=t;G.stun=0;for(const g of guards){const r=g.rec;g.path=[[toBand(r[0],r[2]).x,toBand(r[0],r[2]).z],[g.post[0],g.post[1]]];}
      say('So. Und jetzt schleich di.','There. Now off you go.');showHint('The Ordner walked you back down. The band needs a while before the next one anyway.',5);}
    return;}
  if(e.phase==='back'){const u=clamp((t-e.t2)/2.4,0,1);
    for(const g of guards)placeOnPath(g,g.path,u,u<1?pathLen(g.path)/2.4:0);
    if(u>=1){for(const g of guards){guardAnim(g,AN.guard,24);g.rec[1]=0;}G.esc=null;}}
}

/* ---- the third time: taken down, hands behind your back, the Maß skids away. Geschnappt. */
const PW=TR.chars.Bursch.proneWrist||[0,.41,1.19];
function takedown(t){
  G.take={t0:t,cam:null};G.stun=t+99;P.vx=P.vz=0;for(const k in keys)keys[k]=false;stickZone.hidden=true;
  heading=Math.atan2(-Math.sin(P.yaw),-Math.cos(P.yaw));const pr=player.rec;pr[3]=heading;pr[10]=-1;
  // the nearest Ordner takes you down, the other stays at the stairs
  let g0=guards[0];for(const g of guards)if(Math.hypot(g.rec[0]-P.x,g.rec[2]-P.z)<Math.hypot(g0.rec[0]-P.x,g0.rec[2]-P.z))g0=g;
  const fx=Math.sin(heading),fz=Math.cos(heading),wx=P.x+fx*PW[2]+Math.cos(heading)*PW[0],wz=P.z+fz*PW[2]-Math.sin(heading)*PW[0];
  const side=((g0.rec[0]-P.x)*Math.cos(heading)-(g0.rec[2]-P.z)*Math.sin(heading))>0?1:-1;
  const gry=heading-side*Math.PI/2,gx=wx-Math.sin(gry)*.5,gz=wz-Math.cos(gry)*.5;
  G.take.g=g0;G.take.from=[g0.rec[0],g0.rec[2]];G.take.to=[gx,gz,gry];G.take.hand=[P.x+Math.cos(heading)*-.32+fx*.2,P.z-Math.sin(heading)*-.32+fz*.2];
  if(document.pointerLockElement)document.exitPointerLock();
}
function takeUpdate(dt){
  const T=G.take,t=performance.now()/1000,st=t-T.t0,pr=player.rec,g=T.g,r=g.rec;
  // the Ordner rushes over, then you go down and he kneels on you
  if(st<.55){const u=st/.55;r[0]=lerp(T.from[0],T.to[0],u);r[2]=lerp(T.from[1],T.to[1],u);r[1]=0;r[3]=Math.atan2(T.to[0]-T.from[0],T.to[1]-T.from[1]);guardAnim(g,AN.walk,40);
    pr[4]=AN.idle[0];pr[5]=AN.idle[1];pr[7]=24;}
  else{r[0]=T.to[0];r[2]=T.to[1];r[1]=0;r[3]=T.to[2];
    if(!T.down){T.down=t;pr[9]=pr[9]-(pr[9]%2);G.hasBeer=false;launchGlass(T.hand[0],T.hand[1]);const a=audioAt();if(AC){hit(a,{freq:70,gain:.45,dur:.25});}}
    const k=t-T.down;
    if(k<2){pr[4]=AN.prone[0];pr[5]=AN.prone[1];pr[6]=-T.down*24;pr[7]=24;r[4]=AN.pin[0];r[5]=AN.pin[1];r[6]=-T.down*24;r[7]=24;}
    else{pr[4]=AN.prone[0];pr[5]=AN.prone[1];pr[6]=AN.prone[1]-1;pr[7]=0;r[4]=AN.pin[0];r[5]=AN.pin[1];r[6]=AN.pin[1]-1-(Math.floor(t*2)%2);r[7]=0;}}
  pr[0]=P.x;pr[2]=P.z;pr[1]=0;
  // camera: pull back and look down on the two of them
  const cx=(P.x+T.to[0])/2+Math.sin(heading)*.5,cz=(P.z+T.to[1])/2+Math.cos(heading)*.5;
  if(!T.cam)T.cam=camera.position.clone();
  const k=clamp((st-.2)/1.8,0,1),kk=k*k*(3-2*k),a=heading+2.2+st*.08;
  _c1.set(cx+Math.sin(a)*2.6,2.9,cz+Math.cos(a)*2.6);_c0.set(cx,.3,cz);
  camera.position.lerpVectors(T.cam,_c1,kk);camera.lookAt(_c0);
  if(st>3.6&&!G.over){gameOver('caught');}
}
/* a Maß flying out of your hand, skidding and spinning across the floor */
const flyMesh=new THREE.Mesh(emptyGeo,new THREE.MeshPhongMaterial({color:0xe2ece8,specular:0xffffff,shininess:70,transparent:true,opacity:.65,depthWrite:false}));
flyMesh.visible=false;flyMesh.rotation.order='YXZ';scene.add(flyMesh);
const FG={on:false};
function launchGlass(x,z){const a=R(0,Math.PI*2),sp=R(2.6,3.6);Object.assign(FG,{on:true,x,y:1.0,z,vx:Math.sin(a)*sp,vy:1.6,vz:Math.cos(a)*sp,yaw:R(0,6),spin:R(9,14)*(Math.random()<.5?-1:1),tumble:0,landed:false});flyMesh.visible=true;}
function updateFlyGlass(dt){
  if(!FG.on)return;
  if(!FG.landed){FG.vy-=9.8*dt;FG.tumble+=dt*11;}
  FG.x+=FG.vx*dt;FG.y+=FG.vy*dt;FG.z+=FG.vz*dt;FG.yaw+=FG.spin*dt;
  if(FG.y<.058){FG.y=.058;if(!FG.landed){FG.landed=true;const a=audioAt();if(AC){clink(a,.09);clink(a+.07,.06);hit(a,{freq:160,gain:.12,dur:.08});}}FG.vy=0;}
  if(FG.landed){const f=Math.exp(-dt*1.4);FG.vx*=f;FG.vz*=f;FG.spin*=Math.exp(-dt*1.1);
    flyMesh.rotation.set(0,FG.yaw,Math.PI/2);
    if(Math.hypot(FG.vx,FG.vz)<.04&&Math.abs(FG.spin)<.3){FG.on=false;flyMesh.visible=false;
      _m.compose(_p.set(FG.x,.058,FG.z),_q.setFromEuler(new THREE.Euler(0,FG.yaw,Math.PI/2,'YXZ')),_s.set(1,1,1));empties.setMatrixAt(emptyN%60,_m);emptyN++;empties.count=Math.min(60,emptyN);empties.instanceMatrix.needsUpdate=true;}}
  else flyMesh.rotation.set(FG.tumble,FG.yaw,0);
  flyMesh.position.set(FG.x,FG.y,FG.z);
}
/* ---------------- loop ---------------- */
let last=performance.now(),fpsN=0,fpsT=0,fps=0;
const statsEl=$('#stats');
function frame(nowMs){
  requestAnimationFrame(frame);
  const dt=Math.min(.05,(nowMs-last)/1000);last=nowMs;const t=nowMs/1000;
  crowdU.uTime.value=t;
  if(started&&!paused)updatePlayer(dt);
  else if(!started){const z=-96+Math.sin(t*.06)*40;camera.position.set(5.5,3.4,z);camera.lookAt(-8,2.4,z+30);}
  updateEnv(dt,t);updateWalkers(paused&&started?0:dt,t);updateRides(dt,t);audioTick();
  if(started&&!paused){tickGame(t);tickGuards(dt,t);tickStage(t);}
  updateFlyGlass(Math.min(dt,.05));updateViewModel(t,Math.hypot(P.vx,P.vz));post.drunk(G.drunk,t);
  sky.position.copy(camera.position);
  crowdCull();
  post.render();
  if(hintTimer>0){hintTimer-=dt;if(hintTimer<=0)hint.classList.add('off');}
  if(areaTimer>0){areaTimer-=dt;if(areaTimer<=0)$('#area').classList.add('off');}
  if(started)drawRadar();
  fpsN++;fpsT+=dt;if(fpsT>.5){fps=fpsN/fpsT;fpsN=0;fpsT=0;const ri={triangles:post.info.tris,calls:post.info.calls};
    const vis=crowd.drawn;
    
    statsEl.textContent=`${fmt(vis)} of ${fmt(crowd.total)} guests drawn · ${(ri.triangles/1e6).toFixed(2)} M tris · ${ri.calls} draws · ${fps.toFixed(0)} fps`;}
}
requestAnimationFrame(frame);
go.disabled=false;go.textContent='Start walking';
if(/[?&]debug\b/.test(location.search))window.__ww={G,P,crowd:()=>crowd,player:()=>player,AN,prost,toggleView,TR,vm,lastT:()=>last,band:()=>bandI,guards,guardCyc,toBand,onStage,keys,updatePlayer,tickGuards,tickGame,tickStage,updateWalkers,updateFlyGlass,FG};

})();
