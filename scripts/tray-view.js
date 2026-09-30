import {createTrayModel} from './tray-model.js';

export const octagonPoints=radius=>Array.from({length:8},(_,i)=>{
  const angle=Math.PI/8+i*Math.PI/4;return [Math.cos(angle)*radius,Math.sin(angle)*radius];
});
const right=r=>r.left+r.width,bottom=r=>r.top+r.height;
const overlaps=(a,b)=>a.left<right(b)&&right(a)>b.left&&a.top<bottom(b)&&bottom(a)>b.top;
export function dockRect(viewport,width,reservedRects=[],height=width) {
  width=Math.min(width,viewport.width-32,viewport.height-32);
  const result={left:right(viewport)-width-16,top:bottom(viewport)-height-16,width,height};
  for(let pass=0;pass<reservedRects.length+1;pass++) {
    let changed=false;
    for(const r of reservedRects) if(r.width>0&&r.height>0&&overlaps(result,r)) {
      if(r.height>=r.width&&r.left-width-16>=viewport.left+16) result.left=r.left-width-16;
      else result.top=Math.max(viewport.top+16,r.top-height-16);
      changed=true;
    }
    if(!changed) break;
  }
  return result;
}
export function previewPositions(count,seed=0) {
  if(!count) return [];
  let state=2166136261;
  for(const char of String(seed)) state=Math.imul(state^char.charCodeAt(0),16777619)>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  for(let grid=Math.ceil(Math.sqrt(count));;grid++) {
    const spacing=1.3/grid,positions=[];
    for(let row=0;row<grid;row++) for(let col=0;col<grid;col++) {
      const x=(col-(grid-1)/2)*spacing+(random()-.5)*spacing*.08,
        z=(row-(grid-1)/2)*spacing+(random()-.5)*spacing*.08,size=Math.min(.14,spacing*.32);
      if(Math.hypot(x,z)+Math.SQRT2*size<.81) positions.push({x,z,size,yaw:random()*Math.PI*2});
    }
    if(positions.length>=count) {
      for(let i=positions.length-1;i>0;i--) {const j=Math.floor(random()*(i+1));[positions[i],positions[j]]=[positions[j],positions[i]];}
      return positions.slice(0,count);
    }
  }
}
export function releasePreview(parent,preview) {parent?.remove(preview);}

function hull(points) {
  const sorted=points.toSorted((a,b)=>a.x-b.x||a.y-b.y);
  const turn=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const half=list=>{const result=[];for(const point of list) {
    while(result.length>1&&turn(result.at(-2),result.at(-1),point)<=0) result.pop();
    result.push(point);
  }return result.slice(0,-1);};
  return [...half(sorted),...half(sorted.toReversed())];
}
const bounds=points=>({left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),
  top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))});

/** The desktop camera draws the tray and borrowed dice into one cached texture. */
export function createTrayView({adapter,THREE,woodTexture=null,document=globalThis.document,
  getReservedRects=()=>['#sidebar','#ui-right','#hotbar'].flatMap(selector=>{
    const e=document.querySelector(selector);return e&&e.getClientRects().length?[e.getBoundingClientRect()]:[];
  })}) {
  const {Group,Scene,PerspectiveCamera,HemisphereLight,DirectionalLight,WebGLRenderTarget,
    PlaneGeometry,MeshBasicMaterial,Mesh,Box3,Vector3,Vector2,Vector4,Color,Raycaster,Plane}=THREE;
  const {group:tray,previews,resources,floorHeight}=createTrayModel({THREE,woodTexture});
  previews.name='previews';if(woodTexture) resources.push(woodTexture);
  const scene=new Scene(),camera=new PerspectiveCamera(35,1,.01,30);
  scene.add(tray,new HemisphereLight(0xf5ece0,0x291e1a,2.1));
  const light=new DirectionalLight(0xffeed8,2.8);light.position.set(-3,6,4);
  light.castShadow=true;light.shadow.mapSize.set(512,512);light.shadow.camera.near=.1;light.shadow.camera.far=15;
  light.shadow.camera.left=light.shadow.camera.bottom=-1.4;light.shadow.camera.right=light.shadow.camera.top=1.4;
  light.shadow.normalBias=.012;light.shadow.bias=-.0004;scene.add(light);
  const fill=new DirectionalLight(0xffffff,.6);fill.position.set(2,3,-4);scene.add(fill);
  const target=new WebGLRenderTarget(1,1,{samples:4,stencilBuffer:false});
  const material=new MeshBasicMaterial({map:target.texture,transparent:true,depthWrite:false});
  const geometry=new PlaneGeometry(1,1),surface=new Mesh(geometry,material),carrier=new Group();carrier.add(surface);
  resources.push(target,material,geometry);
  tray.updateMatrixWorld(true);const vertices=[];
  tray.traverse(mesh=>{const positions=mesh.geometry?.attributes.position;if(!positions) return;
    for(let i=0;i<positions.count;i++) vertices.push(new Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld));
  });
  const window=document.defaultView,element=document.createElement('button'),icon=document.createElement('i');
  let unmount=null,epoch=0,size=220,side=224,disposed=false,observer=null,observedCanvas=null;
  element.type='button';element.className='pd-tray-hit';element.append(icon);
  icon.className='fa-solid fa-eye-slash pd-tray-status';icon.setAttribute('aria-hidden','true');
  const label=key=>globalThis.game?.i18n?.localize(key)??key;

  function draw() {
    if(disposed||!unmount) return;
    const renderer=adapter.box.renderer;
    const previous={target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),
      viewport:renderer.getViewport(new Vector4()),scissor:renderer.getScissor(new Vector4()),
      scissorTest:renderer.getScissorTest(),color:renderer.getClearColor(new Color()),alpha:renderer.getClearAlpha(),
      autoClear:renderer.autoClear,shadowEnabled:renderer.shadowMap.enabled,
      shadowUpdate:renderer.shadowMap.autoUpdate,shadowNeedsUpdate:renderer.shadowMap.needsUpdate};
    try {
      // Render targets already use physical pixels; setViewport would apply native DPR again.
      renderer.setRenderTarget(target);
      renderer.setClearColor(0,0);renderer.autoClear=true;
      renderer.shadowMap.enabled=true;renderer.shadowMap.autoUpdate=true;
      renderer.clear();renderer.render(scene,camera);
    } finally {
      renderer.setViewport(previous.viewport);renderer.setScissor(previous.scissor);renderer.setScissorTest(previous.scissorTest);
      renderer.setRenderTarget(previous.target,previous.face,previous.mip);
      renderer.setClearColor(previous.color,previous.alpha);renderer.autoClear=previous.autoClear;
      renderer.shadowMap.enabled=previous.shadowEnabled;renderer.shadowMap.autoUpdate=previous.shadowUpdate;
      renderer.shadowMap.needsUpdate=previous.shadowNeedsUpdate;
    }
    adapter.renderTray();
  }
  function setState(state) {
    previews.position.y=state==='armed'?.04:0;
    element.dataset.state=state;const key=state==='private'?'PD.Private':state==='unsupported'?'PD.NativeOnly':'PD.Tray';
    element.title=label(key);element.setAttribute('aria-label',label(key));
    element.setAttribute('aria-disabled',String(['private','unsupported','empty','loading'].includes(state)));
    element.setAttribute('aria-busy',String(state==='loading'));
    icon.className=`fa-solid ${state==='unsupported'?'fa-dice':'fa-eye-slash'} pd-tray-status`;
    draw();
  }
  const ray=new Raycaster(),plane=new Plane(new Vector3(0,1,0),0);
  function worldAt(x,y,height=0) {
    const r=adapter.canvas.getBoundingClientRect();plane.constant=-height;
    ray.setFromCamera(new Vector2(2*(x-r.left)/r.width-1,1-2*(y-r.top)/r.height),adapter.box.camera);
    return ray.ray.intersectPlane(plane,new Vector3());
  }
  function frame(width) {
    side=width+4;const tilt=55*Math.PI/180;let distance=3.5;
    const point=p=>{const q=p.clone().project(camera);return {x:(q.x+1)*side/2,y:(1-q.y)*side/2};};
    camera.clearViewOffset();camera.up.set(0,Math.sin(tilt),-Math.cos(tilt));
    for(let i=0;i<5;i++) {
      camera.position.set(0,floorHeight+Math.cos(tilt)*distance,Math.sin(tilt)*distance);
      camera.lookAt(0,floorHeight,0);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
      const b=bounds(vertices.map(point));distance*=(b.right-b.left)/width;
    }
    const b=bounds(vertices.map(point)),dx=side/2-(b.left+b.right)/2,dy=side/2-(b.top+b.bottom)/2;
    camera.setViewOffset(side,side,-dx,-dy,side,side);camera.updateProjectionMatrix();
    const points=hull(vertices.map(point)),outline=bounds(points);
    const resolution=Math.ceil(side*Math.min(window.devicePixelRatio||1,2));
    if(target.width!==resolution) target.setSize(resolution,resolution);
    return {points,outline};
  }
  function layout() {
    if(disposed||!unmount||!adapter.box.camera) return;
    if(observer&&observedCanvas!==adapter.canvas) {
      if(observedCanvas) observer.unobserve(observedCanvas);
      observedCanvas=adapter.canvas;observer.observe(observedCanvas);
    }
    const c=adapter.canvas.getBoundingClientRect();
    const viewport={left:Math.max(0,c.left),top:Math.max(0,c.top),
      width:Math.min(window.innerWidth,right(c))-Math.max(0,c.left),
      height:Math.min(window.innerHeight,bottom(c))-Math.max(0,c.top)};
    if(viewport.width<64||viewport.height<64) {element.style.display='none';carrier.visible=false;return;}
    element.style.display='';carrier.visible=true;
    const width=Math.min(size,viewport.width-32,viewport.height-32),{points,outline}=frame(width);
    const height=outline.bottom-outline.top,rect=dockRect(viewport,width,getReservedRects(),height);
    const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
    const a=worldAt(cx-side/2,cy,.005),b=worldAt(cx+side/2,cy,.005),d=worldAt(cx,cy+side/2,.005),e=worldAt(cx,cy-side/2,.005);
    carrier.position.copy(worldAt(cx,cy,.005));surface.quaternion.copy(adapter.box.camera.quaternion);
    surface.scale.set(a.distanceTo(b),d.distanceTo(e),1);carrier.updateMatrixWorld(true);
    Object.assign(element.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,
      clipPath:`polygon(${points.map(p=>`${100*(p.x-outline.left)/rect.width}% ${100*(p.y-outline.top)/height}%`).join(',')})`});
    draw();
  }
  function clear() {
    ++epoch;for(const mesh of [...previews.children]) releasePreview(previews,mesh);
    setState('empty');
  }
  const api={element,layout,worldAt,setState,clear,
    mount() {
      if(disposed) return;unmount?.();unmount=adapter.mountTray(carrier);document.body.append(element);layout();
      if(!observer&&window.ResizeObserver) {
        observer=new window.ResizeObserver(layout);observedCanvas=adapter.canvas;observer.observe(observedCanvas);
        for(const selector of ['#sidebar','#ui-right','#hotbar']) {
          const e=document.querySelector(selector);if(e) observer.observe(e);
        }
      }
      window.addEventListener('resize',layout);document.addEventListener?.('transitionend',layout);setState('empty');
    },
    async show(session) {
      clear();if(!session) return;
      const ticket=epoch,generation=adapter.boxGeneration;
      if(session.mode!=='public') {setState('private');return;}
      if(!session.descriptors.length) return;
      setState('loading');const positions=previewPositions(session.descriptors.length,`${session.id}:${session.generation}`);
      const results=await Promise.allSettled(session.descriptors.map(async(d,i)=>{
        const mesh=await adapter.createPreview(d);if(!mesh) return;
        if(disposed||ticket!==epoch||generation!==adapter.boxGeneration) {releasePreview(mesh.parent,mesh);return;}
        const wrapper=new Group(),p=positions[i];wrapper.add(mesh);mesh.rotation.y+=p.yaw;
        if(mesh.userData.modelScale) mesh.scale.multiplyScalar(mesh.userData.modelScale);
        mesh.updateMatrixWorld(true);const bounds=new Box3().setFromObject(mesh),ext=bounds.getSize(new Vector3());
        const max=Math.max(ext.x,ext.y,ext.z);if(max>0) mesh.scale.multiplyScalar(p.size*2/max);
        mesh.updateMatrixWorld(true);const normalized=new Box3().setFromObject(mesh),center=normalized.getCenter(new Vector3());
        mesh.position.sub(center);mesh.position.y+=normalized.getSize(new Vector3()).y/2;
        mesh.castShadow=true;mesh.receiveShadow=true;
        wrapper.position.set(p.x,floorHeight+.003,p.z);previews.add(wrapper);
      }));
      if(!disposed&&ticket===epoch&&generation===adapter.boxGeneration) setState('ready');
      const failed=results.find(result=>result.status==='rejected');if(failed) throw failed.reason;
    },
    setSize(px){size=Math.max(160,Math.min(320,px));layout();},
    dispose() {
      if(disposed) return;disposed=true;clear();unmount?.();unmount=null;
      observer?.disconnect();window.removeEventListener('resize',layout);
      document.removeEventListener?.('transitionend',layout);element.remove();
      light.shadow.map?.dispose();light.shadow.mapPass?.dispose();
      for(const resource of resources) resource.dispose();
    }
  };
  return api;
}
