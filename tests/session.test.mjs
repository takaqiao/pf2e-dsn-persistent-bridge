import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../scripts/session.js';

const d20 = {key:'a',termPath:'0/0',ordinal:0,faces:20,flavor:null};
const d6 = {key:'b',termPath:'1/0',ordinal:0,faces:6,flavor:'fire'};
const make = (descriptors=[d20]) => createSession({id:'s',appId:1,userId:'u',
  kind:'check',mode:'public',descriptors});

test('cancel prevents late settling and submission', () => {
  const s=make(), token=s.startBatch();
  assert.equal(s.attachDie(token,'a','die-a'),true);
  s.cancel('close');
  assert.equal(s.settle(token,[{persistentId:'die-a',value:19}]),false);
  assert.equal(s.prepareSubmit(),null);
});

test('submission consumes confirmed values exactly once', () => {
  const s=make(), token=s.startBatch();
  s.attachDie(token,'a','die-a');
  assert.equal(s.settle(token,[{persistentId:'die-a',value:19}]),true);
  assert.deepEqual(s.prepareSubmit().values,[{key:'a',value:19}]);
  assert.equal(s.prepareSubmit(),null);
  assert.equal(s.isCurrent(token),false);
});

test('partial submit takes landed slots and invalidates flying slots', () => {
  const s=make([d20,d6]), token=s.startBatch();
  s.attachDie(token,'a','die-a'); s.attachDie(token,'b','die-b');
  s.settle(token,[{persistentId:'die-a',value:3}]);
  const snapshot=s.prepareSubmit();
  assert.deepEqual(snapshot.values,[{key:'a',value:3}]);
  assert.equal(s.settle(token,[{persistentId:'die-b',value:5}]),false);
  assert.deepEqual(snapshot.values,[{key:'a',value:3}]);
});

test('native submit before landing contains no physical values', () => {
  const s=make(), token=s.startBatch();
  s.attachDie(token,'a','die-a'); s.setFlight(token);
  assert.deepEqual(s.prepareSubmit().values,[]);
  assert.equal(s.settle(token,[{persistentId:'die-a',value:20}]),false);
});

test('another session token cannot register or settle a die', () => {
  const s=make(), token=s.startBatch(), wrong={...token,sessionId:'other'};
  assert.equal(s.attachDie(wrong,'a','die-a'),false);
  s.attachDie(token,'a','die-a');
  assert.equal(s.settle(wrong,[{persistentId:'die-a',value:5}]),false);
  assert.deepEqual(s.prepareSubmit().values,[]);
});

for (const value of [NaN,0,21,1.5,undefined]) {
  test(`invalid d20 value ${String(value)} is rejected atomically`, () => {
    const s=make([d20,d6]), token=s.startBatch();
    s.attachDie(token,'a','die-a'); s.attachDie(token,'b','die-b');
    assert.equal(s.settle(token,[{persistentId:'die-b',value:4},
      {persistentId:'die-a',value}]),false);
    assert.deepEqual(s.prepareSubmit().values,[]);
  });
}

test('unknown and duplicate die IDs cannot supply results', () => {
  const s=make([d20,d6]), token=s.startBatch();
  assert.equal(s.attachDie(token,'unknown','x'),false);
  s.attachDie(token,'a','die-a');
  assert.equal(s.attachDie(token,'b','die-a'),false);
  assert.equal(s.attachDie(token,'a','another'),false);
  assert.equal(s.settle(token,[{persistentId:'x',value:2}]),false);
  assert.equal(s.settle(token,[{persistentId:'die-a',value:2},
    {persistentId:'die-a',value:3}]),false);
  assert.deepEqual(s.prepareSubmit().values,[]);
});

test('repeated landing cannot replace confirmed results', () => {
  const s=make(), token=s.startBatch(); s.attachDie(token,'a','die-a');
  assert.equal(s.settle(token,[{persistentId:'die-a',value:7}]),true);
  assert.equal(s.settle(token,[{persistentId:'die-a',value:15}]),false);
  assert.deepEqual(s.prepareSubmit().values,[{key:'a',value:7}]);
});

test('same dice count with changed flavor discards the old generation', () => {
  const s=make([d6]), token=s.startBatch(); s.attachDie(token,'b','die-b');
  s.settle(token,[{persistentId:'die-b',value:6}]);
  s.replace({mode:'public',descriptors:[{...d6,flavor:'cold'}]});
  assert.equal(s.isCurrent(token),false);
  assert.equal(s.settle(token,[{persistentId:'die-b',value:4}]),false);
  assert.deepEqual(s.prepareSubmit().values,[]);
});

test('private mode discards public values and prevents new grabbing', () => {
  const s=make(), token=s.startBatch(); s.attachDie(token,'a','die-a');
  s.settle(token,[{persistentId:'die-a',value:20}]);
  s.replace({mode:'blind',descriptors:[d20]});
  assert.equal(s.startBatch(),null);
  assert.deepEqual(s.prepareSubmit().values,[]);
});

test('d100 accepts 100 but not 0 and snapshots cannot mutate slots', () => {
  const descriptors=[{...d20,faces:100}], s=make(descriptors), token=s.startBatch();
  descriptors[0].faces=2;
  s.attachDie(token,'a','percentile');
  assert.equal(s.settle(token,[{persistentId:'percentile',value:100}]),true);
  const snapshot=s.prepareSubmit();
  assert.equal(snapshot.descriptors[0].faces,100);
  assert.throws(()=>{snapshot.values[0].value=1;},TypeError);
});
