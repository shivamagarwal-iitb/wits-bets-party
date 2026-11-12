window.__gameScriptLoaded=true;
const root=document.getElementById('app');
const socket=typeof io==='function'?io({transports:['polling','websocket'],timeout:12000,reconnection:true,reconnectionAttempts:Infinity}):null;
const params=new URLSearchParams(location.search);const initialRoom=(params.get('room')||'').toUpperCase();const forceJoin=params.get('join')==='1';const recoveryToken=params.get('resume');
let state=null,auth=null,selected=null,betAmount=0,activeSlot=0,hostMeta=null;
let joinedThisPage=false;
// Preserve an unsubmitted guess when other players trigger live state updates.
let guessDraft=null;
let timerTick=null;
let boardPreference=null;
try{const saved=localStorage.getItem('wb_board_layout');if(['vertical','horizontal'].includes(saved))boardPreference=saved;}catch{}
function boardLayout(){return boardPreference||(state?.host?'horizontal':'vertical');}
function setBoardLayout(layout){if(!['vertical','horizontal'].includes(layout))return;boardPreference=layout;try{localStorage.setItem('wb_board_layout',layout);}catch{}render();}
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=x=>Number(x).toLocaleString('en-US');
function notice(message){const t=document.getElementById('toast');t.textContent=message;t.classList.remove('hidden');clearTimeout(notice.timer);notice.timer=setTimeout(()=>t.classList.add('hidden'),3500)}
function send(event,payload,callback){if(!socket?.connected){notice('Still connecting. Please try again in a moment.');return;}socket.emit(event,payload,r=>{if(!r?.ok){notice(r?.error||'Something went wrong');return;}callback?.(r)})}
function stored(){
 if(auth?.code&&(!initialRoom||auth.code===initialRoom))return auth;
 // A private recovery link is a bearer credential: restore the same player even on a new device.
 if(recoveryToken&&initialRoom)return {code:initialRoom,playerToken:recoveryToken};
 try{
  const session=JSON.parse(sessionStorage.getItem('wb_auth')||'null');
  if(session?.code&&(!initialRoom||session.code===initialRoom))return session;
  const persistent=JSON.parse(localStorage.getItem('wb_auth_'+initialRoom)||'null');
  if(initialRoom&&persistent?.code===initialRoom)return persistent;
  const last=JSON.parse(localStorage.getItem('wb_auth_last')||'null');
  if(!initialRoom&&!forceJoin&&last?.code)return last;
 }catch{}
 return null;
}
function save(a){
 auth=a;joinedThisPage=true;
 try{sessionStorage.setItem('wb_auth',JSON.stringify(a));localStorage.setItem('wb_auth_'+a.code,JSON.stringify(a));localStorage.setItem('wb_auth_last',JSON.stringify(a))}catch{}
}
function cleanRecoveryUrl(){if(recoveryToken){const url=new URL(location.href);url.searchParams.delete('resume');history.replaceState({},'',url.pathname+url.search+url.hash)}}
function resumeSession(a){
 if(a?.hostToken)send('resumeHost',a,()=>{save(a);cleanRecoveryUrl()});
 else if(a?.playerToken)send('join',a,r=>{save({code:a.code,playerToken:r.playerToken,name:r.name});cleanRecoveryUrl()});
}
socket?.on('connect',()=>{document.getElementById('connection').textContent='● Live';const a=stored();if(a)resumeSession(a);else renderWelcome();});
socket?.on('disconnect',()=>{document.getElementById('connection').textContent='○ Reconnecting…'});
// iOS pauses background tabs: explicitly rejoin and request current state when a tab becomes active.
function refreshActiveTab(){
  if(document.visibilityState==='hidden')return;
  const a=auth||stored();
  if(!socket)return;
  if(!socket.connected){socket.connect();return;}
  if(a)resumeSession(a);
}
document.addEventListener('visibilitychange',refreshActiveTab);
window.addEventListener('pageshow',refreshActiveTab);
window.addEventListener('focus',refreshActiveTab);

socket?.on('state',s=>{
 const changed=state?.phase!==s.phase||state?.round!==s.round;
 const liveOnly=!changed&&s.phase==='betting'&&state?.phase==='betting';
 if(changed){selected=null;activeSlot=0;betAmount=0;guessDraft=null;}
 state=s;
 if(s.phase==='betting'&&selected===null)selected=s.ownBets?.find(b=>b.slot===activeSlot)?.optionId??null;
 if(liveOnly&&document.getElementById('live-board')){
   // Update only the public board, not the betting controls/input being used.
   const el=document.getElementById('live-board');
   el.innerHTML=board(false);
   wireBoardChoices();
   const summary=document.getElementById('bet-summary');
   if(summary)summary.textContent=(s.ownBets||[]).length+'/2 permanent chips placed';
   const chips=document.getElementById('chips-available');
   if(chips)chips.textContent=fmt(myChips());
   updateBetTimer();
 }else render();
});
socket?.on('notice',x=>notice(x.error||x.message));
socket?.on('connect_error',e=>{document.getElementById('connection').textContent='○ Reconnecting…';console.warn('Connection issue',e.message)});
function renderWelcome(){if(state)return;root.innerHTML=`<div class="hero"><div class="eyebrow">A Bollywood trivia party game</div><h1>Shine bright.<br>Bet smarter.</h1><p>Play seven surprising Bollywood number questions, place two reusable betting chips on the closest guess, and climb the leaderboard.</p></div><div class="split"><section class="panel stack"><h2>🎬 Host a Bollywood party</h2><p>Put the host screen on your TV. Guests join with a code or QR scan.</p><div class="pill">🎬 Exactly 7 Bollywood rounds</div><button id="create">Create game room</button></section><section class="panel stack"><h2>📱 Join a game</h2><p>Enter the room code from your host's screen. Each browser tab can join as a different player.</p><label class="field">Room code<input id="room" placeholder="ABC123" maxlength="6" value="${esc(initialRoom)}" autocapitalize="characters"></label><label class="field">Your name<input id="name" placeholder="e.g. Alex" maxlength="24"></label><button id="join">Join party</button></section></div>`;
 document.getElementById('create').onclick=()=>send('create',{rounds:7,origin:location.origin},r=>{hostMeta=r;save({code:r.code,hostToken:r.hostToken});render();history.replaceState({},'',`/?room=${r.code}`)});
 document.getElementById('join').onclick=()=>{const code=document.getElementById('room').value.trim().toUpperCase(),name=document.getElementById('name').value.trim();send('join',{code,name},r=>{save({code,playerToken:r.playerToken,name:r.name});history.replaceState({},'',`/?room=${code}`)})};
}
function renderGameHeader(){return `<div class="row between section"><span class="pill">ROOM ${esc(state.code)}</span><span class="pill">${state.phase==='lobby'?'Waiting for players':state.phase==='finished'?'Game complete':`Round ${state.round} / ${state.maxRounds}`}</span>${state.isPlayer?`<span class="pill">🪙 ${fmt(myChips())} earned chips</span>`:''}</div>`}
function recoveryPanel(){
 if(!state?.host||state.phase==='finished')return '';
 const players=state.recoveryPlayers||[];
 return `<section class="panel section"><h3>🔄 Player rejoin links</h3><p class="muted">If someone closes their browser or loses their place, send them their personal rejoin link. It restores their same player, chips, guesses and current round. Share each link privately.</p><div class="row">${players.map((p,i)=>`<button class="secondary" data-recover="${i}">Copy ${esc(p.name)}'s rejoin link</button>`).join('')}</div></section>`;
}
function myChips(){return state.players.find(p=>p.name===auth?.name)?.chips??0}
function leaderboard(){return `<section class="panel section"><h2>🏆 Leaderboard</h2><table class="leaderboard"><thead><tr><th>Rank</th><th>Player</th><th>Earned chips</th></tr></thead><tbody>${state.players.map((p,i)=>`<tr><td>${i+1}</td><td>${esc(p.name)} ${p.connected?'🟢':'⚪'}</td><td><strong>${fmt(p.chips)}</strong></td></tr>`).join('')}</tbody></table></section>`}
function lobby(){return `<div class="panel stack"><div class="eyebrow">Game lobby</div><h1 style="margin:0">Ready to play?</h1><p>Waiting for the host to begin. Share this room code with friends.</p><div class="code">${esc(state.code)}</div>${state.host?`<div class="hostjoin"><img id="qr" alt="QR code to join game" src="/qr/${encodeURIComponent(state.code)}"><div><p>Scan to join from any phone.</p><div class="row"><button class="secondary" id="copy">Copy invite link</button></div></div></div>`:''}${guessingTimerSettings()}${timerSettings()}<div class="row"><span class="pill">${state.players.length} / 30 players</span><span class="pill">${state.maxRounds} rounds</span></div><div class="row">${state.players.map(p=>`<span class="pill">${esc(p.name)}</span>`).join('')}</div>${state.host?`<button id="advance" ${state.players.length<2?'disabled':''}>Start game →</button>`:'<p class="muted">The host will start when everyone is ready.</p>'}</div>`}
function reopenControls(){
 if(!state.host)return '';
 if(state.phase==='guessing')return '<button class="secondary" id="reopen-guessing">Restart guessing timer</button>';
 if(state.phase==='betting')return '<button class="secondary" id="reopen-guessing">Reopen guessing (reset bets)</button>';
 if(state.phase==='locked-bets')return '<div class="row"><button class="secondary" id="reopen-betting">Reopen betting</button><button class="secondary" id="reopen-guessing">Reopen guessing (reset bets)</button></div>';
 return '';
}
function guessing(){return `<div class="panel stack"><div class="eyebrow">Round ${state.round} · Secret guesses</div><div class="question">${esc(state.question)}</div><div class="row"><span class="pill">⏱ Guessing: <strong id="guess-timer">${formatTimer((state.guessingDeadline||0)-Date.now())}</strong></span></div>${state.isPlayer?`<p>Enter your best numerical guess. Other players won't see it until the host reveals all guesses.</p><label class="field">Your numerical answer<input id="guess" type="number" min="0" max="1000000000" step="1" placeholder="Enter a whole number" value="${esc(guessDraft??state.ownGuess??'')}"></label><button id="submitGuess">${state.ownGuess===null?'Submit guess':'Update guess'}</button>${state.ownGuess!==null?'<span class="pill">✓ Guess submitted</span>':''}`:`<p>${state.players.filter(p=>p.submitted).length} of ${state.players.length} guesses submitted</p><div class="row">${state.players.map(p=>`<span class="pill">${p.submitted?'✓':'…'} ${esc(p.name)}</span>`).join('')}</div>${guessingTimerSettings()}${timerSettings()}${reopenControls()}<button id="advance">End guessing early →</button>`}</div>`}
function optionLabel(o){return o?.id==='all-high'?'ALL TOO HIGH':o?.value===null?'ALL TOO HIGH':fmt(o?.value)}
function playerColor(name){return state.players.find(p=>p.name===name)?.color||'#ffd166'}
function playerLegend(){return `<div class="player-legend"><strong>PLAYER COLORS</strong><div class="legend-items">${state.players.map(p=>`<span class="legend-person"><i style="background:${p.color||'#ffd166'}"></i>${esc(p.name)}</span>`).join('')}</div></div>`}
function board(reveal=false){
 const publicPhase=reveal||['betting','locked-bets'].includes(state.phase);
 const bets=publicPhase?(reveal?(state.results?.revealedBets||[]):(state.publicBets||[])):(state.ownBets||[]).map(b=>({...b,name:'You'}));
 const options=state.guesses||[];
 const layout=boardLayout();
 const controls=`<div class="board-layout-switch" aria-label="Board layout"><span>Board view</span><button type="button" class="${layout==='vertical'?'':'secondary'}" data-layout="vertical" aria-pressed="${layout==='vertical'}">☷ Vertical</button><button type="button" class="${layout==='horizontal'?'':'secondary'}" data-layout="horizontal" aria-pressed="${layout==='horizontal'}">▥ Horizontal</button></div>`;
 return controls+`<div class="tabletop-scroll ${layout==='vertical'?'vertical-mode':''}"><div class="tabletop-board" style="--lane-count:${options.length}">
 <div class="tabletop-banner">✦ WITS & BETS ✦ <span>${reveal?'THE BIG REVEAL':state.phase==='locked-bets'?'BETS LOCKED':'LIVE PUBLIC BETTING'}</span></div>
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
 <div class="tabletop-footer">🎬 ${publicPhase?'Everyone’s chips are visible':'Only your chips are visible'} ${layout==='horizontal'?'· Swipe board sideways if needed':''} 🎬</div>
 </div></div>`;
}
function formatTimer(ms){const sec=Math.max(0,Math.ceil(ms/1000));return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');}
function updateBetTimer(){
 const el=document.getElementById('bet-timer');
 if(!state)return;
 const remaining=(state.bettingDeadline||0)-Date.now();
 if(el)el.textContent=state.phase==='betting'?formatTimer(remaining):'00:00';
 const guessing=document.getElementById('guess-timer');
 if(guessing)guessing.textContent=state.phase==='guessing'?(state.guessingDeadline?formatTimer(state.guessingDeadline-Date.now()):'Time up'):'00:00';
}
function guessingTimerSettings(){
 if(!state.host)return '';
 return `<div class="row"><label class="field">Guessing timer (seconds, 15–1800)<input id="guessing-seconds" type="number" min="15" max="1800" step="1" value="${state.guessingSeconds||120}"></label><button class="secondary" id="set-guessing-timer">${state.phase==='guessing'?'Apply & restart guessing timer':'Set guessing timer'}</button></div><p class="muted">Default 2 minutes. The host can end guessing early. Changing the duration during guessing restarts the countdown.</p>`;
}
function timerSettings(){
 if(!state.host)return '';
 return `<div class="row"><label class="field">Betting timer (seconds, 15–1800)<input id="timer-seconds" type="number" min="15" max="1800" step="1" value="${state.bettingSeconds||180}"></label><button class="secondary" id="set-timer">${state.phase==='betting'?'Apply & restart timer':'Set betting timer'}</button></div><p class="muted">Default 3 minutes. Change it before a round or while betting; applying during betting restarts the countdown.</p>`;
}
function betting(){
 const editable=state.phase==='betting';
 const own=state.ownBets||[];
 const chosen=own.find(b=>b.slot===activeSlot);
 const available=myChips()+(chosen?.extra||0);
 return `<div class="panel stack"><div class="eyebrow">Round ${state.round} · ${editable?'Live public betting':'Betting closed'}</div><div class="question">${esc(state.question)}</div>
 <p>Bet on the closest guess <strong>without going over</strong>, or choose <strong>All Answers Too High</strong>. Everyone can see chip placements and changes live. Your two permanent chips return each round.</p>
 <div class="row"><span class="pill">⏱ <strong id="bet-timer">${formatTimer((state.bettingDeadline||0)-Date.now())}</strong></span><span class="pill">${editable?'Betting open · changes allowed':'Bets locked'}</span></div>
 ${timerSettings()}
 ${reopenControls()}
 ${state.isPlayer&&editable?`<div class="bet-controls"><div class="muted">CHOOSE A PERMANENT CHIP</div><div class="row"><button class="${activeSlot===0?'':'secondary'}" data-slot="0">🟡 Chip 1</button><button class="${activeSlot===1?'':'secondary'}" data-slot="1">🟡 Chip 2</button></div><p class="muted">Select a card on the live board. You can change either chip until betting closes.</p></div>`:''}
 ${playerLegend()}
 <div id="live-board">${board(false)}</div>
 ${state.isPlayer&&editable?`<div class="bet-controls"><label class="field">Extra earned chips under chip ${activeSlot+1} (optional)<input id="amount" type="number" min="0" max="${available}" step="1" value="${chosen?.extra??betAmount}"></label><p class="muted">Earned chips available: <span id="chips-available">${fmt(myChips())}</span></p><button id="place" ${selected===null?'disabled':''}>Place / update chip ${activeSlot+1}</button><p class="muted"><span id="bet-summary">${own.length}/2 permanent chips placed</span>. All bets are public and editable until the deadline.</p></div>`:(state.host&&editable?'<button id="advance">Close betting now →</button>':state.host?'<button id="advance">Reveal the correct answer →</button>':'<p class="muted">Waiting for the host.</p>')}
 </div>`;
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
function wireBoardChoices(){
 document.querySelectorAll('[data-option]').forEach(el=>{const choose=()=>{selected=el.dataset.option;document.querySelectorAll('[data-option]').forEach(lane=>lane.classList.toggle('lane-selected',lane.dataset.option===selected));const place=document.getElementById('place');if(place)place.disabled=false;};el.onclick=choose;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose()}}});
}
function render(){if(!state)return renderWelcome();const oldGuess=document.getElementById('guess');const guessFocused=oldGuess&&document.activeElement===oldGuess;const cursor=guessFocused?oldGuess.selectionStart:null;root.innerHTML=renderGameHeader()+({lobby,guessing,betting,'open-bets':betting,'final-betting':betting,'locked-bets':betting,results,finished}[state.phase]?.()||'')+(state.phase==='lobby'?'':leaderboard())+recoveryPanel();updateBetTimer();
 const guessInput=document.getElementById('guess');
 guessInput?.addEventListener('input',()=>{guessDraft=guessInput.value;});
 if(guessFocused&&guessInput){guessInput.focus({preventScroll:true});try{if(cursor!==null)guessInput.setSelectionRange(cursor,cursor)}catch{}}
 document.querySelectorAll('[data-recover]').forEach(el=>el.addEventListener('click',async()=>{
  const p=state.recoveryPlayers?.[Number(el.dataset.recover)];if(!p)return;
  const url=new URL('/',location.origin);url.searchParams.set('room',state.code);url.searchParams.set('resume',p.playerToken);
  try{await navigator.clipboard.writeText(url.href);notice('Private rejoin link copied for '+p.name)}catch{window.prompt('Copy private rejoin link for '+p.name,url.href)}
 }));
 document.getElementById('reopen-guessing')?.addEventListener('click',()=>{
  if(state.phase==='betting'||state.phase==='locked-bets'){
   if(!confirm('Reopening guesses will clear all placed bets and refund extra chips. Continue?'))return;
  }
  send('reopenGuessing',{},()=>notice('Guessing reopened'));
 });
 document.getElementById('reopen-betting')?.addEventListener('click',()=>send('reopenBetting',{},()=>notice('Betting reopened')));
 document.getElementById('advance')?.addEventListener('click',()=>send('advance',{}));
 document.getElementById('submitGuess')?.addEventListener('click',()=>{const input=document.getElementById('guess');if(!input.value.trim())return notice('Enter a number');send('guess',{value:Number(input.value)},()=>{guessDraft=null;notice('✓ Guess saved!')})});
 document.querySelectorAll('[data-layout]').forEach(el=>el.addEventListener('click',()=>setBoardLayout(el.dataset.layout)));
 wireBoardChoices();
 document.querySelectorAll('[data-slot]').forEach(el=>el.onclick=()=>{activeSlot=Number(el.dataset.slot);selected=state.ownBets?.find(b=>b.slot===activeSlot)?.optionId??null;betAmount=0;render()});
 document.getElementById('amount')?.addEventListener('input',e=>{betAmount=Number(e.target.value)});
 document.getElementById('set-guessing-timer')?.addEventListener('click',()=>{
  const seconds=Number(document.getElementById('guessing-seconds').value);
  send('setGuessingTimer',{seconds},()=>notice('Guessing timer updated'));
 });
 document.getElementById('set-timer')?.addEventListener('click',()=>{
  const seconds=Number(document.getElementById('timer-seconds').value);
  send('setBettingTimer',{seconds},()=>notice('Betting timer updated'));
 });
 document.getElementById('place')?.addEventListener('click',()=>{const amount=Number(document.getElementById('amount').value);send('bet',{slot:activeSlot,optionId:selected,extra:amount},()=>{notice('Chip '+(activeSlot+1)+' saved!');if(activeSlot===0&&!state.ownBets?.some(b=>b.slot===1)){activeSlot=1;selected=null;betAmount=0;render()}})});
 document.getElementById('copy')?.addEventListener('click',async()=>{const url=`${location.origin}/?room=${state.code}&join=1`;try{await navigator.clipboard.writeText(url);notice('Invite link copied!')}catch{notice(url)}});
 document.getElementById('newGame')?.addEventListener('click',()=>{try{sessionStorage.removeItem('wb_auth');localStorage.removeItem('wb_auth_last');if(state?.code)localStorage.removeItem('wb_auth_'+state.code)}catch{}state=null;auth=null;history.replaceState({},'','/');renderWelcome()});
}
renderWelcome();
timerTick=setInterval(updateBetTimer,250);
if(!socket){document.getElementById('connection').textContent='Connection unavailable';notice('Unable to load live connection. Refresh this page.');}
