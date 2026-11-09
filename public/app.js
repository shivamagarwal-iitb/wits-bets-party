window.__gameScriptLoaded=true;
const root=document.getElementById('app');
const socket=typeof io==='function'?io({transports:['polling','websocket'],timeout:12000,reconnection:true,reconnectionAttempts:Infinity}):null;
const params=new URLSearchParams(location.search);const initialRoom=(params.get('room')||'').toUpperCase();const forceJoin=params.get('join')==='1';
let state=null,auth=null,selected=null,betAmount=0,activeSlot=0,hostMeta=null;
let joinedThisPage=false;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=x=>Number(x).toLocaleString('en-US');
function notice(message){const t=document.getElementById('toast');t.textContent=message;t.classList.remove('hidden');clearTimeout(notice.timer);notice.timer=setTimeout(()=>t.classList.add('hidden'),3500)}
function send(event,payload,callback){if(!socket?.connected){notice('Still connecting. Please try again in a moment.');return;}socket.emit(event,payload,r=>{if(!r?.ok){notice(r?.error||'Something went wrong');return;}callback?.(r)})}
function stored(){if(forceJoin&&!joinedThisPage)return null;try{const a=JSON.parse(sessionStorage.getItem('wb_auth')||'null');return a?.code && (!initialRoom || a.code===initialRoom)?a:null}catch{return null}}
function save(a){auth=a;joinedThisPage=true;sessionStorage.setItem('wb_auth',JSON.stringify(a))}
socket?.on('connect',()=>{document.getElementById('connection').textContent='● Live';const a=stored();if(a?.hostToken)send('resumeHost',a,()=>{auth=a;});else if(a?.playerToken)send('join',a,()=>{auth=a;});else renderWelcome();});
socket?.on('disconnect',()=>{document.getElementById('connection').textContent='○ Reconnecting…'});
// iOS pauses background tabs: explicitly rejoin and request current state when a tab becomes active.
function refreshActiveTab(){
  if(document.visibilityState==='hidden')return;
  const a=auth||stored();
  if(!socket)return;
  if(!socket.connected){socket.connect();return;}
  if(a?.hostToken)send('resumeHost',a,()=>{auth=a;});
  else if(a?.playerToken)send('join',a,()=>{auth=a;});
}
document.addEventListener('visibilitychange',refreshActiveTab);
window.addEventListener('pageshow',refreshActiveTab);
window.addEventListener('focus',refreshActiveTab);

socket?.on('state',s=>{const changed=state?.phase!==s.phase||state?.round!==s.round;if(changed){selected=null;activeSlot=0;betAmount=0;}state=s;if(s.phase==='betting'&&selected===null)selected=s.ownBets?.find(b=>b.slot===activeSlot)?.optionId??null;render()});
socket?.on('notice',x=>notice(x.error||x.message));
socket?.on('connect_error',e=>{document.getElementById('connection').textContent='○ Reconnecting…';console.warn('Connection issue',e.message)});
function renderWelcome(){if(state)return;root.innerHTML=`<div class="hero"><div class="eyebrow">A Festival of Lights party game</div><h1>Shine bright.<br>Bet smarter.</h1><p>Celebrate Diwali with seven surprising number questions, place two reusable betting chips on the closest guess, and climb the leaderboard.</p></div><div class="split"><section class="panel stack"><h2>🪔 Host a Diwali party</h2><p>Put the host screen on your TV. Guests join with a code or QR scan.</p><div class="pill">🪔 Exactly 7 festive rounds</div><button id="create">Create game room</button></section><section class="panel stack"><h2>📱 Join a game</h2><p>Enter the room code from your host's screen. Each browser tab can join as a different player.</p><label class="field">Room code<input id="room" placeholder="ABC123" maxlength="6" value="${esc(initialRoom)}" autocapitalize="characters"></label><label class="field">Your name<input id="name" placeholder="e.g. Alex" maxlength="24"></label><button id="join">Join party</button></section></div>`;
 document.getElementById('create').onclick=()=>send('create',{rounds:7,origin:location.origin},r=>{hostMeta=r;save({code:r.code,hostToken:r.hostToken});render();history.replaceState({},'',`/?room=${r.code}`)});
 document.getElementById('join').onclick=()=>{const code=document.getElementById('room').value.trim().toUpperCase(),name=document.getElementById('name').value.trim();send('join',{code,name},r=>{save({code,playerToken:r.playerToken,name:r.name});history.replaceState({},'',`/?room=${code}`)})};
}
function renderGameHeader(){return `<div class="row between section"><span class="pill">ROOM ${esc(state.code)}</span><span class="pill">${state.phase==='lobby'?'Waiting for players':state.phase==='finished'?'Game complete':`Round ${state.round} / ${state.maxRounds}`}</span>${state.isPlayer?`<span class="pill">🪙 ${fmt(myChips())} earned chips</span>`:''}</div>`}
function myChips(){return state.players.find(p=>p.name===auth?.name)?.chips??0}
function leaderboard(){return `<section class="panel section"><h2>🏆 Leaderboard</h2><table class="leaderboard"><thead><tr><th>Rank</th><th>Player</th><th>Earned chips</th></tr></thead><tbody>${state.players.map((p,i)=>`<tr><td>${i+1}</td><td>${esc(p.name)} ${p.connected?'🟢':'⚪'}</td><td><strong>${fmt(p.chips)}</strong></td></tr>`).join('')}</tbody></table></section>`}
function lobby(){return `<div class="panel stack"><div class="eyebrow">Game lobby</div><h1 style="margin:0">Ready to play?</h1><p>Waiting for the host to begin. Share this room code with friends.</p><div class="code">${esc(state.code)}</div>${state.host?`<div class="hostjoin"><img id="qr" alt="QR code to join game" src="/qr/${encodeURIComponent(state.code)}"><div><p>Scan to join from any phone.</p><div class="row"><button class="secondary" id="copy">Copy invite link</button></div></div></div>`:''}<div class="row"><span class="pill">${state.players.length} / 30 players</span><span class="pill">${state.maxRounds} rounds</span></div><div class="row">${state.players.map(p=>`<span class="pill">${esc(p.name)}</span>`).join('')}</div>${state.host?`<button id="advance" ${state.players.length<2?'disabled':''}>Start game →</button>`:'<p class="muted">The host will start when everyone is ready.</p>'}</div>`}
function guessing(){return `<div class="panel stack"><div class="eyebrow">Round ${state.round} · Secret guesses</div><div class="question">${esc(state.question)}</div>${state.isPlayer?`<p>Enter your best numerical guess. Other players won't see it until the host reveals all guesses.</p><label class="field">Your numerical answer<input id="guess" type="number" min="0" max="1000000000" step="1" placeholder="Enter a whole number" value="${state.ownGuess??''}"></label><button id="submitGuess">${state.ownGuess===null?'Submit guess':'Update guess'}</button>${state.ownGuess!==null?'<span class="pill">✓ Guess submitted</span>':''}`:`<p>${state.players.filter(p=>p.submitted).length} of ${state.players.length} guesses submitted</p><div class="row">${state.players.map(p=>`<span class="pill">${p.submitted?'✓':'…'} ${esc(p.name)}</span>`).join('')}</div><button id="advance">Reveal guesses & open betting →</button>`}</div>`}
function optionLabel(o){return o?.id==='all-high'?'ALL TOO HIGH':o?.value===null?'ALL TOO HIGH':fmt(o?.value)}
function board(reveal=false){
 const bets=reveal?(state.results?.revealedBets||[]):(state.ownBets||[]).map(b=>({...b,name:'You'}));
 return `<div class="bet-board">${state.guesses.map(o=>{
 const winner=reveal&&state.results?.winningOptionId===o.id;
 const placed=bets.filter(b=>b.optionId===o.id);
 const chosen=!reveal&&selected===o.id;
 return `<div class="board-tile ${winner?'board-winner':''} ${chosen?'board-selected':''} ${o.id==='all-high'?'board-all-high':''}" ${!reveal&&state.isPlayer?'data-option="'+esc(o.id)+'" role="button" tabindex="0"':''}>
 <div class="board-top"><span class="board-odds">${o.odds}:1</span>${winner?'<span class="board-win-label">🏆 WINNER</span>':''}</div>
 <div class="board-answer">${optionLabel(o)}</div><div class="board-subtitle">${o.id==='all-high'?'Every guess exceeds the answer':'Numerical guess'}</div>
 <div class="chip-pile">${placed.map(p=>`<div class="chip-stack"><span class="chip-token">🟡</span><span class="chip-owner">${esc(p.name)} · Chip ${p.slot+1}</span>${p.extra?`<span class="chip-extra">+${fmt(p.extra)} stacked</span>`:''}</div>`).join('')||`<span class="board-empty">${reveal?'No bets':'Tap to choose'}</span>`}</div>
 </div>`}).join('')}</div>`;
}
function betting(){
 const own=state.ownBets||[];
 const chosen=own.find(b=>b.slot===activeSlot);
 const available=myChips()+(chosen?.extra||0);
 return `<div class="panel stack"><div class="eyebrow">Round ${state.round} · Betting board</div><div class="question">${esc(state.question)}</div>
 <p>Bet on the closest guess <strong>without going over</strong>, or choose <strong>All Answers Too High</strong>. Your two golden chips are permanent. You can stack earned chips underneath either one, but extras on losing bets are lost.</p>
 ${state.isPlayer?`<div class="bet-controls"><div class="muted">CHOOSE A PERMANENT CHIP</div><div class="row"><button class="${activeSlot===0?'':'secondary'}" data-slot="0">🟡 Chip 1: ${own.find(b=>b.slot===0)?optionLabel(state.guesses.find(o=>o.id===own.find(b=>b.slot===0).optionId)):'Unplaced'}</button><button class="${activeSlot===1?'':'secondary'}" data-slot="1">🟡 Chip 2: ${own.find(b=>b.slot===1)?optionLabel(state.guesses.find(o=>o.id===own.find(b=>b.slot===1).optionId)):'Unplaced'}</button></div><p class="muted">Now placing chip ${activeSlot+1}. Select a card below. You may put both chips on one answer.</p></div>`:''}
 ${board(false)}
 ${state.isPlayer?`<div class="bet-controls"><label class="field">Extra earned chips under chip ${activeSlot+1} (optional)<input id="amount" type="number" min="0" max="${available}" step="1" value="${chosen?.extra??betAmount}"></label><p class="muted">Earned chips available: ${fmt(available)} · Only your bets are visible to you</p><button id="place" ${selected===null?'disabled':''}>Confirm chip ${activeSlot+1} on ${optionLabel(state.guesses.find(o=>o.id===selected))}</button><p class="muted">${own.length}/2 permanent chips placed. You can change either bet until the host reveals the answer.</p></div>`:`<p class="muted">🔒 Players' betting positions are private until reveal.</p><button id="advance">Reveal correct answer & everyone's bets →</button>`}</div>`;
}
function results(){
 const r=state.results;
 return `<div class="panel stack"><div class="eyebrow">Round ${state.round} · Betting reveal</div><div class="question">${esc(state.question)}</div>
 <div class="winner"><div class="muted">ACTUAL ANSWER</div><div class="big">${fmt(r.answer)}</div><p>${r.winningOptionId==='all-high'?'🏆 All Answers Too High wins! Every numerical guess was above the actual answer.':`🏆 Winning guess: <strong>${fmt(r.winningValue)}</strong>. Players who guessed it earn +${state.round} bonus chip${state.round===1?'':'s'}.`}</p></div>
 <h2>🎯 Where everyone placed their chips</h2><p class="muted">Every gold chip represents one permanent betting position. Stacked extras are shown alongside the player's name. The winning card is highlighted.</p>
 ${board(true)}
 <h2>💰 Round payouts</h2><div class="payout-grid">${r.payouts.map(p=>`<div class="payout-card"><strong>${esc(p.name)}</strong><span class="big">+${fmt(p.payout)}</span><small>Bet winnings: +${fmt(p.betWinnings)} · Best guess: +${fmt(p.guessBonus)}</small></div>`).join('')}</div>
 <p class="muted">Both permanent betting chips return next round; earned chips carry forward.</p>${state.host?`<button id="advance">${state.round>=state.maxRounds?'Finish game →':'Next round →'}</button>`:'<p>Waiting for host to start the next round…</p>'}</div>`;
}
function finished(){return `<div class="panel stack"><div class="eyebrow">Final results</div><h1>🎉 Game over!</h1><div class="winner"><div class="muted">PARTY CHAMPION</div><div class="big">${esc(state.players[0]?.name||'No winner')}</div><p>${fmt(state.players[0]?.chips||0)} virtual chips</p></div><p>Thanks for playing! To host another game, open a new private browser tab and create a fresh room.</p><button class="secondary" id="newGame">Create a new game</button></div>`}
function render(){if(!state)return renderWelcome();root.innerHTML=renderGameHeader()+({lobby,guessing,betting,results,finished}[state.phase]?.()||'')+(state.phase==='lobby'?'':leaderboard());
 document.getElementById('advance')?.addEventListener('click',()=>send('advance',{}));
 document.getElementById('submitGuess')?.addEventListener('click',()=>{const input=document.getElementById('guess');if(!input.value.trim())return notice('Enter a number');send('guess',{value:Number(input.value)})});
 document.querySelectorAll('[data-option]').forEach(el=>{const choose=()=>{selected=el.dataset.option;render()};el.onclick=choose;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose()}}});
 document.querySelectorAll('[data-slot]').forEach(el=>el.onclick=()=>{activeSlot=Number(el.dataset.slot);selected=state.ownBets?.find(b=>b.slot===activeSlot)?.optionId??null;betAmount=0;render()});
 document.getElementById('amount')?.addEventListener('change',e=>{betAmount=Number(e.target.value)});
 document.getElementById('place')?.addEventListener('click',()=>{const amount=Number(document.getElementById('amount').value);send('bet',{slot:activeSlot,optionId:selected,extra:amount},()=>{notice('Permanent chip '+(activeSlot+1)+' saved!');if(activeSlot===0&&!state.ownBets?.some(b=>b.slot===1)){activeSlot=1;selected=null;betAmount=0;render()}})});
 document.getElementById('copy')?.addEventListener('click',async()=>{const url=`${location.origin}/?room=${state.code}&join=1`;try{await navigator.clipboard.writeText(url);notice('Invite link copied!')}catch{notice(url)}});
 document.getElementById('newGame')?.addEventListener('click',()=>{sessionStorage.removeItem('wb_auth');state=null;auth=null;history.replaceState({},'','/');renderWelcome()});
}
renderWelcome();
if(!socket){document.getElementById('connection').textContent='Connection unavailable';notice('Unable to load live connection. Refresh this page.');}
