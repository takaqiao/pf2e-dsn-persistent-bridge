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
test('preview cleanup never disposes borrowed geometry or materials',()=>{
  let disposed=0;const mesh={geometry:{dispose:()=>disposed++},material:{dispose:()=>disposed++}};
  const children=[mesh],parent={remove(item){children.splice(children.indexOf(item),1);}};
  releasePreview(parent,mesh);assert.deepEqual(children,[]);assert.equal(disposed,0);
});
function viewHarness(createPreview=async()=>new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial()),ResizeObserver) {
  const camera=new THREE.PerspectiveCamera(20,1.25,.001,10);
  camera.position.set(0,1,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const scene=new THREE.Scene();let renders=0;
  const element={style:{},dataset:{},classList:{toggle(){}},setAttribute(){},append(){},remove(){},
    addEventListener(){},removeEventListener(){}};
  const document={createElement:()=>({...element,style:{},dataset:{}}),body:{append(){}},
    defaultView:{innerWidth:1000,innerHeight:800,ResizeObserver,addEventListener(){},removeEventListener(){}},
    querySelector:()=>null};
  const adapter={box:{camera,scene},boxGeneration:1,createPreview,
    canvas:{getBoundingClientRect:()=>({left:0,top:0,width:1000,height:800})},
    mountTray(group){scene.add(group);return ()=>group.removeFromParent();},renderTray(){renders++;}};
  const view=createTrayView({adapter,THREE,document,getReservedRects:()=>[]});
  return {view,scene,adapter,get renders(){return renders;}};
}
test('idle tray paints once and mounts real extruded octagonal geometry',()=>{
  const h=viewHarness();h.view.mount();const group=h.scene.children[0];
  assert.equal(group.children[0].geometry.type,'ExtrudeGeometry');
  assert.equal(group.children[1].geometry.type,'ExtrudeGeometry');
  assert.ok(h.renders<=2);assert.equal(h.scene.children.length,1);
  assert.ok(Math.abs(parseFloat(h.view.element.style.width)-220)<3);
  h.view.dispose();assert.equal(h.scene.children.length,0);
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
  assert.equal(h.scene.children[0].children[2].children.length,1);
  h.view.clear();assert.equal(h.scene.children[0].children[2].children.length,0);
});
