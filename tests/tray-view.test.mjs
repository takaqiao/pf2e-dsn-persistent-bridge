import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {octagonPoints,dockRect,previewPositions,releasePreview,createTrayView} from '../scripts/tray-view.js';
import {deferred} from './fixtures/dsn-runtime.mjs';

test('outline has eight equal-radius vertices',()=>{
  const points=octagonPoints(1);assert.equal(points.length,8);
  for(const [x,y] of points) assert.ok(Math.abs(Math.hypot(x,y)-1)<1e-9);
});
test('dock avoids expanded sidebar and bottom hotbar inside the actual canvas',()=>{
  assert.deepEqual(dockRect({left:20,top:10,width:980,height:790},220,
    [{left:760,top:0,width:240,height:800},{left:0,top:730,width:750,height:70}]),
    {left:524,top:494,width:220,height:220});
});
test('one hundred previews fit inside the octagonal padded floor',()=>{
  const positions=previewPositions(100);assert.equal(positions.length,100);
  assert.deepEqual(positions,previewPositions(100));
  for(const p of positions) assert.ok(Math.hypot(p.x,p.z)+p.size<.81);
});
test('a single preview stays miniature instead of filling the tray',()=>{
  assert.ok(previewPositions(1)[0].size<=.16);
});
test('preview placement varies between checks but stays stable within one generation',()=>{
  const a=previewPositions(12,'check-a:0');
  assert.deepEqual(a,previewPositions(12,'check-a:0'));
  assert.notDeepEqual(a,previewPositions(12,'check-b:0'));
  assert.notDeepEqual(a,previewPositions(12,'check-a:1'));
  for(const p of a) assert.ok(p.yaw>=0&&p.yaw<Math.PI*2);
});
test('jittered preview bounds stay inside the liner without overlapping',()=>{
  for(const count of [1,2,4,20,100]) for(const seed of ['a','b','c']) {
    const positions=previewPositions(count,seed);
    for(const p of positions) assert.ok(Math.hypot(p.x,p.z)+Math.SQRT2*p.size<.81);
    for(let i=0;i<count;i++) for(let j=i+1;j<count;j++) {
      const a=positions[i],b=positions[j];
      assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>Math.SQRT2*(a.size+b.size));
    }
  }
});
test('preview cleanup never disposes borrowed geometry or materials',()=>{
  let disposed=0;const mesh={geometry:{dispose:()=>disposed++},material:{dispose:()=>disposed++}};
  const children=[mesh],parent={remove(item){children.splice(children.indexOf(item),1);}};
  releasePreview(parent,mesh);assert.deepEqual(children,[]);assert.equal(disposed,0);
});

test('the tray stays loading until its preview materials are prepared',async()=>{
  const wait=deferred(),h=viewHarness(()=>wait.promise);h.view.mount();
  const showing=h.view.show({id:'loading',generation:0,mode:'public',descriptors:[{key:'a'}]});
  assert.equal(h.view.element.dataset.state,'loading');
  wait.resolve(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial()));
  await showing;assert.equal(h.view.element.dataset.state,'ready');h.view.dispose();
});
function viewHarness(createPreview=async()=>new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial()),ResizeObserver) {
  const camera=new THREE.PerspectiveCamera(20,1.25,.001,10);
  camera.position.set(0,1,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const scene=new THREE.Scene();let renders=0;
  const renderer={target:null,pixelRatio:1,viewport:new THREE.Vector4(3,4,1000,800),currentViewport:new THREE.Vector4(3,4,1000,800),scissor:new THREE.Vector4(5,6,700,600),
    scissorTest:true,color:new THREE.Color(0x123456),alpha:.4,autoClear:false,shadowMap:{autoUpdate:false},
    getRenderTarget(){return this.target;},getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
    setRenderTarget(target){this.target=target;if(target) this.currentViewport.copy(target.viewport);
      else this.currentViewport.copy(this.viewport).multiplyScalar(this.pixelRatio);},
    getViewport(out){return out.copy(this.viewport);},setViewport(...values){this.viewport.copy(values[0]?.isVector4?values[0]:new THREE.Vector4(...values));
      this.currentViewport.copy(this.viewport).multiplyScalar(this.pixelRatio);},
    getScissor(out){return out.copy(this.scissor);},setScissor(...values){this.scissor.copy(values[0]?.isVector4?values[0]:new THREE.Vector4(...values));},
    getScissorTest(){return this.scissorTest;},setScissorTest(value){this.scissorTest=value;},
    getClearColor(out){return out.copy(this.color);},getClearAlpha(){return this.alpha;},
    setClearColor(color,alpha=this.alpha){this.color.set(color);this.alpha=alpha;},
    clear(){},render(scene,camera){this.lastScene=scene;this.lastCamera=camera;this.lastTarget=this.target;this.lastViewport=this.currentViewport.toArray();
      this.cachedPreviewCount=scene.children.find(child=>child.isGroup)?.children.find(child=>child.name==='previews')?.children.length??0;
      if(this.fail) throw new Error('GPU draw failed');}};
  const element={style:{},dataset:{},classList:{toggle(){}},setAttribute(){},append(){},remove(){},
    addEventListener(){},removeEventListener(){}};
  const document={createElement:()=>({...element,style:{},dataset:{}}),body:{append(){}},
    defaultView:{innerWidth:1000,innerHeight:800,ResizeObserver,addEventListener(){},removeEventListener(){}},
    querySelector:()=>null};
  const adapter={box:{camera,scene,renderer},boxGeneration:1,createPreview,
    canvas:{getBoundingClientRect:()=>({left:0,top:0,width:1000,height:800})},
    mountTray(group){scene.add(group);return ()=>group.removeFromParent();},renderTray(){renders++;}};
  const view=createTrayView({adapter,THREE,document,getReservedRects:()=>[]});
  return {view,scene,adapter,renderer,get renders(){return renders;},
    get tray(){return renderer.lastScene.children.find(child=>child.isGroup);}};
}
test('tray and dice share the desktop camera without changing the native projection',async()=>{
  const h=viewHarness(),native=h.adapter.box.camera;
  const before={projection:native.projectionMatrix.toArray(),world:native.matrixWorld.toArray()};
  h.view.mount();const group=h.scene.children[0],camera=h.renderer.lastCamera;
  assert.equal(group.children[0].geometry.type,'PlaneGeometry');
  assert.notEqual(h.renderer.lastScene,h.scene);assert.notEqual(camera,native);
  assert.equal(camera.fov,35);assert.equal(h.tray.rotation.x,0);
  const direction=camera.position.clone().sub(new THREE.Vector3(0,.025,0)).normalize();
  assert.ok(Math.abs(direction.y-.573576436351046)<1e-9);
  assert.ok(Math.abs(direction.z-.819152044288992)<1e-9);
  const nearLeft=new THREE.Vector3(-.4,.025,.4).project(camera);
  const farLeft=new THREE.Vector3(-.4,.025,-.4).project(camera);
  assert.ok(nearLeft.y<farLeft.y);assert.ok(Math.abs(nearLeft.x)>Math.abs(farLeft.x));
  await h.view.show({mode:'public',descriptors:[{key:'a'}]});
  assert.equal(h.tray.children.find(child=>child.name==='previews').children.length,1);
  assert.deepEqual(native.projectionMatrix.toArray(),before.projection);
  assert.deepEqual(native.matrixWorld.toArray(),before.world);
  h.view.dispose();assert.equal(h.scene.children.length,0);
});
test('preview yaw is applied before sizing and the miniature stays on the liner',async()=>{
  const h=viewHarness(async()=>new THREE.Mesh(new THREE.BoxGeometry(1,.5,2),new THREE.MeshStandardMaterial()));
  h.view.mount();const session={id:'pose-check',generation:0,mode:'public',descriptors:[{key:'a'}]};
  await h.view.show(session);
  const parent=h.tray.getObjectByName('previews'),wrapper=parent.children[0],mesh=wrapper.children[0];
  assert.notEqual(mesh.rotation.y,0);h.tray.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(wrapper),size=box.getSize(new THREE.Vector3());
  assert.ok(Math.abs(box.min.y-.028)<1e-7);assert.ok(Math.max(size.x,size.y,size.z)<=.28+1e-7);
  const position=wrapper.position.toArray(),yaw=mesh.rotation.y;
  await h.view.show(session);
  assert.deepEqual(parent.children[0].position.toArray(),position);
  assert.equal(parent.children[0].children[0].rotation.y,yaw);h.view.dispose();
});
test('220 pixel dock follows the projected shallow outline instead of a square hit area',()=>{
  const h=viewHarness();h.view.mount();
  assert.ok(h.renders<=2);assert.equal(h.scene.children.length,1);
  const {width,height,top,left}=h.view.element.style;
  assert.ok(Math.abs(parseFloat(width)-220)<1);
  assert.ok(parseFloat(height)>120&&parseFloat(height)<170);
  assert.ok(Math.abs(parseFloat(top)+parseFloat(height)-784)<1);
  assert.ok(Math.abs(parseFloat(left)+parseFloat(width)-984)<1);
  h.view.dispose();assert.equal(h.scene.children.length,0);
});
test('offscreen drawing restores native renderer state even when the draw fails',()=>{
  for(const fail of [false,true]) {
    const h=viewHarness(),r=h.renderer;r.fail=fail;
    if(fail) assert.throws(()=>h.view.mount(),/GPU draw failed/);else h.view.mount();
    assert.equal(r.target,null);assert.deepEqual(r.viewport.toArray(),[3,4,1000,800]);
    assert.deepEqual(r.scissor.toArray(),[5,6,700,600]);assert.equal(r.scissorTest,true);
    assert.equal(r.color.getHex(),0x123456);assert.equal(r.alpha,.4);
    assert.equal(r.autoClear,false);assert.equal(r.shadowMap.autoUpdate,false);
    r.fail=false;h.view.dispose();
  }
});
test('high density displays draw the full offscreen texture without doubling its viewport',()=>{
  const h=viewHarness();h.renderer.pixelRatio=2;h.view.mount();
  const target=h.renderer.lastTarget;
  assert.deepEqual(h.renderer.lastViewport,[0,0,target.width,target.height]);
  h.view.dispose();
});
test('box-change layout moves canvas observation to the replacement host',()=>{
  const observed=new Set();
  class ResizeObserver {
    observe(host){observed.add(host);}unobserve(host){observed.delete(host);}disconnect(){observed.clear();}
  }
  const h=viewHarness(undefined,ResizeObserver);h.view.mount();const old=h.adapter.canvas;
  assert.ok(observed.has(old));h.adapter.canvas={getBoundingClientRect:()=>({left:0,top:0,width:1000,height:800})};
  h.view.layout();assert.equal(observed.has(old),false);assert.ok(observed.has(h.adapter.canvas));
  h.view.dispose();assert.equal(observed.size,0);
});
test('a preview created for an old box cannot join the new scene',async()=>{
  const wait=deferred(),mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial());
  const h=viewHarness(async()=>{await wait.promise;return mesh;});h.view.mount();
  const shown=h.view.show({id:'a',generation:1,mode:'public',descriptors:[{key:'a'}]});
  h.adapter.boxGeneration++;wait.resolve();await shown;assert.equal(mesh.parent,null);
});
test('late previews cannot populate a different session or a rebuilt box',async()=>{
  const wait=deferred(),meshes=[];
  const h=viewHarness(async d=>{if(d.key==='a') await wait.promise;
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial());meshes.push(mesh);return mesh;});
  h.view.mount();const a=h.view.show({id:'a',generation:1,mode:'public',descriptors:[{key:'a'}]});
  await h.view.show({id:'b',generation:1,mode:'public',descriptors:[{key:'b'}]});
  wait.resolve();await a;assert.equal(meshes.at(-1).parent,null);
  assert.equal(h.tray.children.find(child=>child.name==='previews').children.length,1);
  h.view.clear();assert.equal(h.tray.children.find(child=>child.name==='previews').children.length,0);
});
test('a failed model cannot hide successfully created previews from the cached tray',async()=>{
  for(const failedKey of ['a','b']) {
    const wait=deferred(),h=viewHarness(async descriptor=>{
      if(descriptor.key===failedKey) throw new Error('model load failed');
      await wait.promise;return new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial());
    });h.view.mount();
    const shown=assert.rejects(h.view.show({mode:'public',descriptors:[{key:'a'},{key:'b'}]}),/model load failed/);
    wait.resolve();await shown;
    assert.equal(h.renderer.cachedPreviewCount,1);h.view.dispose();
  }
});
