window.__gameScriptLoaded=true;
const root=document.getElementById('app');
const socket=typeof io==='function'?io({transports:['polling','websocket'],timeout:12000,reconnection:true,reconnectionAttempts:Infinity}):null;
const params=new URLSearchParams(location.search);const initialRoom=(params.get('room')||'').toUpperCase();const forceJoin=params.get('join')==='1';
let state=null,auth=null,selected=null,betAmount=0,activeSlot=0,hostMeta=null;
let joinedThisPage=false;
let boardPreference=null;
try{const saved=localStorage.getItem('wb_board_layout');if(['vertical','horizontal'].includes(saved))boardPreference=saved;}catch{}
function boardLayout(){return boardPreference||(state?.host?'horizontal':'vertical');}
function setBoardLayout(layout){if(!['vertical','horizontal'].includes(layout))return;boardPreference=layout;try{localStorage.setItem('wb_board_layout',layout);}catch{}render();}
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

socket?.on('state',s=>{const changed=state?.phase!==s.phase||state?.round!==s.round;if(changed){selected=null;activeSlot=0;betAmount=0;}state=s;if(['betting','final-betting'].includes(s.phase)&&selected===null)selected=s.ownBets?.find(b=>b.slot===activeSlot)?.optionId??null;render()});
socket?.on('notice',x=>notice(x.error||x.message));
socket?.on('connect_error',e=>{document.getElementById('connection').textContent='○ Reconnecting…';console.warn('Connection issue',e.message)});
function renderWelcome(){if(state)return;root.innerHTML=`<div class="hero"><div class="eyebrow">A Festival of Lights party game</div><h1>Shine bright.<br>Bet smarter.</h1><p>Celebrate Diwali with ten surprising number questions, place two reusable betting chips on the closest guess, and climb the leaderboard.</p></div><div class="split"><section class="panel stack"><h2>🪔 Host a Diwali party</h2><p>Put the host screen on your TV. Guests join with a code or QR scan.</p><div class="pill">🪔 Exactly 10 festive rounds</div><button id="create">Create game room</button></section><section class="panel stack"><h2>📱 Join a game</h2><p>Enter the room code from your host's screen. Each browser tab can join as a different player.</p><label class="field">Room code<input id="room" placeholder="ABC123" maxlength="6" value="${esc(initialRoom)}" autocapitalize="characters"></label><label class="field">Your name<input id="name" placeholder="e.g. Alex" maxlength="24"></label><button id="join">Join party</button></section></div>`;
 document.getElementById('create').onclick=()=>send('create',{rounds:10,origin:location.origin},r=>{hostMeta=r;save({code:r.code,hostToken:r.hostToken});render();history.replaceState({},'',`/?room=${r.code}`)});
 document.getElementById('join').onclick=()=>{const code=document.getElementById('room').value.trim().toUpperCase(),name=document.getElementById('name').value.trim();send('join',{code,name},r=>{save({code,playerToken:r.playerToken,name:r.name});history.replaceState({},'',`/?room=${code}`)})};
}
function renderGameHeader(){return `<div class="row between section"><span class="pill">ROOM ${esc(state.code)}</span><span class="pill">${state.phase==='lobby'?'Waiting for players':state.phase==='finished'?'Game complete':`Round ${state.round} / ${state.maxRounds}`}</span>${state.isPlayer?`<span class="pill">🪙 ${fmt(myChips())} earned chips</span>`:''}</div>`}
function myChips(){return state.players.find(p=>p.name===auth?.name)?.chips??0}
function leaderboard(){return `<section class="panel section"><h2>🏆 Leaderboard</h2><table class="leaderboard"><thead><tr><th>Rank</th><th>Player</th><th>Earned chips</th></tr></thead><tbody>${state.players.map((p,i)=>`<tr><td>${i+1}</td><td>${esc(p.name)} ${p.connected?'🟢':'⚪'}</td><td><strong>${fmt(p.chips)}</strong></td></tr>`).join('')}</tbody></table></section>`}
function lobby(){return `<div class="panel stack"><div class="eyebrow">Game lobby</div><h1 style="margin:0">Ready to play?</h1><p>Waiting for the host to begin. Share this room code with friends.</p><div class="code">${esc(state.code)}</div>${state.host?`<div class="hostjoin"><img id="qr" alt="QR code to join game" src="/qr/${encodeURIComponent(state.code)}"><div><p>Scan to join from any phone.</p><div class="row"><button class="secondary" id="copy">Copy invite link</button></div></div></div>`:''}<div class="row"><span class="pill">${state.players.length} / 30 players</span><span class="pill">${state.maxRounds} rounds</span></div><div class="row">${state.players.map(p=>`<span class="pill">${esc(p.name)}</span>`).join('')}</div>${state.host?`<button id="advance" ${state.players.length<2?'disabled':''}>Start game →</button>`:'<p class="muted">The host will start when everyone is ready.</p>'}</div>`}
function guessing(){return `<div class="panel stack"><div class="eyebrow">Round ${state.round} · Secret guesses</div><div class="question">${esc(state.question)}</div>${state.isPlayer?`<p>Enter your best numerical guess. Other players won't see it until the host reveals all guesses.</p><label class="field">Your numerical answer<input id="guess" type="number" min="0" max="1000000000" step="1" placeholder="Enter a whole number" value="${state.ownGuess??''}"></label><button id="submitGuess">${state.ownGuess===null?'Submit guess':'Update guess'}</button>${state.ownGuess!==null?'<span class="pill">✓ Guess submitted</span>':''}`:`<p>${state.players.filter(p=>p.submitted).length} of ${state.players.length} guesses submitted</p><div class="row">${state.players.map(p=>`<span class="pill">${p.submitted?'✓':'…'} ${esc(p.name)}</span>`).join('')}</div><button id="advance">Reveal guesses & open betting →</button>`}</div>`}
function optionLabel(o){return o?.id==='all-high'?'ALL TOO HIGH':o?.value===null?'ALL TOO HIGH':fmt(o?.value)}
function playerColor(name){return state.players.find(p=>p.name===name)?.color||'#ffd166'}
function playerLegend(){return `<div class="player-legend"><strong>PLAYER COLORS</strong><div class="legend-items">${state.players.map(p=>`<span class="legend-person"><i style="background:${p.color||'#ffd166'}"></i>${esc(p.name)}</span>`).join('')}</div></div>`}
function board(reveal=false){
 const publicPhase=reveal||['open-bets','locked-bets'].includes(state.phase);
 const bets=publicPhase?(reveal?(state.results?.revealedBets||[]):(state.publicBets||[])):(state.ownBets||[]).map(b=>({...b,name:'You'}));
 const options=state.guesses||[];
 const layout=boardLayout();
 const controls=`<div class="board-layout-switch" aria-label="Board layout"><span>Board view</span><button type="button" class="${layout==='vertical'?'':'secondary'}" data-layout="vertical" aria-pressed="${layout==='vertical'}">☷ Vertical</button><button type="button" class="${layout==='horizontal'?'':'secondary'}" data-layout="horizontal" aria-pressed="${layout==='horizontal'}">▥ Horizontal</button></div>`;
 return controls+`<div class="tabletop-scroll ${layout==='vertical'?'vertical-mode':''}"><div class="tabletop-board" style="--lane-count:${options.length}">
 <div class="tabletop-banner">✦ WITS & BETS ✦ <span>${reveal?'THE BIG REVEAL':state.phase==='open-bets'?'FIRST BETS REVEALED · VIEW ONLY':state.phase==='final-betting'?'FINAL PRIVATE BETTING':state.phase==='locked-bets'?'FINAL BETS REVEALED · LOCKED':'PLACE YOUR CHIPS'}</span></div>
 <div class="tabletop-lanes">${options.map((o,i)=>{
 const winner=reveal&&state.results?.winningOptionId===o.id;
 const placed=bets.filter(b=>b.optionId===o.id);
 const editable=!reveal&&['betting','final-betting'].includes(state.phase);
 const chosen=editable&&selected===o.id;
 return `<div class="tabletop-lane ${winner?'lane-winner':''} ${chosen?'lane-selected':''} ${o.id==='all-high'?'lane-all-high':''}" ${editable&&state.isPlayer?'data-option="'+esc(o.id)+'" role="button" tabindex="0"':''}>
 <div class="lane-odds">PAYS ${o.odds}:1</div>
 <div class="lane-chips">${placed.map(p=>`<div class="table-chip ${winner?'winning-chip':''}" style="--player-color:${playerColor(p.name)}"><span class="player-chip-dot"></span><b>${esc(p.name)}</b><small>#${p.slot+1}${p.extra?' +'+fmt(p.extra):''}</small></div>`).join('')||'<div class="lane-empty">○</div>'}</div>
 <div class="lane-card">${o.id==='all-high'?'<span class="lane-special">ALL GUESSES<br>TOO HIGH</span>':`<span>${fmt(o.value)}</span>`}</div>
 <div class="guess-owners">${(o.guessers||[]).map(g=>`<span class="guess-owner ${winner?'winning-guesser':''}" style="--player-color:${g.color}"><i></i>${esc(g.name)}</span>`).join('')}</div>
 ${winner?'<div class="lane-winning-label">🏆 WINNER</div>':chosen?'<div class="lane-selected-label">✓ SELECTED</div>':''}
 </div>`}).join('')}</div>
 <div class="tabletop-footer">🪔 ${publicPhase?'Everyone’s chips are visible':'Only your chips are visible'} ${layout==='horizontal'?'· Swipe board sideways if needed':''} 🪔</div>
 </div></div>`;
}
function betting(){
 const editable=['betting','final-betting'].includes(state.phase);
 const own=state.ownBets||[];
 const chosen=own.find(b=>b.slot===activeSlot);
 const available=myChips()+(chosen?.extra||0);
 return `<div class="panel stack"><div class="eyebrow">Round ${state.round} · ${state.phase==='open-bets'?'First bets revealed':state.phase==='final-betting'?'Final private betting':state.phase==='locked-bets'?'Final bets locked':'Private betting'}</div><div class="question">${esc(state.question)}</div>
 <p>Bet on the closest guess <strong>without going over</strong>, or choose <strong>All Answers Too High</strong>. Your two golden chips are permanent. You can stack earned chips underneath either one, but extras on losing bets are lost.</p>
 ${state.isPlayer&&editable?`<div class="bet-controls"><div class="muted">CHOOSE A PERMANENT CHIP</div><div class="row"><button class="${activeSlot===0?'':'secondary'}" data-slot="0">🟡 Chip 1: ${own.find(b=>b.slot===0)?optionLabel(state.guesses.find(o=>o.id===own.find(b=>b.slot===0).optionId)):'Unplaced'}</button><button class="${activeSlot===1?'':'secondary'}" data-slot="1">🟡 Chip 2: ${own.find(b=>b.slot===1)?optionLabel(state.guesses.find(o=>o.id===own.find(b=>b.slot===1).optionId)):'Unplaced'}</button></div><p class="muted">Now placing chip ${activeSlot+1}. Select a card below. You may put both chips on one answer.</p></div>`:''}
 ${playerLegend()}
 ${board(false)}
 ${state.isPlayer&&editable?`<div class="bet-controls"><label class="field">Extra earned chips under chip ${activeSlot+1} (optional)<input id="amount" type="number" min="0" max="${available}" step="1" value="${chosen?.extra??betAmount}"></label><p class="muted">Earned chips available: ${fmt(available)} · Your bets are private</p><button id="place" ${selected===null?'disabled':''}>Confirm chip ${activeSlot+1} on ${optionLabel(state.guesses.find(o=>o.id===selected))}</button><p class="muted">${own.length}/2 permanent chips placed. You can change either bet during private betting. Your final choices will be revealed when the host locks them.</p></div>`:(state.host?`<p class="muted">${state.phase==='betting'?'🔒 First bets are private. Reveal the first placements for everyone to see.':state.phase==='open-bets'?'👀 First bets are visible, but changes are paused. Start a new private betting phase for final adjustments.':state.phase==='final-betting'?'🔒 Final adjustments are private. Lock and reveal everyone’s final bets.':'🔐 Final bets are public and locked. Nobody can change them now.'}</p><button id="advance">${state.phase==='betting'?'Reveal first bets →':state.phase==='open-bets'?'Start private final betting →':state.phase==='final-betting'?'Lock & reveal final bets →':'Reveal the correct answer →'}</button>`:`<p class="muted">${state.phase==='open-bets'?'👀 First bets are visible. Wait for private final betting to begin.':state.phase==='locked-bets'?'🔐 Final bets are public and locked. Waiting for the answer.':'Waiting for the host.'}</p>`)}</div>`;
}
function results(){
 const r=state.results;
 return `<div class="panel stack"><div class="eyebrow">Round ${state.round} · Betting reveal</div><div class="question">${esc(state.question)}</div>
 <div class="winner reveal-hero"><div class="muted">✨ ACTUAL ANSWER ✨</div><div class="big">${fmt(r.answer)}</div><p>${r.winningOptionId==='all-high'?'🏆 All Answers Too High wins! Every numerical guess was above the actual answer.':`🏆 Winning guess: <strong>${fmt(r.winningValue)}</strong>. Players who guessed it earn +${state.round} bonus chip${state.round===1?'':'s'}.`}</p></div>
 <h2>🏆 Winning lane, guesses & bets</h2><p class="muted">Every gold chip represents one permanent betting position. Stacked extras are shown alongside the player's name. The winning card is highlighted.</p>
 ${playerLegend()}
 ${board(true)}
 <div class="reveal-highlights"><div><strong>🎯 Winning original guess</strong><p>${(state.guesses.find(o=>o.id===r.winningOptionId)?.guessers||[]).map(g=>`<span class="winner-person" style="--player-color:${g.color}">${esc(g.name)}</span>`).join(' ')||'No numerical guess qualified.'}</p></div><div><strong>🪙 Winning bets</strong><p>${(r.revealedBets||[]).filter(b=>b.optionId===r.winningOptionId).map(b=>`<span class="winner-person" style="--player-color:${playerColor(b.name)}">${esc(b.name)} · Chip ${b.slot+1}</span>`).join(' ')||'Nobody bet on the winning lane.'}</p></div></div>
 <div class="answer-fact"><h2>💡 About the answer</h2><p>${esc(r.explanation||'This number describes the event in the question.')}</p></div>
 <h2>💰 Round payouts</h2><div class="payout-grid">${r.payouts.map(p=>`<div class="payout-card"><strong>${esc(p.name)}</strong><span class="big">+${fmt(p.payout)}</span><small>Bet winnings: +${fmt(p.betWinnings)} · Best guess: +${fmt(p.guessBonus)}</small></div>`).join('')}</div>
 <p class="muted">Both permanent betting chips return next round; earned chips carry forward.</p>${state.host?`<button id="advance">${state.round>=state.maxRounds?'Finish game →':'Next round →'}</button>`:'<p>Waiting for host to start the next round…</p>'}</div>`;
}
function finished(){return `<div class="panel stack"><div class="eyebrow">Final results</div><h1>🎉 Game over!</h1><div class="winner"><div class="muted">PARTY CHAMPION</div><div class="big">${esc(state.players[0]?.name||'No winner')}</div><p>${fmt(state.players[0]?.chips||0)} virtual chips</p></div><p>Thanks for playing! To host another game, open a new private browser tab and create a fresh room.</p><button class="secondary" id="newGame">Create a new game</button></div>`}
function render(){if(!state)return renderWelcome();root.innerHTML=renderGameHeader()+({lobby,guessing,betting,'open-bets':betting,'final-betting':betting,'locked-bets':betting,results,finished}[state.phase]?.()||'')+(state.phase==='lobby'?'':leaderboard());
 document.getElementById('advance')?.addEventListener('click',()=>send('advance',{}));
 document.getElementById('submitGuess')?.addEventListener('click',()=>{const input=document.getElementById('guess');if(!input.value.trim())return notice('Enter a number');send('guess',{value:Number(input.value)})});
 document.querySelectorAll('[data-layout]').forEach(el=>el.addEventListener('click',()=>setBoardLayout(el.dataset.layout)));
 document.querySelectorAll('[data-option]').forEach(el=>{const choose=()=>{selected=el.dataset.option;render()};el.onclick=choose;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose()}}});
 document.querySelectorAll('[data-slot]').forEach(el=>el.onclick=()=>{activeSlot=Number(el.dataset.slot);selected=state.ownBets?.find(b=>b.slot===activeSlot)?.optionId??null;betAmount=0;render()});
 document.getElementById('amount')?.addEventListener('change',e=>{betAmount=Number(e.target.value)});
 document.getElementById('place')?.addEventListener('click',()=>{const amount=Number(document.getElementById('amount').value);send('bet',{slot:activeSlot,optionId:selected,extra:amount},()=>{notice('Permanent chip '+(activeSlot+1)+' saved!');if(activeSlot===0&&!state.ownBets?.some(b=>b.slot===1)){activeSlot=1;selected=null;betAmount=0;render()}})});
 document.getElementById('copy')?.addEventListener('click',async()=>{const url=`${location.origin}/?room=${state.code}&join=1`;try{await navigator.clipboard.writeText(url);notice('Invite link copied!')}catch{notice(url)}});
 document.getElementById('newGame')?.addEventListener('click',()=>{sessionStorage.removeItem('wb_auth');state=null;auth=null;history.replaceState({},'','/');renderWelcome()});
}
renderWelcome();
if(!socket){document.getElementById('connection').textContent='Connection unavailable';notice('Unable to load live connection. Refresh this page.');}
