# Persistent Dice 八角骰盘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除检定窗口里的旧面板，用右下角三维八角骰盘提供整把抓取、旋转、释放投掷，并将本次骰面准确交给原生 PF2e 检定。

**Architecture:** 托盘和小骰子使用 DsN 的现有 Three.js 场景；预览不创建物理对象，抓起后转换为原生持久骰子。独立会话绑定精确的 PF2e 对象引用，收值以原生投掷完成为准；原生按钮、私密检定和未证明绑定能力的入口保留原有路径。

**Tech Stack:** Foundry v14 / PF2e 8.5.1 / DsN 6.4.1 / libWrapper；原生 ES modules；DsN 的 Three.js r184；Node 内置 `node:test`，无需新增运行依赖。

**Spec:** [2026-09-30-octagonal-tray-design.md](../specs/2026-09-30-octagonal-tray-design.md)，用户已认可设计。

## Global Constraints

- 保留模块 ID `pf2e-dsn-persistent-bridge`；当前开发和验收锁定 DsN 6.4.1、PF2e 8.5.1、Foundry v14。
- 基线包含服务器 0.4.10 修复；快照位置 `C:/Users/Taka/Desktop/fvtt/output/persistent-dice-restart-20260930/installed-0.4.10`，34 个文件 SHA-256 已核对。
- 公开投掷在释放时由 DsN 生成并展示本次结果，PF2e 使用同一结果；不提前评价 PF2e 检定，不声称鼠标轨迹改变随机分布。
- 私密、暗骰、自骰不进入公开持久骰子 socket。模式切换后旧公开值不能成为新的私密结果。
- 不新增第二个 WebGL 渲染器、物理引擎或盘内八角碰撞系统；空盘按需重绘，不唤醒持续 RAF/worker。
- 不改全局随机生成器、`core.diceConfiguration`、其他模块的设置或玩家 DsN 可见性偏好。
- 原生窗口、消息权限、成功等级、伤害实例及原生重投由 PF2e 负责；不添加教程面板和自动欢迎消息。
- 仅在可证明身份传递的入口允许抓取。普通检定、原生武器/近战武器伤害和原生法术伤害为本轮物理输入范围；元素冲击及内联伤害保持原生检定。
- 发布需要用户明确说 release。计划与开发提交不能触发 release tag、GitHub Release 或生产安装。

## Review Focus

1. 两个相同公式、同一玩家的窗口并发提交，不能交换骰面；共享同一个 context 的自定义调用在抓取前禁用物理输入。Task 2 测试。
2. 抓起期间关闭窗口、换公式、释放指针或失焦，迟到 spawn/落定不能提交，也不能遗留约束。Task 3、5 测试。
3. 原生队列合并本模块与装饰骰投掷时，只抑制本模块的独立消息，不吞其他投掷消息。Task 3 测试。
4. 用户切换为私密模式或在物理消息上进行原生重投，不泄露结果、不继承旧的动画抑制标记。Task 2、6 测试。
5. 空盘可见、窗口 resize、DsN 重建 box 后，不留下原生 ticker/worker 更新或释放共享材质。Task 4、7 测试。

## 执行前的源码依据

PF2e 引用为已核对的 8.5.1 源码；DsN 引用为 `main.js.map` 中的源文件行号。本地研究副本位于 `C:/Users/Taka/Desktop/fvtt/tmp/dsn-tray-research`。

| 要实现的能力 | 已验证的入口 |
| --- | --- |
| 检定身份 | `CheckModifiersDialog.context` 保留引用；`Check.roll` 将 `context.domains` 原样放入 `CheckRoll.options.domains`；core Roll 构造器保留传入 options 引用 |
| 武器伤害身份 | 原生模板浅拷贝 `formulaData`，保留 `base` 数组；最终 `DamageRoll.options.damage.damage.base` 可精确对应窗口 |
| 法术伤害身份 | 包装 `CONFIG.PF2E.Item.documentClasses.spell.prototype.getDamage`；返回的 `result.context` 与窗口 context 相同，`result.template.damage.roll` 是稍后评价的确切对象 |
| 支持入口判断 | `context.type === 'damage-roll'`、`context.self.statistic` 非空、item 为 weapon/melee/spell；内联 statistic 为 null，元素冲击 item 为 action/ability |
| 生成/删除 | `dice3d.persistent.spawn(type, positionPct, opts, synchronize)`；`.remove(persistentId, synchronize)` |
| 无物理预览 | `box.throwEngine.createDiceMesh(type, appearance, diceLibrary, scopedTextureCache)` 返回 `{dicemesh,diceobj,mass}`；cache.type 用自定义值避开 worker.createShape |
| 抓取/旋转/释放 | `inputHandler._beginPersistentGrab(meshes,pos)`、`._activatePreRoll()`、`.onMouseMove(event,ndc)`、`.onMouseUp(event)` |
| 收值 | `manager.onQueueThrow({heldDice,velocity,forcedByMesh,roll,primaries})` + enqueue promise + `throwEngine.handlePersistentThrowCompletion` 确认成功 |
| 重建 | 包装当前实例 `dice3d._buildDiceBox`，等待新 box.ready；resize 没有另发公开 ready hook |
| 静态渲染 | `box.scene.add(group)`、`box.renderScene()` 不添加 ticker；CSS 保持宿主可见，不设置 box.isVisible 或伪造 persistentDiceList |

`CONFIG.PF2E` 路径与具体 prototype 在实际运行时必须确认存在；缺失时此路径禁用物理输入。不得凭公式、用户或“下一个 Roll”补猜。

## 文件与公共接口

最终运行文件以以下职责组织。保留现有 `constants.js`、`settings.js`、`main.js` 文件名，其他旧整合入口在 Task 6 统一移除。

| 文件 | 职责 |
| --- | --- |
| `scripts/session.js` | 会话、代次、已落定槽、一次提交及取消 |
| `scripts/descriptors.js` | 从有效原生公式/骰项生成稳定 key、termPath、faces、flavor |
| `scripts/pf2e-dialogs.js` | 原生 render/close/focus、入口能力判断及身份载体 |
| `scripts/result-bridge.js` | exact Roll 绑定、单骰注入及当前消息版本标记 |
| `scripts/dsn-adapter.js` | 本轮 DsN 私有接口的唯一适配点，投掷完成与资源清理 |
| `scripts/tray-view.js` | 三维托盘、预览、按需重绘、布局和透明命中区 |
| `scripts/gestures.js` | 长按、提升、指针/键盘、取消状态机 |
| `scripts/constants.js` | ID、版本、四项设置与按需日志 |
| `scripts/settings.js` | 设置注册与旧客户端偏好迁移 |
| `scripts/main.js` | 生命周期装配与可执行诊断 API |

所有接口用 JS + JSDoc，实现不引入 TypeScript 编译步骤。下列结构定义是各任务共同约定：

```js
// Descriptor = { key:string, termPath:string, ordinal:number,
//                faces:number, flavor:string|null }
// SettledValue = { key:string, value:number }
// BatchToken = { sessionId:string, generation:number }
// SessionSnapshot = { id:string, kind:'check'|'damage', mode:string,
//                     descriptors:Descriptor[], values:SettledValue[] }
// PointerSample = { clientX:number, clientY:number, timeStamp:number }
// Rect = { left:number, top:number, width:number, height:number }
// Dispose = () => void
// Session = 返回自 createSession 的对象，具有只读 id/appId/userId/kind/mode/
//           descriptors/generation/status；status 为 open/grabbing/flying/
//           settled/submitted/cancelled；方法见 Task 1。
// DescriptorResult = {descriptors:Descriptor[],fingerprint:string}
// QaResult = {caseId:string,ok:boolean,evidence:string}
```

## Task 1: 建立可取消、一次消费的检定会话

**Files:** Create `package.json`, `scripts/session.js`, `tests/session.test.mjs`；恢复安装快照中的 0.4.10 修改；Modify `.gitignore`（新增 `.worktrees/`、`qa/`）。

**Interfaces:**
- Produces `createSession({id,appId,userId,kind,mode,descriptors}):Session`。
- session 提供 `startBatch():BatchToken`、`attachDie(token,key,persistentId):boolean`、`settle(token,values):boolean`、`prepareSubmit():SessionSnapshot|null`、`replace({mode,descriptors}):void`、`cancel(reason):void`。
- 只读字段为共同类型中的 Session 字段；`setFlight(token):boolean` 将已抓持批次标记为 flying，`isCurrent(token):boolean` 比较 session ID、generation 和未终止状态。外部不能直接写 status/generation。
- `settle` 的输入为 `{persistentId,value}` 数组；只接受本代次已登记 ID，验证整数及 faces 范围。重复 ID、未知 ID、重复 settle、旧代次都拒绝。

- [ ] **Step 1: 恢复基线并写失败测试。** 在执行用的独立开发位置，将快照的 scripts/lang/styles/templates 与根 manifest/README/changelog 复制过去，保留本次 docs；比较去除行尾差异的 diff。添加 `package.json`：

```json
{"private":true,"type":"module","scripts":{"test":"node --test tests/*.test.mjs","check":"node scripts-dev/check.mjs"}}
```

`tests/session.test.mjs` 必须含以下测试及一个部分提交测试：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../scripts/session.js';
const descriptors = [{key:'a',termPath:'0',ordinal:0,faces:20,flavor:null}];
const make = () => createSession({id:'s',appId:1,userId:'u',kind:'check',
  mode:'public',descriptors});
test('cancel prevents late settling or submission', () => {
  const s = make(), token = s.startBatch();
  assert.equal(s.attachDie(token,'a','die-a'),true);
  s.cancel('close');
  assert.equal(s.settle(token,[{persistentId:'die-a',value:19}]),false);
  assert.equal(s.prepareSubmit(),null);
});
test('submission consumes confirmed values exactly once', () => {
  const s = make(), token = s.startBatch();
  s.attachDie(token,'a','die-a');
  assert.equal(s.settle(token,[{persistentId:'die-a',value:19}]),true);
  assert.deepEqual(s.prepareSubmit().values,[{key:'a',value:19}]);
  assert.equal(s.prepareSubmit(),null);
});
```

- [ ] **Step 2:** Run `node --test tests/session.test.mjs`。预期新模块缺失而失败。补充未知 ID、NaN/0/21、flavor 改变、私密切换、提交时仍有飞行骰的案例。
- [ ] **Step 3:** 实现会话。所有异步来源只使用 generation；`replace` 清空旧值并递增 generation；`prepareSubmit` 冻结已落定值、使未完成回调失效，并只返回一次。

```js
function validValue(descriptor, value) {
  return Number.isInteger(value) && value >= 1 && value <= descriptor.faces;
}
// startBatch / replace / cancel 均递增 generation。
// attachDie 和 settle 必须同时检查 token.sessionId 与 token.generation。
// prepareSubmit 返回 structuredClone 的快照，不能暴露可变槽 Map。
```

- [ ] **Step 4:** Run `node --test tests/session.test.mjs`，确认所有状态与值边界测试通过。
- [ ] **Step 5:** 精确 stage 本任务文件及恢复的 0.4.10 差异，commit `feat: add isolated physical roll sessions`。不 stage QA 数据、父 fvtt 仓库或发布产物。

## Task 2: 精确绑定原生 PF2e Roll，提取正确骰项

**Files:** Create `scripts/descriptors.js`, `scripts/pf2e-dialogs.js`, `scripts/result-bridge.js`, `tests/descriptors.test.mjs`, `tests/result-bridge.test.mjs`, `tests/fixtures/pf2e-rolls.mjs`。

**Interfaces:**
- Consumes Task 1 sessions。
- `describeDice(roll):Descriptor[]` 遍历原生解析骰项，包含嵌套路径及 ordinal；flavor 从实例伤害类型与 term options 获取。
- `describeDamageDialog(app,html,RollClass):{descriptors,fingerprint}` 读取原生 getData 的最终 instance HTML，用原生解析器解析每个实例表达式。描述符 termPath 为 `instanceIndex/dieIndex`，避免因渲染时省略外层 Grouping 造成路径漂移。
- `supportsPhysicalDialog(app):boolean` 按版本与上述原生入口判断。
- `createRollBindings()` → `{beginCheck(context),endCheck(invocation),armCheck(app,session),armWeaponDamage(app,session),bindSpellResult(result),resolve(roll),release(sessionId)}`。invocation 包含 originalDomains 和独立 channel；每个 Check.roll 包装调用用 try/finally 结束其 invocation。
- `evaluateWithSnapshot(roll,snapshot,wrapped,args):Promise<Roll>` 仅修改匹配 term 的单实例 `roll()`，finally 恢复。
- `installPf2eBridge({onDialog,onClose,onFocus,getSnapshot}):Dispose` 注册必要 hooks/libWrapper；不触碰原生 DOM 布局。
- 回调约定：`onDialog(app,DescriptorResult):void`、`onClose(app,submitted:boolean):void`、`onFocus(app):void`、`getSnapshot(sessionId):SessionSnapshot|null`。`createRollBindings` 的 `resolve` 返回 `Session|null`；`bindSpellResult` 返回 boolean，`beginCheck` 返回 invocation，其他方法返回 void。
- `tests/fixtures/pf2e-rolls.mjs` 导出 `makeCheckRoll(options={}):{options,dice,evaluate}` 和 `makeDie(faces,randomValue):DieFixture`。fake evaluator 按各 die.number 次数调用实例 roll，options 对象按引用保留；不能使用实际随机数。后续 Task 6 复用此 fixture。

- [ ] **Step 1: 写身份与注入失败测试。** fixture 使用独立的两个 context、相同公式、同面数不同 flavor 的原生形状对象，禁止以用户/公式作为匹配器。

fixture 的最小实现如下；DieFixture 的 results 是原生形状 `{result,active}` 数组：

```js
export function makeDie(faces, randomValue) {
  return {faces,number:1,options:{},results:[],roll() {
    const value={result:randomValue,active:true};
    this.results.push(value); return value;
  }};
}
export function makeCheckRoll(options={}) {
  return {options,dice:[makeDie(20,11)],async evaluate() {
    for(const die of this.dice) for(let n=0;n<die.number;n++) die.roll();
    return this;
  }};
}
```

```js
test('identical concurrent checks use domains identity', () => {
  const bindings = createRollBindings();
  const a = {context:{domains:['skill-check']}}, b = {context:{domains:['skill-check']}};
  bindings.beginCheck(a.context); bindings.beginCheck(b.context);
  bindings.armCheck(a,{id:'a'}); bindings.armCheck(b,{id:'b'});
  assert.equal(bindings.resolve({options:{domains:a.context.domains}}).id,'a');
  assert.equal(bindings.resolve({options:{domains:b.context.domains}}).id,'b');
  assert.equal(bindings.resolve({options:{domains:['skill-check']}}),null);
});
test('physical and RNG terms each append one result', async () => {
  const term = {faces:6,results:[],roll(){ const r={result:4,active:true}; this.results.push(r); return r; }};
  const roll = {dice:[term],options:{}};
  const snapshot = {id:'s',kind:'damage',mode:'public',
    descriptors:[{key:'a',termPath:'0',ordinal:0,faces:6,flavor:null}],
    values:[{key:'a',value:6}]};
  const original = term.roll;
  await evaluateWithSnapshot(roll,snapshot,async()=>{term.roll();term.roll();return roll;},[]);
  assert.deepEqual(term.results.map(r=>r.result),[6,4]);
  assert.equal(term.roll,original);
});
```

另写异常恢复、两个同 faces 不同 flavor 项、固定值 substitution 不生成 d20、fortune+misfortune 抵消、暴击 doubledice、RE 公式已解算、d100 1/10/100、私密模式、共享 context 禁用和原生 reroll 不消费旧绑定。

- [ ] **Step 2:** Run `node --test tests/descriptors.test.mjs tests/result-bridge.test.mjs`，确认红灯来自缺失接口或行为。
- [ ] **Step 3: 实现引用载体。** 包装 `game.pf2e.Check.roll`，在每次调用入口用内容相同的独立 domains 数组建立 invocation，再把原函数收到的同一 context 交给它。render 将 session 关联到该 channel。同 context 被多个活跃调用复用时，关联窗口全部禁用或取消物理抓取，不猜绑定。finally 只在 context 仍持有本调用 channel 时恢复原 domains，不能覆盖后来的调用。

```js
const checkByDomains = new WeakMap();
const weaponByBase = new WeakMap();
const spellByContext = new WeakMap();
const exactRoll = new WeakMap();
// Check: app.context.domains = [...(app.context.domains ?? [])];
// 上行实际在 beginCheck(context) 执行；render 只读取该 channel。
// checkByDomains 存 invocation，armCheck 将 invocation.session 设为本 session。
// Weapon: weaponByBase.set(app.formulaData.base, session);
// Resolve weapon via roll.options.damage?.damage?.base。
// Spell getDamage wrapper: 查 result.context，绑定 result.template.damage.roll。
```

绑定在窗口关闭后保留到 native Roll handoff/evaluate 成功或取消；UI 关闭与结果消费分别清理。武器用 `base` 身份，法术用确切返回 Roll，Check 用 domains 身份。自定义或版本不符的入口不得启用抓取。

- [ ] **Step 4: 实现描述符和注入。** Check 公式按 PF2e 8.5.1 对 substitution/fortune/misfortune 的同样选择。伤害从 render hook 的 data.formula 或原生 submit 内 `.damage.instance` 节点提取每实例表达式，伤害类型从 classList 与 CONFIG.PF2E.damageTypes 交集读取；只移除无文字图标，规范化 `×`/`−`，交给原生 RollClass 解析。按原生实际 Roll 的 instance/die 顺序构造路径，不重复计算 RE 公式，不全局正则抽骰数/猜类型。缺少合法 instance 表达式时禁用本次物理输入。保留 0.4.10 的单个 `Die.roll` 语义；按 termPath/ordinal 分配值。

```js
// 对每个目标 term 保存 original 和 hadOwn；不修改 DiceTerm prototype。
term.roll = function(options = {}) {
  if (!values.length) return original.call(this,options);
  const result = {result:values.shift(),active:true};
  this.results.push(result);
  return result;
};
// finally: hadOwn ? term.roll = original : delete term.roll。
// 无绑定时删掉 clone 继承的本模块 physical revision 标记，再调用 wrapped。
```

法术 handoff 如果异常缺少预期 Roll，在原始伤害调用返回 null，并提示“检定未提交”，不将已经展示的骰面更换为随机数。诊断记录路径与版本，不记录用户私密点数。

- [ ] **Step 5:** Run 本任务测试。验证纯 RNG Roll、跳过窗口、flat check 和 native reroll 全部透传；commit `feat: bind physical values to exact PF2e rolls`。

## Task 3: DsN 6.4.1 原生投掷适配与落定证明

**Files:** Create `scripts/dsn-adapter.js`, `tests/dsn-adapter.test.mjs`, `tests/fixtures/dsn-runtime.mjs`。

**Interfaces:**
- `createDsnAdapter({dice3d,onSettled,onBoxChanged,getSessionForDie})`。
- 返回 `ready():Promise<boolean>`、`createPreview(descriptor):Promise<Object3D>`、`spawn(session,descriptor,positionPct):Promise<Mesh|null>`、`beginGrab(session,meshes,sample):Promise<boolean>`、`moveGrab(sample):void`、`releaseGrab():Promise<boolean>`、`cancelGrab():Promise<void>`、`removeSession(sessionId):Promise<void>`、`mountTray(group):Dispose`、`renderTray():void`、`dispose():Promise<void>`。
- 只读 getter `canvas:HTMLCanvasElement|null`、`box:DiceBox|null`、`boxGeneration:number`，给 Task 4 布局与 Task 5 代次检查使用。`onBoxChanged(box,generation):void`。`getSessionForDie(persistentId):{session:Session,token:BatchToken,key:string}|null` 必须返回完整所有权记录。
- `onSettled(token,{persistentId,value}[])` 仅在成功 native landing 且 session/box 代次仍有效后调用。

- [ ] **Step 1: 写原生 callback fixture 与失败测试。** fixture 暴露与已核对源码相同的 callback、queue、worker 和 completion 边界，测试不以 sleep 等待结果。

`tests/fixtures/dsn-runtime.mjs` 明确定义 `makeDsnRuntime({queueResult=true,simulate=true}={}):DsnFixture`。DsnFixture 是带观测字段的 dice3d：具有 persistent.spawn/remove、box.scene/inputHandler/throwEngine/persistentDiceManager、queue.enqueuePersistent、box.ready、_buildDiceBox、_fadeOutCanvas。方法签名与本任务源码依据一致。enqueue 保存 `lastEnqueue`；simulate=false 时直接返回 queueResult，不能调用 completion；simulate=true 时先为目标 mesh 创建 native persistentThrow/sim metadata，再调用 completion，最后返回 queueResult。它还提供 `triggerOwnedThrow(sessionId,generation,value):Promise<void>`，构造固定 primary mesh、forcedByMesh 与辅助 Roll 后调用 manager.onQueueThrow。所有权 fixture 通过下面的明确返回结构关联到该 primary；不靠 pendingId 猜测归属。

```js
test('queue success without native completion cannot settle', async () => {
  const runtime = makeDsnRuntime({queueResult:true,simulate:false});
  const settled=[];
  const adapter=createDsnAdapter({dice3d:runtime,onSettled:(...x)=>settled.push(x),
    onBoxChanged:()=>{},getSessionForDie:()=>({session:{id:'s',mode:'public',
      generation:1,isCurrent:()=>true},token:{sessionId:'s',generation:1},key:'a'})});
  await adapter.ready();
  await runtime.triggerOwnedThrow('s',1,7);
  assert.deepEqual(settled,[]);
});
test('unrelated throw keeps its auxiliary chat roll', async () => {
  const runtime=makeDsnRuntime();
  const adapter=createDsnAdapter({dice3d:runtime,onSettled:()=>{},
    onBoxChanged:()=>{},getSessionForDie:()=>null});
  await adapter.ready();
  const roll={total:12};
  await runtime.box.persistentDiceManager.onQueueThrow({heldDice:[],primaries:[],
    velocity:{x:1,y:1,z:0},forcedByMesh:new Map(),roll});
  assert.equal(runtime.lastEnqueue.roll,roll);
});
```

还需 cover：桥接与装饰骰队列合并、队列返回 false、simulateThrow 无 payload、关闭期间 await spawn、d100 组合与辅助 Roll 顺序、旧 result 不复用、公开跨端 forced values 一致、mine 临时可见恢复。

- [ ] **Step 2:** Run `node --test tests/dsn-adapter.test.mjs`，确认红灯。
- [ ] **Step 3: 实现能力检查和临时骰。** 锁定方法/版本，任何缺失都令 ready 返回 false。外观通过现有 factory resolver 获取；预览 cache.type=`bridge-tray-preview`，不能调用 worker.createShape。完整实例使用 `persistent.spawn`；guest 标识 `{pendingId:session.id,reservedForUserId:session.userId}` 防止写入用户永久骰旗标并保证所有权。不把 module guest 误注册为 DsN pending interactive roll。测试原生 guest/pending 清理不会抢走本模块会话，且删除时不保存永久旗标。

DsN 6.4.1 已删除 constructor.APPEARANCE/CONFIG/ALL_CONFIG。在本适配器实现 `resolveAppearance(user,descriptor)`：读取 basic role.defaults、当前 user/actor appearance flags 与包默认值，使用 exports.Utils.contrastOf/sanitizeAppearance 合并；factory.detectRole 读取 descriptor flavor/type，factory.getAppearanceForDice 配合 persistent._persistentRoleContext 与 diceLibrary.constructor.getLibraryForUser。合并顺序照本地研究副本 DsnSettings.APPEARANCE，不能用陈旧 box.config.appearance 快照。添加改变 DsN 设置后下一次预览/完整骰外观相同的测试。

```js
const cache={...box.renderer.scopedTextureCache,type:'bridge-tray-preview'};
const created=await box.throwEngine.createDiceMesh(type,appearance,library,cache);
const preview=created?.dicemesh;
// 预览不进入 persistentDiceList；preview geometry/material 属于 DsN 缓存。
// spawn 后用 persistentId -> session/token/key Map 记录，仅 module 本地消费。
```

- [ ] **Step 4: 实现捕获、完成与取消。** 仅包装当前 manager.onQueueThrow；完整批次的持有骰必须全部属于同一公开会话，否则不改原调用。复制 primaries / forcedByMesh / 原生辅助 Roll 的逻辑值，再将本模块 queue entry 的 roll 设为 null。辅助 Roll 保留于该 batch context，保证 advanced total SFX 的确切匹配，不影响其他批次。

```js
const frozen = captureOwnedBatch(throwData); // 校验所有 ID 与代次
if (!frozen) return originalQueue(throwData);
const queued=await originalQueue({...throwData,roll:null});
if (queued && landed.has(frozen.batchId) && stillCurrent(frozen.token)) {
  onSettled(frozen.token,frozen.values);
}
```

`captureOwnedBatch` 和 `stillCurrent` 是本适配器内部函数，在本步骤实现；capture 对 d100 从辅助 Roll 的 primary 逻辑结果取 1–100，校验对应 forced digit，落定后才收值。`landed` 只能由原生 `handlePersistentThrowCompletion` 成功且含本 batch metadata 后标记；queue=true 本身不够。

取消按以下顺序执行：标记 token 失效 → 解除 worker 约束、清 native input held state → 恢复 Foundry 鼠标交互 → 删除该会话完整实例 → 删除本地 ID Map。每个 await 后检查 generation，新生成但已失效的 mesh 立即删除。

- [ ] **Step 5:** Run 本任务测试。`startUnifiedBatch` 对公开 foreign throws 在 mine 模式只暂显这些 ID，回调/finally 恢复当前可见性和 collision response；none 保持隐藏。原生 remote replay 直接使用 forced values，不生成 RNG。commit `feat: adapt native DsN grabs and settled batches`。

## Task 4: 三维八角托盘与无物理小骰子预览

**Files:** Create `scripts/tray-view.js`, `tests/tray-view.test.mjs`；Rewrite `styles/dsn-bridge.css` 为独立宿主/命中区/焦点样式。

**Interfaces:**
- `octagonPoints(radius):Array<[number,number]>`、`dockRect(viewport,width,reservedRects):Rect`。
- `releasePreview(parent,preview):void` 只做 parent.remove(preview)，不 dispose 预览资源。此小函数同时被 clear/过期 show/dispose 使用，测试能够直接验证真实清理规则，无需模拟整个 Three.js 渲染器。
- `createTrayView({adapter,THREE,document,getReservedRects})` → `{mount(),show(session),clear(),setSize(px),dispose(),element}`。
- `show` 为 async，缓存 session generation；过期预览只移除 mesh，不释放缓存资源。
- 使用 adapter.mountTray(group)/renderTray，视图不直接改原生 ticker。

- [ ] **Step 1: 写布局、资源和空闲重绘失败测试。**

```js
test('octagonal outline has eight equal-radius vertices', () => {
  const points=octagonPoints(1);
  assert.equal(points.length,8);
  for(const [x,y] of points) assert.ok(Math.abs(Math.hypot(x,y)-1)<1e-9);
});
test('removing preview does not dispose borrowed dice resources', async () => {
  let disposed=0;
  const mesh={geometry:{dispose:()=>disposed++},material:{dispose:()=>disposed++}};
  const children=[mesh],parent={remove(item){children.splice(children.indexOf(item),1);}};
  releasePreview(parent,mesh);
  assert.deepEqual(children,[]);
  assert.equal(disposed,0);
});
```

另测：展开 sidebar 与宏栏避让；100 个小骰子的稳定布局不越盘沿；show A 后 show B，A 迟到 preview 不加入；空盘保持可见但 tickerAdd/workerStep 计数不增加；新 box 替换旧 box 后旧 Group 已移除。

- [ ] **Step 2:** Run `node --test tests/tray-view.test.mjs`，确认红灯。
- [ ] **Step 3: 实现几何与停泊位置。** 使用 THREE.Shape/ExtrudeGeometry 构造八角底面与低盘沿；仅两个 MeshStandardMaterial，不加独立灯光/后处理。盘沿低于 normal die 高度，preview 使用独立容器缩放与排列。

```js
export function octagonPoints(radius) {
  return Array.from({length:8},(_,i)=>{
    const angle=Math.PI/8+i*Math.PI/4;
    return [Math.cos(angle)*radius,Math.sin(angle)*radius];
  });
}
// 外圈与内孔相反 winding；shape 在 XZ 桌面，Y 为低厚度。
// 原生相机垂直俯视：只将 tray Group 绕局部 X 倾斜约 22°，
// 抬高中心避免低于桌面；不能改变共享相机。
// 基于当前 canvas boundingRect 算 NDC，以相机 ray 到桌面的交点定位。
// 投影盘沿顶点回 CSS 坐标，在 2–3 次同步迭代中拟合目标停泊 Rect；
// 不把 display.innerWidth 或旧 LEGACY_TO_METERS 当作 CSS 换算比例。
// 预览按 Box3 实际边界归一化，并应用原生 modelScale。
```

默认 220px，可配置 160–320px。使用透明 DOM 命中区覆盖托盘投影，只有此区域接收 pointer events；盘外不阻塞 Foundry 画布。空盘无标题，aria-label 与 tooltip 简短；私密/unsupported 状态用小图标，不能使原生 Roll 不可用。

- [ ] **Step 4: 实现静态宿主与 box 重建。** 仅由 adapter 给 DsN canvas 加模块 CSS class，使 display/opacity 保持可见。实例 `_fadeOutCanvas` 覆盖为 ephemeral fade，保留 tray Group；不设置 `box.isVisible`、不伪造持久骰列表。包装实例 `_buildDiceBox`，新 box.ready 后重挂 group/preview；旧 generation 的 await 不得挂回。

```css
canvas.pd-tray-mounted { display:block !important; opacity:1 !important; }
.pd-tray-hit { position:fixed; background:transparent; border:0; touch-action:none; }
.pd-tray-hit:focus-visible { outline:2px solid var(--color-border-highlight); outline-offset:3px; }
```

实际宿主 ID 从 adapter.canvas 获取并加 class，不依赖选择器猜测元素。主题、resize、内容改变调用一次 renderTray；dispose 恢复原样式与包装函数，只释放自建 geometry/material。

- [ ] **Step 5:** Run 本任务测试，commit `feat: render an idle octagonal tray in the DsN scene`。

## Task 5: 长按整把抓取、放大旋转与释放

**Files:** Create `scripts/gestures.js`, `tests/gestures.test.mjs`。
测试支持文件：Create `tests/fixtures/gesture-harness.mjs`。

**Interfaces:**
- `createGestureController({element,adapter,getSession,setTimeout,clearTimeout,onState}):Dispose`。
- `getSession():Session|null`；`onState(state,{sessionId,token,progress}):void` 通知 view 更新 armed 抬起/150ms 提升反馈，progress 为 0–1，非提升阶段为 null；callback 不能发起评价或改写 session。
- controller 状态为 idle / pressing / armed / lifting / held / releasing；不会评价 PF2e Roll。armed 仅握住预览，不产生物理实例；拖离投影盘面或从按下点移动 12px 才进入 lifting。键盘在 300ms 后直接 lifting。
- 保持最后 PointerSample；mouse 主键与键盘空格可用，非主指针不启动。键盘焦点必须在 tray element。
- `makeGestureHarness():GestureHarness` 在上述测试文件导出。element 是 EventTarget，补 setPointerCapture/releasePointerCapture/getBoundingClientRect；adapter 的 spawn 使用手动 deferred，beginGrab 即时成功。返回 pointerDown/pointerUp（dispatch pointer events）、advance(ms)（推进注入 fake clock）、resolveSpawn(id)/resolveAllSpawns（完成 deferred）、flush():Promise<void>（清空 promise microtasks）；adapter 观测 spinCalls/releaseCalls/removed。禁止 harness 自己实现 controller 的取消/投掷逻辑。

- [ ] **Step 1: 写时间、代次与释放失败测试。** 注入 timer 与 adapter deferred promises，避免真实 300ms sleep。

fake clock 与 deferred 的实际基础代码如下，harness 只将其接到上述 controller 参数：

```js
export function deferred() {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
export function fakeClock() {
  let now=0,id=0; const pending=new Map();
  return {setTimeout(fn,ms){pending.set(++id,{at:now+ms,fn});return id;},
    clearTimeout(timer){pending.delete(timer);},advance(ms){
      now+=ms;
      for(const [timer,item] of [...pending]) if(item.at<=now) {
        pending.delete(timer); item.fn();
      }
    }};
}
```

```js
test('release during async lift removes late dice and never throws', async () => {
  const h=makeGestureHarness();
  h.pointerDown(); h.advance(300); h.pointerMove(20,0); h.pointerUp();
  h.resolveSpawn('new-die'); await h.flush();
  assert.equal(h.adapter.releaseCalls,0);
  assert.deepEqual(h.adapter.removed,['new-die']);
});
test('held stationary release calls native throw exactly once', async () => {
  const h=makeGestureHarness();
  h.pointerDown(); h.advance(300); h.pointerMove(20,0);
  h.resolveAllSpawns(); await h.flush();
  h.pointerUp(); h.pointerUp(); await h.flush();
  assert.equal(h.adapter.spinCalls,1);
  assert.equal(h.adapter.releaseCalls,1);
});
```

另测短按、armed 状态松手不投掷、移动后甩出方向、Esc、pointercancel、blur、窗口关闭、模式切换、空格 auto-repeat、盘外 pointerdown 与装饰骰位于托盘后方。harness 的 `pointerMove(dx,dy):void` 更新位置并派发 pointermove。

- [ ] **Step 2:** Run `node --test tests/gestures.test.mjs`，确认红灯。
- [ ] **Step 3: 实现 press/lift。** 300ms 前 release 只取消；达到阈值进入 armed 并给预览轻微抬起反馈。达到上述移动阈值（键盘自动）后冻结 session token，生成全部正常尺寸骰子，检查 await 后 token；约 150ms 放大过渡只在提升期间运行。armed 松手恢复预览，不生成或投掷骰子。

```js
const token=session.startBatch();
const meshes=await Promise.all(session.descriptors.map(d=>adapter.spawn(session,d,positionPct)));
if (!pressIsCurrent(token)) { await adapter.removeSession(session.id); return; }
await adapter.beginGrab(session,meshes.filter(Boolean),latestSample);
// beginGrab 设置 native mouse.pos/constraintDown，关闭 Foundry 鼠标交互，
// _beginPersistentGrab 后立即 _activatePreRoll。
```

`pressIsCurrent` 在本步骤实现并检查 pointer/session/box 三种 generation；部分 spawn 失败取消整把抓取并恢复预览，不留下看似完整的检定。

- [ ] **Step 4: 实现 move/release/cancel。** capture pointer；坐标以当前 canvas boundingRect 计算 NDC；原生 onMouseMove 更新约束与旋转。release 只调用原生 onMouseUp 一次，已 preRoll 的 stationary release 会自动给最小初速度；flick 沿原生最近 80ms 轨迹处理。

```js
function toNdc(sample,rect) {
  return {x:2*(sample.clientX-rect.left)/rect.width-1,
    y:1-2*(sample.clientY-rect.top)/rect.height};
}
// 每次 finish 都释放 pointer capture，取消 timer，并恢复鼠标交互。
// 取消直接调用 adapter.cancelGrab，不模拟 mouseup 触发投掷。
```

键盘空格复用同一状态机，按住点在 tray 中心；重按事件 ignored。pointercancel/blur/Esc 总是走 cancel，不能触发 submit。

- [ ] **Step 5:** Run 本任务测试，commit `feat: add hold lift spin and release gestures`。

## Task 6: 装配、原生按钮、精简设置与旧代码删除

**Files:** Rewrite `scripts/main.js`, `scripts/constants.js`, `scripts/settings.js`, `lang/en.json`, `lang/zh-CN.json`, `README.md`, `module.json`；Create `tests/lifecycle.test.mjs`, `tests/message-revision.test.mjs`, `scripts-dev/check.mjs`, `.github/workflows/check.yml`。
测试支持文件：Create `tests/fixtures/bridge-harness.mjs`。

删除：`ui-injector.js`, `slot-store.js`, `slot-extractor.js`, `matcher.js`, `spawn-helper.js`, `socket.js`, `dsn-listener.js`, `dsn-suppressor.js`, `dsn-visibility.js`, `ephemeral-mirror.js`, `foreign-mirror-cleaner.js`, `right-click-throw.js`, `shake-sensitivity.js`, `perf-preset.js`, `restrict-persistent-spawn.js`, `welcome.js`, `reroll-handler.js`, `evaluate-wrapper.js`, `rng-guardian-compat.js`, `show-breakdown.js`, `templates/slot-tray.hbs`。`compat.js` 的检查合并到 adapter/bootstrap 后删除；`pf2e-colorsets.js` 仅当 native 伤害外观覆盖测试证明已有全部所需类型时删除，否则保留精简注册函数。

**Interfaces:**
- Consumes Tasks 1–5 全部接口。
- `game.modules.get(ID).api.diagnose()` 返回版本、能力、session 数量与 owned instance 数量，不包含私密点数。
- 提供测试世界使用的 `api.runChecks():Promise<QaResult[]>`，只创建合成测试 Roll/session，不访问生产角色或改变 GM 设置。
- 从 main 导出 `createBridge({pf2e,dice3d,view,gestures,getSetting})`，提供 `enable():Promise<void>`、`disable():Promise<void>`、`openDialog(app,DescriptorResult):Session|null`、`changeDialog(app,DescriptorResult):void`、`closeDialog(app,submitted:boolean):void`、`diagnose():{versions,capabilities,sessionCount,ownedInstanceCount}`。所有运行依赖通过参数注入；bootstrap 使用真实依赖，fixture 使用上游形状对象，不能复制集成逻辑。
- `makeBridgeHarness()` 使用 createBridge 和前述真实 session/绑定代码，返回 `openPublicCheck():Session`、`setMessageMode(mode):void`、`deliverLanding(token,value):Promise<void>`、只读 submitCount/nativePrivatePath。`evaluateUnboundNativeRoll(roll):Promise<Roll>` 经安装的 result-bridge wrapper 调用 fixture evaluate；`shouldSuppressRevision(roll):boolean` 为 adapter 纯函数，只检查 roll 当前 revision 是否为本次已记录 physical revision，不能以有字段即抑制。
- 新设置沿用 `enabled`、`autoSubmitOnFill`、`verboseLogging` 的现有 key，新增 `traySize`；移除其他 config:true 项。

- [ ] **Step 1: 写整个生命周期与消息版本失败测试。**

```js
test('changing public throw to private invalidates its late result', async () => {
  const h=makeBridgeHarness();
  const token=h.openPublicCheck().startBatch();
  h.setMessageMode('blind'); await h.deliverLanding(token,19);
  assert.equal(h.submitCount,0);
  assert.equal(h.nativePrivatePath,true);
});
test('ordinary reroll removes cloned physical suppression', async () => {
  const roll=makeCheckRoll({pdPhysicalRevision:'old'});
  await evaluateUnboundNativeRoll(roll);
  assert.equal(roll.options.pdPhysicalRevision,undefined);
  assert.equal(shouldSuppressRevision(roll),false);
});
```

`evaluateUnboundNativeRoll` 为 fixture 调用已安装 result-bridge wrapper；`shouldSuppressRevision(roll)` 是本任务在 dsn-adapter 导出的纯消息版本判定函数。另测原生按钮在 pressing/held/flying 状态只提交一次且仅取已落定值；关闭 UI 不提前销毁已提交绑定；关闭模块即移除托盘/listeners/held instances；native RNG 无额外 resolver；语言 key 全部存在。

- [ ] **Step 2:** Run `node --test tests/lifecycle.test.mjs tests/message-revision.test.mjs`，确认红灯。
- [ ] **Step 3: 装配顺序与重复动画。** init 注册四项设置；ready 校验版本后安装 adapters/view/gesture/dialog observers；优先显示空盘。session 全填成功后只调用原生 form.requestSubmit() 一次。capture submit 阶段冻结 session，关闭 UI 与 evaluate handoff 分离。

```js
// physical evaluate 成功后给当前 roll.options 标记唯一 pdPhysicalRevision。
// diceSoNiceMessagePreProcess 仅抑制本次新 physical revision；
// native reroll 的新 Roll 无绑定，evaluate wrapper 会清 marker。
// 不给整条历史消息永久写 skip=true，不对更新后的 RNG 消息继续抑制。
```

消息更新来自已评价 Roll 时也检查新 revision，不能仅查历史 messageId。不得 patch 已删除的 game.dice3d._roll。

- [ ] **Step 4: 删除旧入口并更新配置文案。** README 仅保留打开检定、长按抓起、松手投掷、原生按钮和私密/不支持入口说明。中文统一“骰盘”“自动提交”“详细日志”；不保留 spawn/RNG/鬼骰仪式等玩家文案。

```js
// registerSettings: enabled(world), traySize(client,220,range160..320),
// autoSubmitOnFill(client,true), verboseLogging(client,false)。
// 保留 enabled/autoSubmitOnFill/verboseLogging 原 key 与既有值。
// traySize 无旧值时使用220。迁移版本写本模块客户端 flag，只执行一次。
// 旧 autoSpawnDice/快捷控件设置停止读取，与新设计的按检定生成规则相容。
// 不删除旧数据库条目以便回退；不写其他模块 settings。
// 旧 Guardian ignore 列表不主动改回。
```

世界 enabled=false 始终不挂载/生成/包装。设置变更立即取消会话并卸载；重新启用时重新核对依赖并装配，不依赖隐藏偏好或强制刷新。

manifest 改为 Foundry minimum 14.361 / verified 14.368、PF2e minimum/verified 8.5.1、DsN minimum/verified 6.4.1，保留 libWrapper；若不再有自有 socket 则 socket=false。本地候选版本 0.5.0，download URL 相应指向未来 v0.5.0，不能称已有发布。

- [ ] **Step 5: 检查与提交。** `scripts-dev/check.mjs` 对每个 scripts JS 执行 `node --check`，解析 manifest/lang JSON，检查 manifest 指定文件存在；CI 使用 Node 24 执行 `npm test`。Run `npm test`、`npm run check`、`git diff --check`；确认无旧入口 import、自动欢迎消息、周期扫骰或 Guardian 设置写入。commit `refactor: replace legacy tray and simplify native integration`。

## Task 7: 真实 Foundry 浏览器与双客户端验收

**Files:** Create `scripts-dev/live-checks.mjs`, `docs/qa-20260930.md`；QA 输出仅写忽略的 `qa/`。若发现 bug，修改其所属任务文件并补回归测试。

**Interfaces:**
- `live-checks.mjs` 调用隔离测试世界的诊断/合成场景，输出 `{caseId,ok,evidence}`；不能用纯 fixture 成功冒充真实运行成功。
- 验证矩阵来自 spec，每项都记录实际版本、操作、骰面、PF2e 输出和是否出现重复消息/动画。

- [ ] **Step 1: 准备隔离环境。** 使用恢复仓库的候选模块、现有 Foundry 14.368 软件、独立 userData/端口和专用测试世界，仅启用 PF2e、DsN、libWrapper 和候选模块。不重启/覆盖 CN 生产实例；创建 GM/PL 两个测试账号及无真实秘密数据的测试角色。

```text
QA 世界：persistent-dice-qa
角色：Test Check（skill +7） / Test Damage（1d8 slashing + 2d6 fire）
测试：d20，2d20kh/kl，混合伤害，double-dice/double-damage，d100，法术 RE。
```

已只读确认软件为 `/root/foundryvtt/main.mjs`（package version 14.368.0），38120 未监听。其 engines 为 Node `>=24.13.1 <25.0.0`，现有 `/usr/bin/node` 为 24.13.0，尚未满足受支持运行时。执行时为 QA 安装独立 Node 24.13.1，复制软件发行目录以隔离核心更新，再使用独立 dataPath；不能升级生产 Node 或重启生产服务。下面命令只在三个目标均不存在时使用，任一已存在则先读该目录状态，不覆盖。

```sh
test ! -e /root/persistent-dice-qa-runtime
test ! -e /root/persistent-dice-qa-software-20260930
test ! -e /root/persistent-dice-qa-20260930
install -d -m 700 /root/persistent-dice-qa-runtime /root/persistent-dice-qa-20260930/Config
curl -fsSL https://nodejs.org/dist/v24.13.1/node-v24.13.1-linux-x64.tar.xz -o /root/persistent-dice-qa-runtime/node.tar.xz
printf '%s\n' '30215f90ea3cd04dfbc06e762c021393fa173a1d392974298bbc871a8e461089  /root/persistent-dice-qa-runtime/node.tar.xz' | sha256sum -c -
tar -xJf /root/persistent-dice-qa-runtime/node.tar.xz --strip-components=1 -C /root/persistent-dice-qa-runtime
cp -a /root/foundryvtt /root/persistent-dice-qa-software-20260930
/root/persistent-dice-qa-runtime/bin/node --version
ss -ltn '( sport = :38120 )'
```

用 shell 的 `set -e` 或逐条检查 exit code，任一步失败即停止本阶段。上述 SHA-256 来自 [Node 官方清单](https://nodejs.org/dist/v24.13.1/SHASUMS256.txt)。Node 必须输出 v24.13.1，端口检查只有表头才继续。独立 Config/options.json 写入以下内容；此路径只写新 QA 配置：

```json
{"dataPath":"/root/persistent-dice-qa-20260930","world":null,"port":38120,
 "unixSocket":"/root/persistent-dice-qa-20260930/foundry.sock","protocol":null,
 "upnp":false,"hostname":null,"localHostname":null,"proxyPort":null,"proxySSL":false}
```

先启动 setup，由授权所有者在 QA 自己的界面输入 key、签署 EULA，再创建上述世界；不复制生产 Config/license.json、admin.txt 或 options.json。[官方许可](https://foundryvtt.com/article/license/)与 [FAQ](https://foundryvtt.com/article/faq/)允许只有所有者能访问的测试实例并行。unixSocket 优先于 TCP port；hostname/localHostname 不是绑定地址。启动与本人电脑隧道为：

```sh
/root/persistent-dice-qa-runtime/bin/node /root/persistent-dice-qa-software-20260930/main.mjs --dataPath=/root/persistent-dice-qa-20260930 --port=38120 --noupnp --noipdiscovery --noupdate
ssh -N -L 127.0.0.1:38120:/root/persistent-dice-qa-20260930/foundry.sock CN
```

第二条在本人电脑执行，浏览器访问 http://127.0.0.1:38120；确认服务器没有新增 TCP 监听。进程仅以独立 stdout/stderr 与 pid 文件记录，结束时按该 pid 停止，不能按名称 kill Foundry。软件/许可若不能启动，只能报告真实未验证项，不声称通过。

- [ ] **Step 2: 执行交互案例。** GM/PL 浏览器核对空盘、打开窗口、300ms 长按、150ms 放大、stationary release、flick、键盘、Esc/blur、原生按钮、双窗口、模式/公式变化、resize、box 重建。每次公开投掷录入实际骰面及 PF2e active results，必须一致。
- [ ] **Step 3: 验证权限与原生路径。** public/mine/none、blind/private/self、native hero-point reroll、元素冲击、内联伤害和跳过窗口；确认私密真实点数未进入公开 DsN throw payload，未支持入口从抓取前即原生处理。
- [ ] **Step 4: 性能与资源采样。** 空盘稳定后连续 5 秒采集 tickerAdd、worker.playStep 调用计数；本模块原因计数必须为 0。连续开关 50 次窗口后 owned mesh/constraint/session 数恢复初始值，共享纹理仍能用于装饰骰与正常 DsN 动画。
- [ ] **Step 4a: 验证独立 Three class copy。** DsN bundle 与官方 libs 为两份 r184 class；使用真实 isObject3D/isMesh 渲染行为确认盘沿/预览可见，不能只以 instanceof 或 scene.children 数量判断成功。
- [ ] **Step 5: 审查与交付候选。** 修复真实失败并仅重跑受影响检查，再执行完整 `npm test` / `npm run check`。安排一次独立代码审查，记录未支持路径和未验证项。制作本地候选 zip（module.json 位于根，排除 git/docs/tests/qa/scripts-dev），不发布。commit `test: verify native dice tray integration`，交付 QA 记录、候选包与代码 review。

## 自检与执行交接

设计中的空盘、长按、放大/旋转、释放、精确结果、原生按钮、保密、多人、性能、重建、文案与删减分别由 Tasks 1–7 覆盖。身份载体、队列完成、静态渲染和 guest 生命周期需要真实集成验证；单测通过不代表它们已适配运行环境。

建议执行方式：**Native**，主代理按任务实施，研究/独立检查可并行，整分支由新 reviewer 审查。任务共享 session/adapter 接口，主代理连续实施能减少交接；如果用户希望逐任务由实现代理及独立审查代理把关，则选 Subagent-driven。

本计划必须经用户审阅并选择执行方式后开始实现。执行时采用已恢复的本地项目作为独立开发工作区，不把产品改动放进父 fvtt 仓库；若创建额外 worktree，需要按实际环境和用户偏好决定。

自检记录（2026-09-30）：已逐项对应 spec 的交互、绑定、权限、外观、清理、性能与删减要求；补齐 session 只读字段、adapter 的 box/canvas/ownership 返回结构及测试 fixture 接口；修正长按与拖离的两阶段状态、私密切换和提交后 UI 关闭的清理边界。Review Focus 五项均有所属任务和实际输入案例。当前只完成文档检查，尚无实现或运行通过声明。
