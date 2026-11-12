import { test, expect } from '@playwright/test';
const BASE='http://127.0.0.1:3000';
test('four players keep active inputs while peers submit and place bets',async({browser})=>{
 const contexts=await Promise.all(Array.from({length:5},()=>browser.newContext()));
 const pages=await Promise.all(contexts.map(c=>c.newPage()));
 const [host,...players]=pages;
 const errors=[];for(const p of pages)p.on('pageerror',e=>errors.push(e.message));
 try{
  await host.goto(BASE);await expect(host.locator('#create')).toBeVisible();
  await host.locator('#create').click();
  await expect(host.locator('#advance')).toBeVisible();
  const code=(await host.locator('.code').textContent()).trim();
  for(let i=0;i<4;i++){
   await players[i].goto(BASE+'/?room='+code+'&join=1');
   await players[i].locator('#name').fill(['Alice','Bob','Charlie','Dana'][i]);
   await players[i].locator('#join').click();
   await expect(players[i].locator('.code')).toContainText(code);
  }
  await expect(host.locator('#advance')).toBeEnabled();
  await host.locator('#advance').click();
  await expect(players[0].locator('#guess')).toBeVisible();
  await players[0].locator('#guess').fill('123456');
  await players[1].locator('#guess').fill('200');
  await players[2].locator('#guess').fill('300');
  await players[3].locator('#guess').fill('400');
  await Promise.all(players.slice(1).map(p=>p.locator('#submitGuess').click()));
  await expect(players[0].locator('#guess')).toHaveValue('123456');
  await players[0].locator('#submitGuess').click();
  await expect(players[0].locator('#guess-saved')).toContainText('123,456');
  await expect(host.locator('#live-guess-status')).toContainText('4 of 4');
  await host.locator('#advance').click();
  await expect(players[0].locator('#place')).toBeVisible();
  await players[0].locator('[data-option]').nth(1).click();
  await players[0].locator('#amount').fill('0');
  await Promise.all(players.slice(1).map(async(p,i)=>{
   await p.locator('[data-option]').nth(i+1).click();
   await p.locator('#place').click();
  }));
  await expect(players[0].locator('#amount')).toHaveValue('0');
  await expect(players[0].locator('#place')).toBeEnabled();
  await players[0].locator('#place').click();
  await expect(players[0].locator('#bet-saved')).toContainText('saved');
  await expect(host.locator('.table-chip')).toHaveCount(4);
  await host.locator('#advance').click();
  await expect(host.locator('#advance')).toContainText('Reveal');
  await host.locator('#advance').click();
  await expect(host.locator('.reveal-hero')).toBeVisible();
  expect(errors).toEqual([]);
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
