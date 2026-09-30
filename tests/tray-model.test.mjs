import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTrayModel} from '../scripts/tray-model.js';

const model=options=>createTrayModel({THREE,...options});
const meshes=(group,predicate=()=>true)=>{
  const result=[];group.traverse(item=>{if(item.isMesh&&predicate(item)) result.push(item);});return result;
};
const point=(geometry,index)=>new THREE.Vector3().fromBufferAttribute(geometry.attributes.position,index);

test('the eight rim pieces sit on one horizontal base with a uniform shallow height',()=>{
  const h=model(),rim=meshes(h.group,m=>m.material.name==='tray-wood');
  assert.equal(rim.length,8);assert.equal(h.floorHeight,.025);
  for(const mesh of rim) {
    const box=new THREE.Box3().setFromObject(mesh);
    assert.ok(Math.abs(box.min.y)<1e-7);assert.ok(Math.abs(box.max.y-.11)<1e-7);
    const position=mesh.geometry.attributes.position;
    let outer=0;
    for(let i=0;i<position.count;i++) outer=Math.max(outer,Math.hypot(position.getX(i),position.getZ(i)));
    assert.ok(Math.abs(outer-1)<1e-7);
  }
  const liner=meshes(h.group,m=>m.material.name==='tray-liner')[0];
  const box=new THREE.Box3().setFromObject(liner);
  assert.ok(Math.abs(box.max.y-h.floorHeight)<1e-7);
  assert.equal(h.previews.parent,h.group);assert.equal(h.previews.children.length,0);
});

test('rim wood grain follows each edge without turning vertically on walls and bevels',()=>{
  const h=model({woodTexture:new THREE.Texture()}),rim=meshes(h.group,m=>m.material.name==='tray-wood');
  for(const mesh of rim) {
    const geometry=mesh.geometry,{position,uv}=geometry.attributes;
    assert.ok(uv);assert.equal(uv.count,position.count);
    const mid=new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    const tangent=new THREE.Vector3(-mid.z,0,mid.x).normalize();
    const angles=new Map();
    for(let i=0;i<position.count;i++) {
      const p=point(geometry,i),key=Math.atan2(p.z,p.x).toFixed(5);
      const values=angles.get(key)??[];values.push({p,u:uv.getX(i),v:uv.getY(i)});angles.set(key,values);
      assert.ok(Number.isFinite(uv.getX(i))&&Number.isFinite(uv.getY(i)));
    }
    assert.equal(angles.size,2);
    const ends=[...angles.values()].sort((a,b)=>a[0].p.dot(tangent)-b[0].p.dot(tangent));
    for(const endpoint of ends) assert.ok(endpoint.every(v=>Math.abs(v.u-endpoint[0].u)<1e-7));
    assert.ok(ends[1][0].u>ends[0][0].u);
    assert.ok(new Set(ends[0].map(v=>v.v)).size>3);
  }
});

test('rim faces point outwards so the outside, bevels and top render without double-sided material',()=>{
  const h=model(),rim=meshes(h.group,m=>m.material.name==='tray-wood');h.group.updateMatrixWorld(true);
  for(const mesh of rim) {
    assert.equal(mesh.material.side,THREE.FrontSide);
    const {normal,position}=mesh.geometry.attributes;
    for(let i=0;i<normal.count;i++) {
      const n=new THREE.Vector3().fromBufferAttribute(normal,i);
      assert.ok(Number.isFinite(n.x+n.y+n.z));assert.ok(Math.abs(n.length()-1)<1e-6);
    }
    for(let i=0;i<position.count;i+=3) {
      const a=point(mesh.geometry,i),b=point(mesh.geometry,i+1),c=point(mesh.geometry,i+2);
      assert.ok(b.sub(a).cross(c.sub(a)).length()>1e-7);
    }
  }
  for(let edge=0;edge<8;edge++) {
    const angle=Math.PI/4+edge*Math.PI/4,radial=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
    const ray=new THREE.Raycaster(radial.clone().multiplyScalar(2).setY(.06),radial.clone().negate());
    const hit=ray.intersectObjects(rim)[0];assert.ok(hit);assert.ok(hit.face.normal.dot(radial)>.9);
    const top=new THREE.Raycaster(radial.clone().multiplyScalar(.88).setY(1),new THREE.Vector3(0,-1,0));
    const topHit=top.intersectObjects(rim)[0];assert.ok(topHit);assert.ok(topHit.face.normal.y>.999);
  }
});

test('inner walls slope inwards near the liner instead of forming a vertical box',()=>{
  const h=model(),rim=meshes(h.group,m=>m.material.name==='tray-wood');h.group.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(new THREE.Vector3(0,.06,0),new THREE.Vector3(1,0,1).normalize());
  const hit=ray.intersectObjects(rim)[0];assert.ok(hit);
  assert.ok(hit.face.normal.y>0);assert.ok(hit.face.normal.x<0&&hit.face.normal.z<0);
  assert.ok(hit.distance<.9);
});

test('matte walnut, dark wine liner and narrow aged brass retain distinct surface responses',()=>{
  const texture=new THREE.Texture(),h=model({woodTexture:texture});
  const wood=meshes(h.group,m=>m.material.name==='tray-wood')[0].material;
  const liner=meshes(h.group,m=>m.material.name==='tray-liner')[0].material;
  const inlay=meshes(h.group,m=>m.material.name==='tray-brass');
  assert.equal(wood.map,texture);assert.ok(wood.roughness>=.75);assert.ok(wood.metalness<.1);
  assert.ok(liner.color.r>liner.color.g*2&&liner.color.r>liner.color.b*1.5);
  assert.ok(liner.roughness>.9);assert.equal(liner.metalness,0);assert.ok(liner.bumpMap);
  assert.ok(liner.bumpScale<.001);assert.ok(inlay.length>0);
  for(const mesh of inlay) {
    const positions=mesh.geometry.attributes.position,radii=[];
    for(let i=0;i<positions.count;i++) radii.push(Math.hypot(positions.getX(i),positions.getZ(i)));
    assert.ok(Math.max(...radii)-Math.min(...radii)<=.0021);
    assert.ok(mesh.material.roughness>.5&&mesh.material.metalness>.5);
  }
});

test('model cleanup owns its generated surfaces but never borrowed wood or preview dice',()=>{
  const wood=new THREE.Texture(),h=model({woodTexture:wood}),preview=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());
  h.previews.add(preview);
  let woodDisposed=false,previewGeometryDisposed=false,previewMaterialDisposed=false;
  wood.addEventListener('dispose',()=>woodDisposed=true);
  preview.geometry.addEventListener('dispose',()=>previewGeometryDisposed=true);
  preview.material.addEventListener('dispose',()=>previewMaterialDisposed=true);
  assert.equal(new Set(h.resources).size,h.resources.length);
  for(const mesh of meshes(h.group,m=>m!==preview)) {
    assert.ok(h.resources.includes(mesh.geometry));assert.ok(h.resources.includes(mesh.material));
    if(mesh.material.bumpMap) assert.ok(h.resources.includes(mesh.material.bumpMap));
  }
  for(const resource of h.resources) resource.dispose();
  assert.equal(woodDisposed,false);assert.equal(previewGeometryDisposed,false);assert.equal(previewMaterialDisposed,false);
});
