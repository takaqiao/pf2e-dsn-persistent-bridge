export const octagonPoints=radius=>Array.from({length:8},(_,i)=>{
  const angle=Math.PI/8+i*Math.PI/4;return [Math.cos(angle)*radius,Math.sin(angle)*radius];
});
const right=r=>r.left+r.width,bottom=r=>r.top+r.height;
const overlaps=(a,b)=>a.left<right(b)&&right(a)>b.left&&a.top<bottom(b)&&bottom(a)>b.top;
export function dockRect(viewport,width,reservedRects=[]) {
  width=Math.min(width,viewport.width-32,viewport.height-32);
  const result={left:right(viewport)-width-16,top:bottom(viewport)-width-16,width,height:width};
  for(let pass=0;pass<reservedRects.length+1;pass++) {
    let changed=false;
    for(const r of reservedRects) if(r.width>0&&r.height>0&&overlaps(result,r)) {
      if(r.height>=r.width&&r.left-width-16>=viewport.left+16) result.left=r.left-width-16;
      else result.top=Math.max(viewport.top+16,r.top-width-16);
      changed=true;
    }
    if(!changed) break;
  }
  return result;
}
export function previewPositions(count) {
  if(!count) return [];
  for(let grid=Math.ceil(Math.sqrt(count));;grid++) {
    const spacing=1.3/grid,positions=[];
    for(let row=0;row<grid;row++) for(let col=0;col<grid;col++) {
      const x=(col-(grid-1)/2)*spacing,z=(row-(grid-1)/2)*spacing,size=Math.min(.14,spacing*.32);
      if(Math.hypot(x,z)+size<.81) positions.push({x,z,size});
    }
    if(positions.length>=count) return positions.slice(0,count);
  }
}
export function releasePreview(parent,preview) {parent?.remove(preview);}

/** Owns only tray geometry/materials; native preview meshes remain borrowed. */
export function createTrayView({adapter,THREE,document=globalThis.document,
  getReservedRects=()=>['#sidebar','#ui-right','#hotbar'].flatMap(selector=>{
    const e=document.querySelector(selector);return e&&e.getClientRects().length?[e.getBoundingClientRect()]:[];
  })}) {
  const {Group,Shape,Path,ExtrudeGeometry,MeshStandardMaterial,Mesh,Box3,Vector3,Vector2,Raycaster,Plane}=THREE;
  const group=new Group(),previews=new Group(),resources=[],window=document.defaultView;
  let unmount=null,epoch=0,size=220,disposed=false,observer=null,observedCanvas=null,themeObserver=null;
  const floorMaterial=new MeshStandardMaterial({color:0x363b3a,roughness:1,metalness:0});
  const rimMaterial=new MeshStandardMaterial({color:0x646963,roughness:.75,metalness:.12});
  resources.push(floorMaterial,rimMaterial);
  function outline(radius,Class=Shape,reverse=false) {
    const points=octagonPoints(radius);if(reverse) points.reverse();
    const path=new Class();path.moveTo(...points[0]);for(const p of points.slice(1)) path.lineTo(...p);
    path.closePath();return path;
  }
  const rimShape=outline(1);rimShape.holes.push(outline(.9,Path,true));
  for(const [shape,depth,material] of [[outline(.9),.025,floorMaterial],[rimShape,.085,rimMaterial]]) {
    const geometry=new ExtrudeGeometry(shape,{depth,bevelEnabled:false});geometry.rotateX(-Math.PI/2);
    resources.push(geometry);const mesh=new Mesh(geometry,material);mesh.receiveShadow=true;group.add(mesh);
  }
  group.add(previews);
  const element=document.createElement('button'),icon=document.createElement('i');
  element.type='button';element.className='pd-tray-hit';element.append(icon);
  icon.className='fa-solid fa-eye-slash pd-tray-status';icon.setAttribute('aria-hidden','true');
  const label=key=>globalThis.game?.i18n?.localize(key)??key;
  function setState(state) {
    previews.position.y=state==='armed'?.04:0;
    element.dataset.state=state;const key=state==='private'?'PD.Private':state==='unsupported'?'PD.NativeOnly':'PD.Tray';
    element.title=label(key);element.setAttribute('aria-label',label(key));
    element.setAttribute('aria-disabled',String(['private','unsupported','empty'].includes(state)));
    icon.className=`fa-solid ${state==='unsupported'?'fa-dice':'fa-eye-slash'} pd-tray-status`;
    if(unmount) adapter.renderTray();
  }
  const ray=new Raycaster(),plane=new Plane(new Vector3(0,1,0),0);
  function worldAt(x,y,height=0) {
    const r=adapter.canvas.getBoundingClientRect();plane.constant=-height;
    ray.setFromCamera(new Vector2(2*(x-r.left)/r.width-1,1-2*(y-r.top)/r.height),adapter.box.camera);
    return ray.ray.intersectPlane(plane,new Vector3());
  }
  function project(point) {
    const r=adapter.canvas.getBoundingClientRect(),p=point.project(adapter.box.camera);
    return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
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
    if(viewport.width<64||viewport.height<64) {element.style.display='none';return;}
    element.style.display='';const target=dockRect(viewport,size,getReservedRects());
    const cx=target.left+target.width/2,cy=target.top+target.height/2;
    let points;
    for(let n=0;n<3;n++) {
      group.position.copy(worldAt(cx,cy,group.scale.x*.4));group.updateMatrixWorld(true);
      points=octagonPoints(1).map(([x,z])=>project(group.localToWorld(new Vector3(x,.085,z))));
      const w=Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x));
      const h=Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y));
      group.scale.multiplyScalar(Math.min(target.width/w,target.height/h));
    }
    group.position.copy(worldAt(cx,cy,group.scale.x*.4));group.updateMatrixWorld(true);
    points=octagonPoints(1).map(([x,z])=>project(group.localToWorld(new Vector3(x,.085,z))));
    const left=Math.min(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y));
    const width=Math.max(...points.map(p=>p.x))-left,height=Math.max(...points.map(p=>p.y))-top;
    Object.assign(element.style,{left:`${left}px`,top:`${top}px`,width:`${width}px`,height:`${height}px`,
      clipPath:`polygon(${points.map(p=>`${100*(p.x-left)/width}% ${100*(p.y-top)/height}%`).join(',')})`});
    adapter.renderTray();
  }
  function clear() {
    ++epoch;for(const mesh of [...previews.children]) releasePreview(previews,mesh);
    setState('empty');adapter.renderTray();
  }
  function theme() {
    const light=document.body.classList?.contains('theme-light');
    floorMaterial.color.setHex(light?0x7b8175:0x363b3a);rimMaterial.color.setHex(light?0xa4a99b:0x646963);
    adapter.renderTray();
  }
  const api={element,layout,worldAt,setState,clear,
    mount() {
      if(disposed) return;unmount?.();unmount=adapter.mountTray(group);document.body.append(element);layout();
      if(!observer&&window.ResizeObserver) {
        observer=new window.ResizeObserver(layout);observedCanvas=adapter.canvas;observer.observe(observedCanvas);
        for(const selector of ['#sidebar','#ui-right','#hotbar']) {
          const e=document.querySelector(selector);if(e) observer.observe(e);
        }
      }
      if(!themeObserver&&window.MutationObserver) {
        themeObserver=new window.MutationObserver(theme);
        themeObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
      }
      window.addEventListener('resize',layout);document.addEventListener?.('transitionend',layout);setState('empty');
    },
    async show(session) {
      clear();if(!session) return;
      const ticket=epoch,generation=adapter.boxGeneration;
      if(session.mode!=='public') {setState('private');return;}
      if(!session.descriptors.length) return;
      setState('ready');const positions=previewPositions(session.descriptors.length);
      await Promise.all(session.descriptors.map(async(d,i)=>{
        const mesh=await adapter.createPreview(d);if(!mesh) return;
        if(disposed||ticket!==epoch||generation!==adapter.boxGeneration) {releasePreview(mesh.parent,mesh);return;}
        const wrapper=new Group(),p=positions[i];wrapper.add(mesh);
        if(mesh.userData.modelScale) mesh.scale.multiplyScalar(mesh.userData.modelScale);
        mesh.updateMatrixWorld(true);const bounds=new Box3().setFromObject(mesh),ext=bounds.getSize(new Vector3());
        const max=Math.max(ext.x,ext.y,ext.z);if(max>0) mesh.scale.multiplyScalar(p.size*2/max);
        mesh.updateMatrixWorld(true);const normalized=new Box3().setFromObject(mesh),center=normalized.getCenter(new Vector3());
        mesh.position.sub(center);mesh.position.y+=normalized.getSize(new Vector3()).y/2;
        wrapper.position.set(p.x,.028,p.z);previews.add(wrapper);adapter.renderTray();
      }));
    },
    setSize(px){size=Math.max(160,Math.min(320,px));layout();},
    dispose() {
      if(disposed) return;clear();disposed=true;unmount?.();unmount=null;
      observer?.disconnect();themeObserver?.disconnect();window.removeEventListener('resize',layout);
      document.removeEventListener?.('transitionend',layout);element.remove();
      for(const resource of resources) resource.dispose();
    }
  };
  return api;
}
