/** Local model units use a tray diameter of 2; +Y is up. Borrowed dice and wood maps stay owned by the caller. */
export function createTrayModel({THREE,woodTexture=null}) {
  const {Group,BufferGeometry,Float32BufferAttribute,Mesh,MeshStandardMaterial,
    CylinderGeometry,DataTexture,RGBAFormat,UnsignedByteType,RepeatWrapping}=THREE;
  const group=new Group(),previews=new Group(),resources=[];
  const own=resource=>{resources.push(resource);return resource;};
  function surfaceTexture(grain=false) {
    const size=64,data=new Uint8Array(size*size*4);let seed=721;
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const value=grain?128+22*Math.sin(2*Math.PI*(9*y/size+.08*Math.sin(2*Math.PI*x/size))):112+(seed>>>27);
      const offset=4*(y*size+x);data[offset]=data[offset+1]=data[offset+2]=value;data[offset+3]=255;
    }
    const texture=own(new DataTexture(data,size,size,RGBAFormat,UnsignedByteType));
    texture.wrapS=texture.wrapT=RepeatWrapping;if(!grain) texture.repeat.set(6,6);
    texture.needsUpdate=true;return texture;
  }
  const wood=own(new MeshStandardMaterial({name:'tray-wood',color:woodTexture?0xffffff:0x3b241a,
    map:woodTexture,roughness:.83,metalness:0,bumpMap:surfaceTexture(true),bumpScale:.00016}));
  const liner=own(new MeshStandardMaterial({name:'tray-liner',color:0x501923,
    roughness:.98,metalness:0,bumpMap:surfaceTexture(),bumpScale:.00018}));
  const base=own(new MeshStandardMaterial({name:'tray-base',color:woodTexture?0xaaa099:0x2b1a13,
    map:woodTexture,roughness:.9,metalness:0}));
  const brass=own(new MeshStandardMaterial({name:'tray-brass',color:0x796d46,roughness:.67,metalness:.68}));

  function edgeGeometry(edge,section) {
    const positions=[],uv=[],angles=[Math.PI/8+edge*Math.PI/4,Math.PI/8+(edge+1)*Math.PI/4];
    const distance=[0];
    for(let k=1;k<section.length;k++) distance[k]=distance[k-1]+Math.hypot(
      section[k][0]-section[k-1][0],section[k][1]-section[k-1][1]);
    function vertex(end,k) {
      const [radius,height]=section[k],angle=angles[end];
      positions.push(radius*Math.cos(angle),height,radius*Math.sin(angle));uv.push(end,distance[k]);
    }
    for(let k=0;k<section.length;k++) {
      const next=(k+1)%section.length;
      vertex(0,k);vertex(0,next);vertex(1,next);vertex(0,k);vertex(1,next);vertex(1,k);
    }
    const geometry=own(new BufferGeometry());
    geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));geometry.computeVertexNormals();return geometry;
  }
  function add(geometry,material,y=0) {
    const mesh=new Mesh(geometry,material);mesh.position.y=y;mesh.castShadow=true;mesh.receiveShadow=true;
    group.add(mesh);return mesh;
  }
  add(own(new CylinderGeometry(.98,.98,.018,8,1,false,Math.PI/8)),base,.009);
  add(own(new CylinderGeometry(.9,.9,.01,8,1,false,Math.PI/8)),liner,.02);
  const section=[[.98,0],[.992,.012],[1,.098],[.988,.11],[.912,.11],
    [.9,.098],[.875,.035],[.9,.025],[.9,0]];
  for(let edge=0;edge<8;edge++) {
    add(edgeGeometry(edge,section),wood);
    add(edgeGeometry(edge,[[.947,.11005],[.949,.11005],[.949,.11025],[.947,.11025]]),brass);
  }
  group.add(previews);return {group,previews,resources,floorHeight:.025};
}
