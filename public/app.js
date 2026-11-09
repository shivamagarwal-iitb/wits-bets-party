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
function betting(){
 const own=state.ownBets||[];
 const chosen=own.find(b=>b.slot===activeSlot);
 const available=myChips()+(chosen?.extra||0);
 return `<div class="panel stack"><div class="eyebrow">Round ${state.round} · Private betting</div><div class="question">${esc(state.question)}</div>
 <p>You have <strong>two permanent betting chips</strong>, each worth one chip. Choose an answer for each, then optionally stack earned chips beneath either one. Your two permanent chips always return; extra chips on losing bets are lost. Only you can see your bets before the reveal.</p>
 ${state.isPlayer?`<div class="row"><button class="${activeSlot===0?'':'secondary'}" data-slot="0">🟡 Chip 1: ${own.find(b=>b.slot===0)?fmt(state.guesses.find(o=>o.id===own.find(b=>b.slot===0).optionId)?.value):'Not placed'}</button><button class="${activeSlot===1?'':'secondary'}" data-slot="1">🟡 Chip 2: ${own.find(b=>b.slot===1)?fmt(state.guesses.find(o=>o.id===own.find(b=>b.slot===1).optionId)?.value):'Not placed'}</button></div><p class="muted">Select an answer for permanent chip ${activeSlot+1}. You can move it or change its extra chips until betting closes.</p>`:''}
 <div class="options">${state.guesses.map(o=>`<button class="option ${selected===o.id?'active':''}" data-option="${esc(o.id)}" ${!state.isPlayer?'disabled':''}><strong>${fmt(o.value)}</strong><small>${o.odds}:1 profit odds</small>${state.isPlayer?`<small>${own.filter(b=>b.optionId===o.id).map(b=>`🟡 Chip ${b.slot+1} + ${b.extra} extra`).join(' · ')}</small>`:''}</button>`).join('')}</div>
 ${state.isPlayer?`<label class="field">Extra earned chips under chip ${activeSlot+1} (optional; 0 is fine)<input id="amount" type="number" min="0" max="${available}" step="1" value="${chosen?.extra??betAmount}"></label><p class="muted">Available earned chips: <strong>${available}</strong> (including any extras already attached to this chip)</p><button id="place" ${selected===null?'disabled':''}>Save chip ${activeSlot+1} bet</button><p class="muted">Your private bets: ${own.length}/2 placed. ${own.length===2?'✓ Both chips placed. You may edit them until betting closes.':'Place both permanent chips before the host reveals the answer.'}</p>`:`<p class="muted">Betting is private. Individual placements are hidden until results.</p><button id="advance">Close betting & reveal answer →</button>`}</div>`;
}
function results(){const r=state.results;return `<div class="panel stack"><div class="eyebrow">Round ${state.round} · Results</div><div class="question">${esc(state.question)}</div><div class="winner"><div class="muted">CORRECT ANSWER</div><div class="big">${fmt(r.answer)}</div><p>${r.winningValue===null?'Nobody guessed without going over — all bets lose.':`Winning guess: <strong>${fmt(r.winningValue)}</strong> · The player(s) who guessed it earn <strong>+${state.round} bonus chip${state.round===1?'':'s'}</strong>.`}</p></div><h2>💰 Round winnings</h2><div class="row">${r.payouts.map(p=>`<span class="pill">${esc(p.name)}: +${fmt(p.payout)} (bets +${fmt(p.betWinnings)}, guess +${fmt(p.guessBonus)})</span>`).join('')}</div><p class="muted">Both permanent betting chips return for the next round. Earned chips carry over.</p>${state.host?`<button id="advance">${state.round>=state.maxRounds?'Finish game →':'Next round →'}</button>`:'<p>Waiting for host to start the next round…</p>'}</div>`}
function finished(){return `<div class="panel stack"><div class="eyebrow">Final results</div><h1>🎉 Game over!</h1><div class="winner"><div class="muted">PARTY CHAMPION</div><div class="big">${esc(state.players[0]?.name||'No winner')}</div><p>${fmt(state.players[0]?.chips||0)} virtual chips</p></div><p>Thanks for playing! To host another game, open a new private browser tab and create a fresh room.</p><button class="secondary" id="newGame">Create a new game</button></div>`}
function render(){if(!state)return renderWelcome();root.innerHTML=renderGameHeader()+({lobby,guessing,betting,results,finished}[state.phase]?.()||'')+(state.phase==='lobby'?'':leaderboard());
 document.getElementById('advance')?.addEventListener('click',()=>send('advance',{}));
 document.getElementById('submitGuess')?.addEventListener('click',()=>{const input=document.getElementById('guess');if(!input.value.trim())return notice('Enter a number');send('guess',{value:Number(input.value)})});
 document.querySelectorAll('[data-option]').forEach(el=>el.onclick=()=>{selected=el.dataset.option;render()});
 document.querySelectorAll('[data-slot]').forEach(el=>el.onclick=()=>{activeSlot=Number(el.dataset.slot);selected=state.ownBets?.find(b=>b.slot===activeSlot)?.optionId??null;betAmount=0;render()});
 document.getElementById('amount')?.addEventListener('change',e=>{betAmount=Number(e.target.value)});
 document.getElementById('place')?.addEventListener('click',()=>{const amount=Number(document.getElementById('amount').value);send('bet',{slot:activeSlot,optionId:selected,extra:amount},()=>{notice('Permanent chip '+(activeSlot+1)+' saved!');if(activeSlot===0&&!state.ownBets?.some(b=>b.slot===1)){activeSlot=1;selected=null;betAmount=0;render()}})});
 document.getElementById('copy')?.addEventListener('click',async()=>{const url=`${location.origin}/?room=${state.code}&join=1`;try{await navigator.clipboard.writeText(url);notice('Invite link copied!')}catch{notice(url)}});
 document.getElementById('newGame')?.addEventListener('click',()=>{sessionStorage.removeItem('wb_auth');state=null;auth=null;history.replaceState({},'','/');renderWelcome()});
}
renderWelcome();
if(!socket){document.getElementById('connection').textContent='Connection unavailable';notice('Unable to load live connection. Refresh this page.');}
