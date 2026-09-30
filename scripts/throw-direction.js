export function normalizeThrowDirection(direction) {
  if(!direction||!Number.isFinite(direction.x)||!Number.isFinite(direction.y)) return null;
  const length=Math.hypot(direction.x,direction.y);
  if(!Number.isFinite(length)||length===0) return null;
  return Object.freeze({x:direction.x===0?0:direction.x/length,y:direction.y===0?0:direction.y/length});
}

/** Samples are chronological cursor positions; retain the anchor before the latest movement. */
export function selectThrowDirection(samples,now=performance.now(),random=Math.random) {
  const points=(Array.isArray(samples)?samples:[]).filter(p=>p&&Number.isFinite(p.clientX)&&
    Number.isFinite(p.clientY)&&Number.isFinite(p.time)&&p.time<=now);
  let end=null;
  for(let i=points.length-1;i>0;i--) {
    const a=points[i-1],b=points[i];
    if(now-b.time>=200) break;
    if(b.time<a.time||(a.clientX===b.clientX&&a.clientY===b.clientY)) continue;
    end??=b;
    const delta={x:end.clientX-a.clientX,y:end.clientY-a.clientY};
    if(Math.hypot(delta.x,delta.y)>=3) {
      const direction=normalizeThrowDirection(delta);if(direction) return direction;
    }
  }
  const angle=random()*Math.PI*2;
  return Object.freeze({x:Math.cos(angle),y:Math.sin(angle)});
}

/** Native getVectors mutates each die and synchronously returns its notation. */
export function applyThrowDirection(original,notation,vector,boost,dist) {
  const directions=notation.dice.map(d=>normalizeThrowDirection(d.options?.pdPhysicalDirection));
  if(!directions.some(Boolean)||!Number.isFinite(dist)||dist<=0) return original(notation,vector,boost,dist);
  const same=(a,b)=>a===null?b===null:b!==null&&a.x===b.x&&a.y===b.y;
  for(let start=0;start<notation.dice.length;) {
    const direction=directions[start];let end=start+1;
    while(end<notation.dice.length&&same(direction,directions[end])) end++;
    const group=start===0&&end===notation.dice.length?notation:{...notation,dice:notation.dice.slice(start,end)};
    original(group,direction?{x:direction.x*dist,y:direction.y*dist}:vector,boost,dist);
    start=end;
  }
  return notation;
}
