import { expect, test, type Page } from '@playwright/test';

const state = (page: Page) => page.evaluate(() => {
  const g = (window as any).__LG.getState(), w=g.world;
  return w && { width:w.width,height:w.height,radius:w.radius,civs:Object.values(w.civs).length, population:w.population,
    generation:w.generation, selected:g.selectedEntityId, selectedCell:g.selectedCellId, speed:g.speed,
    day:w.day, energy:w.divineEnergy, impacts:w.impacts.length,
    camera:(window as any).__lgCamera.position.length(), save:g.saveState };
});

async function start(page: Page, size='standard', density='normal') {
  await page.goto('/');
  await page.getByLabel('World size').selectOption(size);
  await page.getByLabel('Civilization density').selectOption(density);
  await page.getByRole('button',{name:'Create a new world',exact:true}).click();
  await expect(page.getByRole('button',{name:'Menu',exact:true})).toBeVisible();
  if(await page.getByRole('button',{name:'Skip tutorial',exact:true}).isVisible()) await page.getByRole('button',{name:'Skip tutorial',exact:true}).click();
  await page.keyboard.press('Space');
}

async function projectedClick(page: Page, cell: number) {
  const p=await page.evaluate(id=>(window as any).__lgScreenOf(id),cell);
  expect(p).not.toBeNull();
  await page.mouse.click(p.x,p.y);
}

test('Standard globe, distant faction focus, picking, god powers, compressed save and reload', async({page}, info) => {
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await start(page);
  const initial=await state(page);
  expect(initial.width).toBe(192); expect(initial.height).toBe(96); expect(initial.radius).toBe(10);
  expect(initial.civs).toBeGreaterThanOrEqual(10); expect(initial.civs).toBeLessThanOrEqual(20);
  await page.screenshot({path:info.outputPath('standard-overview.png')});

  const target=await page.evaluate(()=>{
    const w=(window as any).__LG.getState().world;
    const civ:any=Object.values(w.civs)[12]; const king=w.citizens[civ.kingId];
    return {id:civ.id,name:civ.name,king:king.id,cell:king.cellId};
  });
  await page.getByRole('button',{name:'Civs',exact:true}).click();
  await page.getByLabel('Find a civilization').fill(target.name);
  await page.getByRole('button',{name:new RegExp('^'+target.name+' ')}).click();
  await expect.poll(async()=> (await state(page)).camera).toBeCloseTo(13.2,1);
  await page.getByRole('button',{name:'Show the king on the planet',exact:true}).click();
  await expect.poll(async()=>(await state(page)).selected).toBe(target.king);
  await page.waitForTimeout(1200);
  await page.screenshot({path:info.outputPath('focused-civilization.png')});

  // A real pointer click goes through the ray-to-surface mapping, not through a store action.
  await projectedClick(page,target.cell);
  expect((await state(page)).selectedCell).toBe(target.cell);
  await page.mouse.wheel(0,-2600);
  await page.waitForTimeout(1300);
  expect((await state(page)).camera).toBeGreaterThanOrEqual(10.84);
  await projectedClick(page,target.cell);
  expect((await state(page)).selectedCell).toBe(target.cell);
  await page.mouse.wheel(0,1800);
  await page.waitForTimeout(900);
  expect((await state(page)).camera).toBeGreaterThan(13);
  await page.getByRole('button',{name:'Show the king on the planet',exact:true}).click();
  await page.waitForTimeout(1400);
  await page.keyboard.press('v');
  await projectedClick(page,target.cell);
  await expect(page.getByRole('button',{name:'Look closer',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Look closer',exact:true}).click();
  await expect(page.getByRole('button',{name:'Plant the Seeds of War',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Plant the Seeds of War',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>Object.values((window as any).__LG.getState().world.relations).filter((r:any)=>r.status==='war').length)).toBe(1);

  await page.keyboard.press('m');
  const beforeEnergy=(await state(page)).energy;
  // Dragging (even back to the same endpoint) must never launch a meteor.
  const p=await page.evaluate(id=>(window as any).__lgScreenOf(id),target.cell);
  await page.mouse.move(p.x,p.y); await page.mouse.down(); await page.mouse.move(p.x+60,p.y+25,{steps:8});
  await page.mouse.move(p.x,p.y,{steps:8}); await page.mouse.up();
  expect((await state(page)).energy).toBe(beforeEnergy);
  // Use the focus control again to bring the intended surface point back to centre.
  await page.getByRole('button',{name:'Show the king on the planet',exact:true}).click();
  await page.waitForTimeout(1400); await page.keyboard.press('m');
  await projectedClick(page,target.cell);
  await expect.poll(async()=>(await state(page)).impacts,{timeout:30000}).toBe(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  await expect.poll(async()=>(await state(page)).camera).toBeGreaterThan(29);
  await page.screenshot({path:info.outputPath('after-meteor-overview.png')});

  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await page.getByRole('button',{name:'Save now',exact:true}).click();
  expect((await state(page)).save).toBe('saved');
  const packed=await page.evaluate(()=>localStorage.getItem('littlegod.save.v1'));
  expect(packed!.startsWith('LGZ5:')).toBe(true);
  expect(packed!.length).toBeLessThan(2000000);
  const before=await state(page);
  await page.reload();
  await page.getByRole('button',{name:'Continue saved world',exact:true}).click();
  const after=await state(page);
  expect(after.width).toBe(before.width); expect(after.radius).toBe(before.radius);
  expect(after.civs).toBe(before.civs); expect(after.impacts).toBe(1);
  await page.keyboard.press('3');
  await expect.poll(async()=>(await state(page)).day,{timeout:30000}).toBeGreaterThan(after.day+.1);
  expect(errors).toEqual([]);
  console.log('BROWSER STANDARD',JSON.stringify({initial,after,errors}));
});

test('size and density creation controls and portrait overview remain functional', async({page},info)=>{
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await start(page,'small','sparse');
  const small=await state(page);
  expect(small.width).toBe(96); expect(small.civs).toBeLessThanOrEqual(5);
  // Import a v4-shaped populated snapshot: it must remain the original dimensions.
  const legacy = await page.evaluate(() => {
    const state = structuredClone((window as any).__LG.getState().world);
    delete state.generation; delete state.radius;
    return JSON.stringify({version:4,state,savedAt:Date.now(),tutorialDone:true,worldName:state.name});
  });
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await page.locator('input[type=file]').setInputFiles({name:'old-world.json',mimeType:'application/json',buffer:Buffer.from(legacy)});
  await expect.poll(async()=>(await state(page)).generation.size).toBe('legacy');
  expect((await state(page)).width).toBe(96); expect((await state(page)).radius).toBe(5);
  expect((await state(page)).population).toBe(small.population);
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await page.getByRole('button',{name:'New world…',exact:true}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('World size').selectOption('large');
  await page.getByLabel('Civilization density').selectOption('dense');
  await page.getByPlaceholder('Random').fill('804');
  await page.getByRole('button',{name:'Create',exact:true}).click();
  const large=await state(page);
  expect(large.width).toBe(240); expect(large.height).toBe(120);
  expect(large.civs).toBe(25);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  await expect.poll(async()=>(await state(page)).camera).toBeGreaterThan(80);
  await page.waitForTimeout(1000);
  await page.screenshot({path:info.outputPath('large-mobile-overview.png')});
  expect(errors).toEqual([]);
});