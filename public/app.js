window.__gameScriptLoaded=true;
const root=document.getElementById('app');
const socket=typeof io==='function'?io({transports:['polling','websocket'],timeout:12000,reconnection:true,reconnectionAttempts:Infinity}):null;
const params=new URLSearchParams(location.search);const initialRoom=(params.get('room')||'').toUpperCase();const forceJoin=params.get('join')==='1';const recoveryToken=params.get('resume');
let state=null,auth=null,selected=null,betAmount=0,activeSlot=0,hostMeta=null;
let joinedThisPage=false;
let soundEnabled=localStorage.getItem('wits-sound')==='on';
let audioCtx=null;
function playCue(kind){if(!soundEnabled)return;try{audioCtx??=new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();const now=audioCtx.currentTime;const notes=kind==='reveal'?[523,659,784]:kind==='bet'?[440,660]:[660];notes.forEach((freq,i)=>{const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(.0001,now+i*.12);gain.gain.exponentialRampToValueAtTime(.055,now+i*.12+.02);gain.gain.exponentialRampToValueAtTime(.0001,now+i*.12+.2);osc.connect(gain);gain.connect(audioCtx.destination);osc.start(now+i*.12);osc.stop(now+i*.12+.21);});}catch(e){}}
function updateSoundToggle(){const b=document.getElementById('sound-toggle');if(b)b.textContent=soundEnabled?'🔊 Sounds on':'🔇 Sounds off';}
let joinAvatar=null;
async function resizeAvatar(file){
 if(!file.type.startsWith('image/'))throw Error('Choose an image file.');
 if(file.size>12000000)throw Error('Choose a photo smaller than 12 MB.');
 const url=URL.createObjectURL(file);
 try{
  const img=new Image();img.src=url;await img.decode();
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=160;
  const ctx=canvas.getContext('2d');const side=Math.min(img.naturalWidth,img.naturalHeight);
  ctx.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,160,160);
  return canvas.toDataURL('image/jpeg',.78);
 }finally{URL.revokeObjectURL(url)}
}
function avatar(name,sz='sm'){
 const p=state?.players?.find(p=>p.name===name);
 const image=p?.avatar;
 return `<span class="avatar-ring avatar-${sz}" style="--avatar-ring:${p?.color||'#7589df'}">${image?`<img src="${esc(image)}" alt="">`:`<span>${esc((name||'?').slice(0,1).toUpperCase())}</span>`}</span>`;
}
// Preserve an unsubmitted guess when other players trigger live state updates.
let guessDraft=null;
let timerTick=null;
let boardPreference=null;
try{const saved=localStorage.getItem('wb_board_layout');if(['vertical','horizontal'].includes(saved))boardPreference=saved;}catch{}
function boardLayout(){return boardPreference||(state?.host?'horizontal':'vertical');}
function setBoardLayout(layout){if(!['vertical','horizontal'].includes(layout))return;boardPreference=layout;try{localStorage.setItem('wb_board_layout',layout);}catch{}const scroller=document.querySelector('.tabletop-scroll');if(!scroller){render();return;}scroller.classList.toggle('vertical-mode',layout==='vertical');scroller.scrollLeft=0;document.querySelectorAll('[data-layout]').forEach(btn=>{const active=btn.dataset.layout===layout;btn.classList.toggle('secondary',!active);btn.setAttribute('aria-pressed',String(active));});const footer=scroller.querySelector('.tabletop-footer');if(footer)footer.textContent='🎬 Everyone’s chips are visible '+(layout==='horizontal'?'· Swipe sideways to see every guess ✦':'✦');}
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=x=>Number(x).toLocaleString('en-US');
function notice(message){const t=document.getElementById('toast');t.textContent=message;t.classList.remove('hidden');clearTimeout(notice.timer);notice.timer=setTimeout(()=>t.classList.add('hidden'),3500)}
function send(event,payload,callback){if(!socket?.connected){notice('Offline — change not saved. Reconnect and retry.');return;}socket.timeout(10000).emit(event,payload,(timeout,r)=>{if(timeout||!r?.ok){notice(timeout?'No server confirmation — please retry.':r?.error||'Something went wrong');return;}callback?.(r)})}
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
 if(a?.hostToken)send('resumeHost',a,()=>{save(a);cleanRecoveryUrl();const e=document.getElementById('network-banner');if(e)e.textContent='';});
 else if(a?.playerToken)send('join',a,r=>{save({code:a.code,playerToken:r.playerToken,name:r.name});cleanRecoveryUrl();const e=document.getElementById('network-banner');if(e)e.textContent='';});
}
socket?.on('connect',()=>{document.getElementById('connection').textContent='● Live';const e=document.getElementById('network-banner');if(e)e.textContent='';const a=stored();if(a)resumeSession(a);else renderWelcome();});
socket?.on('disconnect',()=>{document.getElementById('connection').textContent='○ Reconnecting…';const e=document.getElementById('network-banner');if(e)e.textContent='Connection lost — reconnecting. Unsaved changes must be resubmitted.';});
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
 const changed=state?.phase!==s.phase||state?.round!==s.round||state?.question!==s.question;
 if(changed&&s.phase==='results')playCue('reveal');
 const liveOnly=!changed&&s.phase==='betting'&&state?.phase==='betting';
 const lobbyOnly=!changed&&s.phase==='lobby'&&state?.phase==='lobby';
 const guessingOnly=!changed&&s.phase==='guessing'&&state?.phase==='guessing';
 if(changed){selected=null;activeSlot=0;betAmount=0;guessDraft=null;}
 state=s;
 if(changed&&s.phase==='betting'&&selected===null)selected=s.ownBets?.find(b=>b.slot===activeSlot)?.optionId??null;
 if(liveOnly&&document.getElementById('live-board')){
   // Update only the public board, not the betting controls/input being used.
   const el=document.getElementById('live-board');
   el.innerHTML=board(false);
   wireBoardChoices();
   document.querySelectorAll('#live-board [data-layout]').forEach(el=>el.addEventListener('click',()=>setBoardLayout(el.dataset.layout)));
   const saved=document.getElementById('bet-saved');if(saved){const current=s.ownBets?.find(b=>b.slot===activeSlot);saved.textContent=current?'✓ Chip '+(activeSlot+1)+' saved':'Chip not placed yet';}
   const summary=document.getElementById('bet-summary');
   if(summary)summary.textContent=(s.ownBets||[]).length+'/2 permanent chips placed';
   const chips=document.getElementById('chips-available');
   if(chips)chips.textContent=fmt(myChips());
   updateBetTimer();updatePauseControls();updateHostProgress();
 }else if(lobbyOnly){
   const count=document.getElementById('lobby-player-count');if(count)count.textContent=s.players.length+' / 30 players';
   const list=document.getElementById('lobby-player-list');if(list)list.innerHTML=s.players.map(p=>`<span class="pill player-pill">${avatar(p.name)} ${esc(p.name)}</span>`).join('');
   const start=document.getElementById('advance');if(start)start.disabled=s.players.length<2;
 }else if(guessingOnly){
   // Do not rebuild forms when a peer submits a guess.
   const counter=document.getElementById('live-guess-status');
   if(counter)counter.textContent=s.players.filter(p=>p.submitted).length+' of '+s.players.length+' guesses submitted';
   document.querySelectorAll('[data-guess-player]').forEach(el=>{const p=s.players.find(p=>p.id===el.dataset.guessPlayer);if(p){el.classList.toggle('arrived',p.submitted);el.classList.toggle('waiting',!p.submitted);}});
   document.querySelectorAll('[data-guess-status]').forEach(el=>{
     const p=s.players.find(p=>p.id===el.dataset.guessStatus);
     if(p)el.textContent=(p.submitted?'✓':'…')+' '+p.name;
   });
   document.querySelectorAll('[data-test-person-status]').forEach(el=>{
     const p=s.players.find(p=>p.id===el.dataset.testPersonStatus);
     if(p)el.textContent=p.submitted?'✓ Guess submitted':'Not submitted';
   });
   updateBetTimer();updatePauseControls();
   updateHostProgress();
 }else render();
});
socket?.on('notice',x=>notice(x.error||x.message));
socket?.on('connect_error',e=>{document.getElementById('connection').textContent='○ Reconnecting…';console.warn('Connection issue',e.message)});
function renderWelcome(){if(state)return;root.innerHTML=`<div class="hero"><div class="eyebrow">THE TRIVIA GAME NIGHT</div><h1>Guess big.<br>Bet bold.</h1><p>Choose Bollywood or cricket, answer seven surprise number questions, and compete with live bets.</p></div><div class="split"><section class="panel stack"><h2>Host a new game</h2><p>Put the host screen on your TV. Guests join with a code or QR scan.</p><div class="pill">🎲 7 random questions per game</div><label class="field">Choose game category<select id="category"><option value="bollywood">🎬 Bollywood</option><option value="cricket">🏏 Cricket</option></select></label><button id="create">Create game room</button><button class="secondary" id="test-create">🧪 Try Test Mode · 4 simulated players</button></section><section class="panel stack"><h2>📱 Join a game</h2><p>Enter the room code from your host's screen. Each browser tab can join as a different player.</p><label class="field">Room code<input id="room" placeholder="ABC123" maxlength="6" value="${esc(initialRoom)}" autocapitalize="characters"></label><label class="field">Your name<input id="name" placeholder="e.g. Alex" maxlength="24"></label><label class="field">Your photo (optional)<input id="join-photo" type="file" accept="image/*"></label><div id="photo-preview" class="photo-preview"><span class="avatar-ring avatar-lg"><span>☺</span></span><span>Choose a photo to personalize your player chip</span></div><button id="join">Join game</button></section></div>`;
 document.getElementById('create').onclick=()=>send('create',{rounds:7,category:document.getElementById('category').value,origin:location.origin},r=>{hostMeta=r;save({code:r.code,hostToken:r.hostToken});render();history.replaceState({},'',`/?room=${r.code}`)});
 document.getElementById('test-create').onclick=()=>send('create',{testMode:true,category:document.getElementById('category').value,origin:location.origin},r=>{hostMeta=r;save({code:r.code,hostToken:r.hostToken});history.replaceState({},'',`/?room=${r.code}`);render();notice('Test room ready — four simulated players joined!')});
 document.getElementById('join-photo').onchange=async e=>{const file=e.target.files?.[0];joinAvatar=null;if(!file)return;try{joinAvatar=await resizeAvatar(file);document.getElementById('photo-preview').innerHTML=`<span class="avatar-ring avatar-lg"><img src="${joinAvatar}" alt="Your selected photo"></span><span>Photo ready ✓</span>`;}catch(err){notice(err.message);e.target.value='';}};
 document.getElementById('join').onclick=()=>{const code=document.getElementById('room').value.trim().toUpperCase(),name=document.getElementById('name').value.trim();send('join',{code,name,avatar:joinAvatar},r=>{save({code,playerToken:r.playerToken,name:r.name});history.replaceState({},'',`/?room=${code}`)})};
}
function testPanel(){
 if(!state?.host||!state.testMode)return '';
 const players=state.players;
 const stage=state.phase;
 return `<section class="panel test-panel section"><div class="row between"><div><div class="eyebrow">TEST MODE · PRIVATE SANDBOX</div><h2>Simulation dashboard</h2></div><span class="pill">4 simulated players</span></div>
 <p class="muted">Control the bots from this screen. These actions use the real multiplayer game engine. No extra phones needed.</p>
 <div class="row"><button class="secondary" data-test="advance">${stage==='lobby'?'▶ Start test game':stage==='guessing'?'▶ End guessing':stage==='betting'?'▶ Lock bets':stage==='locked-bets'?'▶ Reveal answer':stage==='results'?'▶ Next round':'Game complete'}</button>
 ${stage==='guessing'?'<button data-test="autoGuess">🎲 Auto-fill missing guesses</button><button class="secondary" data-test="resetGuesses">Clear bot guesses</button>':''}
 ${stage==='betting'?'<button data-test="autoBet">🎲 Auto-place all bets</button><button class="secondary" data-test="resetBets">Clear bot bets</button>':''}</div>
 ${['guessing','betting'].includes(stage)?`<div class="test-grid">${players.map(p=>`<div class="test-person"><div class="row">${avatar(p.name)}<strong>${esc(p.name)}</strong></div>${stage==='guessing'?`<div class="muted" data-test-person-status="${esc(p.id)}">Guess: ${p.submitted?'✓ Submitted':'Not submitted'}</div><label class="field">Enter a test guess<input type="number" min="0" max="1000000000" value="" data-test-value="${esc(p.id)}" placeholder="Number"></label><button class="secondary" data-test-guess="${esc(p.id)}">Submit guess</button>`:`<div class="muted">Place a test chip</div><label class="field">Betting lane<select data-test-option="${esc(p.id)}">${(state.guesses||[]).map(o=>`<option value="${esc(o.id)}">${esc(optionLabel(o))}</option>`).join('')}</select></label><button class="secondary" data-test-bet="${esc(p.id)}">Place chip 1</button>`}</div>`).join('')}</div>`:''}
 <p class="muted">Tip: Try replacing a question, reopening stages, or leaving one player without a guess to test edge cases. You can still use the regular host controls below.</p></section>`;
}
function updateHostProgress(){const e=document.getElementById('host-progress');if(!e||!state?.host)return;if(state.phase==='betting'){const bets=state.publicBets||[];const missing=state.players.map(p=>({name:p.name,count:bets.filter(b=>b.name===p.name).length})).filter(p=>p.count<2);e.innerHTML=`<strong>${state.players.length-missing.length}/${state.players.length} players placed both chips</strong><div class="progress-track"><div style="width:${state.players.length?(state.players.length-missing.length)/state.players.length*100:0}%"></div></div><small>${missing.length?'Still placing: '+esc(missing.map(p=>p.name+' ('+p.count+'/2)').join(', ')):'Everyone has placed both chips!'}</small>`;return;}const done=state.players.filter(p=>p.submitted);e.innerHTML=`<strong>${done.length} / ${state.players.length} guesses submitted</strong><div class="progress-track"><div style="width:${state.players.length?done.length/state.players.length*100:0}%"></div></div><small>Waiting for: ${esc(state.players.filter(p=>!p.submitted).map(p=>p.name).join(', ')||'Nobody — all ready!')}</small>`;}
function renderGameHeader(){return `<div class="row between section"><span class="pill">ROOM ${esc(state.code)}</span><span class="pill">${state.phase==='lobby'?'Waiting for players':state.phase==='finished'?'Game complete':`Round ${state.round} / ${state.maxRounds}`}</span>${state.isPlayer?`<span class="pill">◈ ${fmt(myChips())} earned chips</span>`:''}<button id="sound-toggle" class="secondary sound-toggle">${soundEnabled?'🔊 Sounds on':'🔇 Sounds off'}</button></div>`}
function recoveryPanel(){
 if(!state?.host||state.phase==='finished')return '';
 const players=state.recoveryPlayers||[];
 return `<section class="panel section"><h3>🔄 Player rejoin links</h3><p class="muted">If someone closes their browser or loses their place, send them their personal rejoin link. It restores their same player, chips, guesses and current round. Share each link privately.</p><div class="row">${players.map((p,i)=>`<button class="secondary" data-recover="${i}">Copy ${esc(p.name)}'s rejoin link</button>`).join('')}</div></section>`;
}
function myChips(){return state.players.find(p=>p.name===auth?.name)?.chips??0}
function leaderboard(){return `<section class="panel section"><h2>🏆 Leaderboard</h2><table class="leaderboard"><thead><tr><th>Rank</th><th>Player</th><th>Earned chips</th></tr></thead><tbody>${state.players.map((p,i)=>`<tr><td>${i+1}</td><td>${avatar(p.name)} ${esc(p.name)} ${p.connected?'🟢':'⚪'}</td><td><strong>${fmt(p.chips)}</strong></td></tr>`).join('')}</tbody></table></section>`}
function lobby(){return `<div class="panel stack"><div class="eyebrow">${esc(state.category||'bollywood')} · Game lobby</div><h1 style="margin:0">Ready to play?</h1><p>Waiting for the host to begin. Share this room code with friends.</p><div class="code">${esc(state.code)}</div>${state.host?`<div class="hostjoin"><img id="qr" alt="QR code to join game" src="/qr/${encodeURIComponent(state.code)}"><div><p>Scan to join from any phone.</p><div class="row"><button class="secondary" id="copy">Copy invite link</button></div></div></div>`:''}${guessingTimerSettings()}${timerSettings()}<div class="row"><span class="pill" id="lobby-player-count">${state.players.length} / 30 players</span><span class="pill">${state.maxRounds} rounds</span></div><div class="row" id="lobby-player-list">${state.players.map(p=>`<span class="pill player-pill">${avatar(p.name)} ${esc(p.name)}</span>`).join('')}</div>${state.host?`<button id="advance" ${state.players.length<2?'disabled':''}>Start game →</button>`:'<p class="muted">The host will start when everyone is ready.</p>'}</div>`}
function reopenControls(){
 if(!state.host)return '';
 if(state.phase==='guessing')return '<button class="secondary" id="reopen-guessing">Restart guessing timer</button>';
 if(state.phase==='betting')return '<button class="secondary" id="reopen-guessing">Reopen guessing (reset bets)</button>';
 if(state.phase==='locked-bets')return '<div class="row"><button class="secondary" id="reopen-betting">Reopen betting</button><button class="secondary" id="reopen-guessing">Reopen guessing (reset bets)</button></div>';
 return '';
}
function guessing(){return `<div class="panel stack"><div class="eyebrow">${esc(state.category||'bollywood')} · Round ${state.round} · Secret guesses</div><div class="question">${esc(state.question)}</div><div id="host-progress" class="host-progress"></div><div class="guess-arrivals"><div class="guess-arrivals-heading"><strong>Who has submitted?</strong><span id="live-guess-status">${state.players.filter(p=>p.submitted).length} of ${state.players.length} guesses received</span></div><div class="guess-arrivals-list">${state.players.map(p=>`<span class="guess-arrival ${p.submitted?'arrived':'waiting'}" data-guess-player="${esc(p.id)}">${avatar(p.name)} <span data-guess-status="${esc(p.id)}">${p.submitted?'✓':'…'} ${esc(p.name)}</span></span>`).join('')}</div><p class="muted">Only submission status is visible. Everyone’s actual number stays secret until guessing ends.</p></div><div class="row">${pauseControls()}<strong id="pause-indicator" class="pause-indicator">${state.paused?'⏸ GAME PAUSED':''}</strong><span class="pill">⏱ Guessing: <strong id="guess-timer">${formatTimer((state.guessingDeadline||0)-Date.now())}</strong></span></div>${state.isPlayer?`<p>Enter your best numerical guess. Other players won't see it until the host reveals all guesses.</p><label class="field">Your numerical answer<input id="guess" type="number" min="0" max="1000000000" step="1" placeholder="Enter a whole number" value="${esc(guessDraft??state.ownGuess??'')}"></label><button id="submitGuess">${state.ownGuess===null?'Submit guess':'Update guess'}</button><div id="guess-saved" class="save-status">${state.ownGuess!==null?'✓ Saved answer: '+fmt(state.ownGuess):'Not submitted yet'}</div>`:`${guessingTimerSettings()}${timerSettings()}${reopenControls()}<button class="secondary" id="replace-question">↻ Replace this question</button><p class="muted">Already seen this question? Replace it with an unused random question. Existing guesses for this question will be cleared.</p><button id="advance">End guessing early →</button>`}</div>`}
function optionLabel(o){return o?.id==='all-high'?'ALL TOO HIGH':o?.value===null?'ALL TOO HIGH':fmt(o?.value)}
function playerColor(name){return state.players.find(p=>p.name===name)?.color||'#ffd166'}
function playerLegend(){return `<div class="player-legend"><strong>PLAYER COLORS</strong><div class="legend-items">${state.players.map(p=>`<span class="legend-person">${avatar(p.name)}${esc(p.name)}</span>`).join('')}</div></div>`}
function board(reveal=false){
 const publicPhase=reveal||['betting','locked-bets'].includes(state.phase);
 const bets=publicPhase?(reveal?(state.results?.revealedBets||[]):(state.publicBets||[])):(state.ownBets||[]).map(b=>({...b,name:'You'}));
 const options=state.guesses||[];
 const layout=boardLayout();
 const controls=`<div class="board-layout-switch" aria-label="Board layout"><span>Board view</span><button type="button" class="${layout==='vertical'?'':'secondary'}" data-layout="vertical" aria-pressed="${layout==='vertical'}">☷ Vertical</button><button type="button" class="${layout==='horizontal'?'':'secondary'}" data-layout="horizontal" aria-pressed="${layout==='horizontal'}">▥ Horizontal</button></div>`;
 return controls+`<div class="tabletop-scroll ${layout==='vertical'?'vertical-mode':''}"><div class="tabletop-board" style="--lane-count:${options.length}">
 <div class="tabletop-banner">STUDIO · WITS & BETS <span>${reveal?'THE BIG REVEAL':state.phase==='locked-bets'?'BETS LOCKED':'LIVE PUBLIC BETTING'}</span></div>
 <div class="tabletop-lanes">${options.map((o,i)=>{
 const winner=reveal&&state.results?.winningOptionId===o.id;
 const placed=bets.filter(b=>b.optionId===o.id);
 const editable=!reveal&&['betting','final-betting'].includes(state.phase);
 const chosen=editable&&selected===o.id;
 return `<div class="tabletop-lane ${winner?'lane-winner':''} ${chosen?'lane-selected':''} ${o.id==='all-high'?'lane-all-high':''}" ${editable&&state.isPlayer?'data-option="'+esc(o.id)+'" role="button" tabindex="0"':''}>
 <div class="lane-odds">PAYS ${o.odds}:1</div>
 <div class="lane-chips">${placed.map(p=>`<div class="table-chip ${winner?'winning-chip':''}" style="--player-color:${playerColor(p.name)}">${avatar(p.name)}<b>${esc(p.name)}</b><small>#${p.slot+1}${p.extra?' +'+fmt(p.extra):''}</small></div>`).join('')||'<div class="lane-empty">○</div>'}</div>
 <div class="lane-card"><div class="lane-number">${o.id==='all-high'?'<span class="lane-special">ALL GUESSES<br>TOO HIGH</span>':`<span>${fmt(o.value)}</span>`}</div>${o.id==='all-high'?'':`<div class="lane-guess-label">GUESSED BY</div><div class="guess-owners">${(o.guessers||[]).map(g=>`<span class="guess-owner ${winner?'winning-guesser':''}" style="--player-color:${g.color}">${avatar(g.name)}${esc(g.name)}</span>`).join('')}</div>`}</div>
 ${winner?'<div class="lane-winning-label">🏆 WINNER</div>':chosen?'<div class="lane-selected-label">✓ SELECTED</div>':''}
 </div>`}).join('')}</div>
 <div class="tabletop-footer">🎬 ${publicPhase?'Everyone’s chips are visible':'Only your chips are visible'} ${layout==='horizontal'?'· Swipe board sideways if needed':''} ✦</div>
 </div></div>`;
}
function formatTimer(ms){const sec=Math.max(0,Math.ceil(ms/1000));return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');}
function pauseControls(){return state?.host&&['guessing','betting'].includes(state.phase)?`<button id="pause-game" class="secondary">${state.paused?'▶ Resume game':'⏸ Pause game'}</button>`:'';}
function updatePauseControls(){const b=document.getElementById('pause-game');if(b)b.textContent=state.paused?'▶ Resume game':'⏸ Pause game';const p=document.getElementById('pause-indicator');if(p)p.textContent=state.paused?'⏸ GAME PAUSED':'';}
function updateBetTimer(){
 const el=document.getElementById('bet-timer');
 if(!state)return;
 const remaining=(state.bettingDeadline||0)-Date.now();
 if(el)el.textContent=state.phase==='betting'?formatTimer(state.paused?(state.pausedRemaining||0):remaining):'00:00';
 const guessing=document.getElementById('guess-timer');
 if(guessing)guessing.textContent=state.phase==='guessing'?(state.paused?formatTimer(state.pausedRemaining||0):state.guessingDeadline?formatTimer(state.guessingDeadline-Date.now()):'Time up'):'00:00';
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
 const chosenLabel=chosen?optionLabel(state.guesses.find(o=>o.id===chosen.optionId)):'Not placed';
 return `<div class="panel stack"><div class="eyebrow">Round ${state.round} · ${editable?'Live public betting':'Betting closed'}</div><div class="question">${esc(state.question)}</div>
 <p>Bet on the closest guess <strong>without going over</strong>, or choose <strong>All Answers Too High</strong>. Everyone can see chip placements and changes live. Your two permanent chips return each round.</p>
 <div class="row"><span class="pill">⏱ <strong id="bet-timer">${formatTimer((state.bettingDeadline||0)-Date.now())}</strong></span><span class="pill">${editable?'Betting open · changes allowed':'Bets locked'}</span></div>
 ${timerSettings()}
 <div class="row">${pauseControls()}<strong id="pause-indicator" class="pause-indicator">${state.paused?'⏸ GAME PAUSED':''}</strong></div>
 ${reopenControls()}
 ${state.isPlayer&&editable?`<div class="bet-controls bet-journey"><div class="bet-step-heading"><strong>Your two betting chips</strong><span id="bet-summary" class="bet-count">${own.length} of 2 placed</span></div><div class="bet-chip-grid">${[0,1].map(slot=>{const b=own.find(x=>x.slot===slot);const o=b?state.guesses.find(x=>x.id===b.optionId):null;return `<button type="button" data-slot="${slot}" class="bet-chip-card ${activeSlot===slot?'bet-chip-active':''} ${b?'bet-chip-placed':''}" aria-pressed="${activeSlot===slot}"><span class="bet-chip-top">${b?'✓':'◉'} CHIP ${slot+1}</span><strong>${b?esc(optionLabel(o)):'Tap to place'}</strong><small>${b?'✓ Placed'+(b.extra?' · +'+fmt(b.extra)+' extra':''):'Not placed yet'}</small></button>`}).join('')}</div><div id="bet-guidance" class="bet-guidance">${own.length===2?'✓ Both permanent chips placed! Tap either chip to move it or adjust extras.':chosen?'Chip '+(activeSlot+1)+' selected. Tap a number to change it.':'Step '+(activeSlot+1)+' of 2: Tap a number on the board, then confirm your chip.'}</div><p class="muted">You can put both chips on the same number or different numbers. Everyone sees your bets live.</p></div>`:''}
 <div id="host-progress" class="host-progress"></div>
 ${playerLegend()}
 <div id="live-board">${board(false)}</div>
 ${state.isPlayer&&editable?`<div class="bet-controls bet-editor"><div class="bet-step-heading"><strong>Chip ${activeSlot+1} · ${chosen?'Edit your bet':'Place your bet'}</strong><span class="bet-balance">◈ <span id="chips-available">${fmt(myChips())}</span> available</span></div><div class="bet-selected-number">Selected number: <strong id="bet-target">${selected===null?'Tap a number above':esc(optionLabel(state.guesses.find(o=>o.id===selected)))}</strong></div><div class="bet-extra-panel"><div><strong>Extra earned chips (optional)</strong><p class="muted">Add more to increase your potential payout, or remove them before betting closes. Your two permanent chips are always free.</p></div><div class="bet-extra-stepper"><button type="button" class="secondary" id="extra-minus" aria-label="Remove one extra chip">−</button><input id="amount" aria-label="Extra earned chips" inputmode="numeric" type="number" min="0" max="${available}" step="1" value="${chosen?.extra??betAmount}"><button type="button" class="secondary" id="extra-plus" aria-label="Add one extra chip">+</button></div><div class="bet-extra-summary">Available to stake on this chip: <strong id="bet-extra-max">${fmt(available)}</strong> · Extra chips are returned if you reduce your bet.</div><button type="button" class="secondary bet-clear-extras" id="extra-clear">Remove all extras</button></div><button id="place" ${selected===null?'disabled':''}>${chosen?'Update Chip '+(activeSlot+1):'Place Chip '+(activeSlot+1)} →</button><div id="bet-saved" class="save-status">${chosen?'✓ Chip '+(activeSlot+1)+' saved on '+esc(chosenLabel):'Chip '+(activeSlot+1)+' not placed yet'}</div></div>`:(state.host&&editable?'<button id="advance">Close betting now →</button>':state.host?'<button id="advance">Reveal the correct answer →</button>':'<p class="muted">Waiting for the host.</p>')}
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
function finished(){const history=state.roundHistory||[];const winner=state.players[0];return `<div class="panel stack"><div class="eyebrow">Final results</div><h1>🎉 Game over!</h1><div class="winner champion-reveal"><div class="muted">🏆 PARTY CHAMPION 🏆</div><div class="big">${esc(state.players[0]?.name||'No winner')}</div><p>${fmt(state.players[0]?.chips||0)} virtual chips</p></div><h2>Round-by-round results</h2><div class="history-scroll"><table class="leaderboard"><thead><tr><th>Round</th>${state.players.map(p=>`<th>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>${history.map(h=>`<tr><td>${h.round}</td>${state.players.map(p=>{const score=h.payouts.find(x=>x.name===p.name);return `<td><strong>+${fmt(score?.payout||0)}</strong><small class="muted"> · ${fmt(score?.total||0)} total</small></td>`}).join('')}</tr>`).join('')}</tbody></table></div><p>Thanks for playing! To host another game, open a new private browser tab and create a fresh room.</p><button class="secondary" id="newGame">Create a new game</button></div>`}
function wireBoardChoices(){
 document.querySelectorAll('[data-option]').forEach(el=>{const choose=()=>{selected=el.dataset.option;document.querySelectorAll('[data-option]').forEach(lane=>lane.classList.toggle('lane-selected',lane.dataset.option===selected));const place=document.getElementById('place');if(place)place.disabled=false;};el.onclick=choose;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose()}}});
}
function render(){if(!state)return renderWelcome();const oldGuess=document.getElementById('guess');const guessFocused=oldGuess&&document.activeElement===oldGuess;const cursor=guessFocused?oldGuess.selectionStart:null;root.innerHTML='<div id="network-banner" class="network-banner"></div>'+renderGameHeader()+testPanel()+({lobby,guessing,betting,'open-bets':betting,'final-betting':betting,'locked-bets':betting,results,finished}[state.phase]?.()||'')+(state.phase==='lobby'?'':leaderboard())+recoveryPanel();updateBetTimer();updateHostProgress();updatePauseControls();
 document.getElementById('sound-toggle')?.addEventListener('click',()=>{soundEnabled=!soundEnabled;localStorage.setItem('wits-sound',soundEnabled?'on':'off');updateSoundToggle();if(soundEnabled)playCue('bet')});
 document.getElementById('pause-game')?.addEventListener('click',()=>send('togglePause',{},()=>notice(state.paused?'Game paused':'Timer updated')));
 document.querySelectorAll('[data-test]').forEach(el=>el.addEventListener('click',()=>send('testAction',{action:el.dataset.test},()=>notice('Test action completed'))));
 document.querySelectorAll('[data-test-guess]').forEach(el=>el.addEventListener('click',()=>{const id=el.dataset.testGuess;const input=[...document.querySelectorAll('[data-test-value]')].find(x=>x.dataset.testValue===id);if(!input?.value.trim())return notice('Enter a number first');send('testAction',{action:'guess',playerId:id,value:Number(input.value)},()=>notice('Bot guess saved'))}));
 document.querySelectorAll('[data-test-bet]').forEach(el=>el.addEventListener('click',()=>{const id=el.dataset.testBet;const select=[...document.querySelectorAll('[data-test-option]')].find(x=>x.dataset.testOption===id);send('testAction',{action:'bet',playerId:id,optionId:select?.value,slot:0},()=>notice('Bot bet placed'))}));
 const guessInput=document.getElementById('guess');
 guessInput?.addEventListener('input',()=>{guessDraft=guessInput.value;});
 if(guessFocused&&guessInput){guessInput.focus({preventScroll:true});try{if(cursor!==null)guessInput.setSelectionRange(cursor,cursor)}catch{}}
 document.querySelectorAll('[data-recover]').forEach(el=>el.addEventListener('click',async()=>{
  const p=state.recoveryPlayers?.[Number(el.dataset.recover)];if(!p)return;
  const url=new URL('/',location.origin);url.searchParams.set('room',state.code);url.searchParams.set('resume',p.playerToken);
  try{await navigator.clipboard.writeText(url.href);notice('Private rejoin link copied for '+p.name)}catch{window.prompt('Copy private rejoin link for '+p.name,url.href)}
 }));
 document.getElementById('replace-question')?.addEventListener('click',()=>{
  if(!confirm('Replace this question? All guesses for this question will be cleared and the 2-minute timer restarted.'))return;
  send('replaceQuestion',{},()=>notice('New random question selected'));
 });
 document.getElementById('reopen-guessing')?.addEventListener('click',()=>{
  if(state.phase==='betting'||state.phase==='locked-bets'){
   if(!confirm('Reopening guesses will clear all placed bets and refund extra chips. Continue?'))return;
  }
  send('reopenGuessing',{},()=>notice('Guessing reopened'));
 });
 document.getElementById('reopen-betting')?.addEventListener('click',()=>send('reopenBetting',{},()=>notice('Betting reopened')));
 document.getElementById('advance')?.addEventListener('click',()=>send('advance',{}));
 document.getElementById('submitGuess')?.addEventListener('click',()=>{const input=document.getElementById('guess');if(!input.value.trim())return notice('Enter a number');send('guess',{value:Number(input.value)},()=>{guessDraft=null;const e=document.getElementById('guess-saved');if(e)e.textContent='✓ Saved answer: '+fmt(Number(input.value));playCue('guess');notice('✓ Guess saved!')})});
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
 document.getElementById('place')?.addEventListener('click',()=>{const amount=Number(document.getElementById('amount').value);send('bet',{slot:activeSlot,optionId:selected,extra:amount},()=>{const e=document.getElementById('bet-saved');if(e)e.textContent='✓ Chip '+(activeSlot+1)+' saved on '+optionLabel(state.guesses.find(o=>o.id===selected));playCue('bet');notice('Chip '+(activeSlot+1)+' saved!');if(activeSlot===0&&!state.ownBets?.some(b=>b.slot===1)){activeSlot=1;selected=null;betAmount=0;render()}})});
 document.getElementById('copy')?.addEventListener('click',async()=>{const url=`${location.origin}/?room=${state.code}&join=1`;try{await navigator.clipboard.writeText(url);notice('Invite link copied!')}catch{notice(url)}});
 document.getElementById('newGame')?.addEventListener('click',()=>{try{sessionStorage.removeItem('wb_auth');localStorage.removeItem('wb_auth_last');if(state?.code)localStorage.removeItem('wb_auth_'+state.code)}catch{}state=null;auth=null;history.replaceState({},'','/');renderWelcome()});
}
renderWelcome();
timerTick=setInterval(updateBetTimer,250);
if(!socket){document.getElementById('connection').textContent='Connection unavailable';notice('Unable to load live connection. Refresh this page.');}
