window.__gameScriptLoaded=true;
const root=document.getElementById('app');
const socket=typeof io==='function'?io({transports:['polling','websocket'],timeout:12000,reconnection:true,reconnectionAttempts:Infinity}):null;
const params=new URLSearchParams(location.search);const initialRoom=(params.get('room')||'').toUpperCase();const forceJoin=params.get('join')==='1';const recoveryToken=params.get('resume');
let state=null,auth=null,selected=null,betAmount=0,activeSlot=0,hostMeta=null;
let joinedThisPage=false;
let presentationMode=false;try{presentationMode=localStorage.getItem('wb_presenter')==='on'}catch{}
let previousArrivalIds=new Set();
let betDraftDirty=false,betSubmitting=false,lastBetWarningRound=null;
let soundEnabled=localStorage.getItem('wits-sound')==='on';
let audioCtx=null;
function playCue(kind){if(!soundEnabled)return;try{audioCtx??=new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();const now=audioCtx.currentTime;const notes=kind==='reveal'?[523,659,784]:kind==='bet'?[440,660]:[660];notes.forEach((freq,i)=>{const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(.0001,now+i*.12);gain.gain.exponentialRampToValueAtTime(.055,now+i*.12+.02);gain.gain.exponentialRampToValueAtTime(.0001,now+i*.12+.2);osc.connect(gain);gain.connect(audioCtx.destination);osc.start(now+i*.12);osc.stop(now+i*.12+.21);});}catch(e){}}
function updateSoundToggle(){const b=document.getElementById('sound-toggle');if(b)b.textContent=soundEnabled?'🔊 Sounds on':'🔇 Sounds off';}
const PRESET_AVATARS=[{"id":"star-batter","file":"star-batter.png","collection":"Cricket Avatars"},{"id":"fast-bowler","file":"fast-bowler.png","collection":"Cricket Avatars"},{"id":"spin-wizard","file":"spin-wizard.png","collection":"Cricket Avatars"},{"id":"wicket-keeper","file":"wicket-keeper.png","collection":"Cricket Avatars"},{"id":"captain","file":"captain.png","collection":"Cricket Avatars"},{"id":"all-rounder","file":"all-rounder.png","collection":"Cricket Avatars"},{"id":"cricket-legend","file":"cricket-legend.png","collection":"Cricket Avatars"},{"id":"six-hitter","file":"six-hitter.png","collection":"Cricket Avatars"},{"id":"cricket-queen","file":"cricket-queen.png","collection":"Cricket Avatars"},{"id":"trophy-champion","file":"trophy-champion.png","collection":"Cricket Avatars"},{"id":"helmet-hero","file":"helmet-hero.png","collection":"Cricket Avatars"},{"id":"stadium-star","file":"stadium-star.png","collection":"Cricket Avatars"},{"id":"lords","file":"lords.png","collection":"Cricket Avatars"},{"id":"mcg","file":"mcg.png","collection":"Cricket Avatars"},{"id":"eden-gardens","file":"eden-gardens.png","collection":"Cricket Avatars"},{"id":"wankhede","file":"wankhede.png","collection":"Cricket Avatars"},{"id":"ashes","file":"ashes.png","collection":"Cricket Avatars"},{"id":"world-cup","file":"world-cup.png","collection":"Cricket Avatars"},{"id":"cricket-ball","file":"cricket-ball.png","collection":"Cricket Avatars"},{"id":"cricket-bat","file":"cricket-bat.png","collection":"Cricket Avatars"},{"id":"stumps-bails","file":"stumps-bails.png","collection":"Cricket Avatars"},{"id":"india-fan","file":"india-fan.png","collection":"Cricket Avatars"},{"id":"team-jersey","file":"team-jersey.png","collection":"Cricket Avatars"},{"id":"cricket-fan","file":"cricket-fan.png","collection":"Cricket Avatars"},{"id":"commentator","file":"commentator.png","collection":"Cricket Avatars"},{"id":"umpire","file":"umpire.png","collection":"Cricket Avatars"},{"id":"dhonis-six","file":"dhonis-six.png","collection":"Iconic Cricket Moments"},{"id":"yuvis-six-sixes","file":"yuvis-six-sixes.png","collection":"Iconic Cricket Moments"},{"id":"dada-at-lords","file":"dada-at-lords.png","collection":"Iconic Cricket Moments"},{"id":"kapils-1983","file":"kapils-1983.png","collection":"Iconic Cricket Moments"},{"id":"sachins-farewell","file":"sachins-farewell.png","collection":"Iconic Cricket Moments"},{"id":"sachin-carried","file":"sachin-carried.png","collection":"Iconic Cricket Moments"},{"id":"jontys-dive","file":"jontys-dive.png","collection":"Iconic Cricket Moments"},{"id":"kohlis-chase","file":"kohlis-chase.png","collection":"Iconic Cricket Moments"},{"id":"2003-uppercut","file":"2003-uppercut.png","collection":"Iconic Cricket Moments"},{"id":"gabba-victory","file":"gabba-victory.png","collection":"Iconic Cricket Moments"},{"id":"stokes-at-headingley","file":"stokes-at-headingley.png","collection":"Iconic Cricket Moments"},{"id":"malingas-yorkers","file":"malingas-yorkers.png","collection":"Iconic Cricket Moments"}];
const avatarAsset=id=>'/avatars/'+(PRESET_AVATARS.find(x=>x.id===id)?.file||'');
const avatarLabel=id=>id.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
let joinAvatar='preset:'+PRESET_AVATARS[0].id;
function avatar(name,sz='sm'){
 const p=state?.players?.find(p=>p.name===name);
 const image=p?.avatar;
 const preset=typeof image==='string'&&image.startsWith('preset:')?PRESET_AVATARS.find(x=>x.id===image.slice(7)):null;
 return `<span class="avatar-ring avatar-${sz}" style="--avatar-ring:${p?.color||'#7589df'}">${preset?`<img src="/avatars/${esc(preset.file)}" alt="">`:image?.startsWith("data:image/")?`<img src="${esc(image)}" alt="">`:`<span>${esc((name||'?').slice(0,1).toUpperCase())}</span>`}</span>`;
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
function send(event,payload,callback){if(!socket?.connected){betSubmitting=false;updateStickyBetBar();notice('Offline — change not saved. Reconnect and retry.');return;}socket.timeout(10000).emit(event,payload,(timeout,r)=>{if(timeout||!r?.ok){betSubmitting=false;updateStickyBetBar();notice(timeout?'No server confirmation — please retry.':r?.error||'Something went wrong');return;}callback?.(r)})}
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
socket?.on('connect',()=>{document.getElementById('connection').textContent='● Live';const e=document.getElementById('network-banner');if(e)e.textContent='✓ Connected — syncing your game…';const a=stored();if(a)resumeSession(a);else renderWelcome();});
socket?.on('removed',payload=>{
  const code=state?.code||auth?.code||initialRoom;
  auth=null;state=null;joinedThisPage=false;
  try{sessionStorage.removeItem('wb_auth');localStorage.removeItem('wb_auth_'+code);localStorage.removeItem('wb_auth_last')}catch{}
  history.replaceState({},'',code?'/?room='+encodeURIComponent(code)+'&join=1':'/');
  renderWelcome();
  notice(payload?.message||'The host removed you. You can join again as a new player.');
});
socket?.on('disconnect',()=>{betSubmitting=false;updateStickyBetBar();document.getElementById('connection').textContent='○ Reconnecting…';const e=document.getElementById('network-banner');if(e)e.textContent='Connection lost — reconnecting. Unsaved changes must be resubmitted.';});
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
 if(changed){lastBetWarningRound=null;selected=null;activeSlot=0;betAmount=0;guessDraft=null;betDraftDirty=false;betSubmitting=false;previousArrivalIds=new Set();}
 state=s;
 const syncBanner=document.getElementById('network-banner');if(syncBanner&&socket?.connected)syncBanner.textContent='';
 if(changed&&s.phase==='betting'&&selected===null)selected=s.ownBets?.find(b=>b.slot===activeSlot)?.optionId??null;
 if(changed&&s.phase==='guessing')previousArrivalIds=new Set(s.players.filter(p=>p.submitted).map(p=>p.id));
 if(liveOnly&&document.getElementById('live-board')){
   // Update only the public board, not the betting controls/input being used.
   const el=document.getElementById('live-board');
   el.innerHTML=board(false);
   wireBoardChoices();
   document.querySelectorAll('#live-board [data-layout]').forEach(el=>el.addEventListener('click',()=>setBoardLayout(el.dataset.layout)));
   const saved=document.getElementById('bet-saved');if(saved&&!betDraftDirty){const current=s.ownBets?.find(b=>b.slot===activeSlot);saved.textContent=current?'✓ Chip '+(activeSlot+1)+' saved':'Chip not placed yet';}
   const summary=document.getElementById('bet-summary');
   if(summary)summary.textContent=(s.ownBets||[]).length+' of 2 placed';
  document.querySelectorAll('[data-slot]').forEach(el=>{const slot=Number(el.dataset.slot);const bet=s.ownBets?.find(b=>b.slot===slot);const o=bet?s.guesses.find(o=>o.id===bet.optionId):null;el.classList.toggle('bet-chip-placed',!!bet);el.classList.toggle('bet-chip-active',slot===activeSlot);el.setAttribute('aria-pressed',String(slot===activeSlot));el.innerHTML='<span class="bet-chip-top">'+(bet?'✓':'◉')+' CHIP '+(slot+1)+'</span><strong>'+(bet?esc(optionLabel(o)):'Tap to place')+'</strong><small>'+(bet?'✓ Placed'+(bet.extra?' · +'+fmt(bet.extra)+' extra':''):'Not placed yet')+'</small>';});
  const guidance=document.getElementById('bet-guidance');if(guidance){const count=(s.ownBets||[]).length;guidance.textContent=count===2?'✓ Both permanent chips placed! Tap either chip to move it or adjust extras.':'Step '+(activeSlot+1)+' of 2: Tap a guess below, then press Save bet.';}
   const chips=document.getElementById('chips-available');
   if(chips)chips.textContent=fmt(myChips());
   updateStickyBetBar();updateBetTimer();updatePauseControls();updateHostProgress();updateBetReadiness();
 }else if(lobbyOnly){
   const count=document.getElementById('lobby-player-count');if(count)count.textContent=s.players.length+' / 30 players';
   const list=document.getElementById('lobby-player-list');if(list)list.innerHTML=s.players.map(p=>`<span class="pill player-pill">${avatar(p.name)} ${esc(p.name)}</span>`).join('');
   const start=document.getElementById('advance');if(start)start.disabled=s.players.length<2;
 }else if(guessingOnly){
   // Do not rebuild forms when a peer submits a guess.
   const counter=document.getElementById('live-guess-status');
   if(counter)counter.textContent=s.players.filter(p=>p.submitted).length+' of '+s.players.length+' guesses submitted';
   document.querySelectorAll('[data-guess-player]').forEach(el=>{const p=s.players.find(p=>p.id===el.dataset.guessPlayer);if(p){el.classList.toggle('arrived',p.submitted);el.classList.toggle('waiting',!p.submitted);if(p.submitted&&!previousArrivalIds.has(p.id)){el.classList.remove('arrival-pop');void el.offsetWidth;el.classList.add('arrival-pop');}}});
   document.querySelectorAll('[data-guess-status]').forEach(el=>{
     const p=s.players.find(p=>p.id===el.dataset.guessStatus);
     if(p)el.textContent=(p.submitted?'✓':'…')+' '+p.name;
   });
   document.querySelectorAll('[data-test-person-status]').forEach(el=>{
     const p=s.players.find(p=>p.id===el.dataset.testPersonStatus);
     if(p)el.textContent=p.submitted?'✓ Guess submitted':'Not submitted';
   });
   previousArrivalIds=new Set(s.players.filter(p=>p.submitted).map(p=>p.id));
   updateBetTimer();updatePauseControls();
   updateHostProgress();
 }else render();
});
socket?.on('notice',x=>notice(x.error||x.message));
socket?.on('connect_error',e=>{document.getElementById('connection').textContent='○ Reconnecting…';console.warn('Connection issue',e.message)});
function renderWelcome(){if(state)return;const playerLanding=forceJoin||!!initialRoom;root.innerHTML=`<div class="hero"><div class="eyebrow">THE TRIVIA GAME NIGHT</div><h1>Guess big.<br>Bet bold.</h1><p>Choose Bollywood or cricket, answer seven surprise number questions, and compete with live bets.</p></div><div class="${playerLanding?'player-landing':'split'}">${playerLanding?'':`<section class="panel stack"><h2>Host a new game</h2><p>Put the host screen on your TV. Guests join with a code or QR scan.</p><div class="pill">🎲 7 random questions per game</div><label class="field">Choose game category<select id="category"><option value="bollywood">🎬 Bollywood</option><option value="cricket">🏏 Cricket</option></select></label><button id="create">Create game room</button><button class="secondary" id="test-create">🧪 Try Test Mode · 4 simulated players</button></section>`}<section class="panel stack join-game-panel"><h2>📱 ${playerLanding?'Join this game':'Join a game'}</h2><p>Enter the room code from your host's screen. Names must be unique. If you get disconnected, enter the same name to resume your game.</p><label class="field">${playerLanding?'Your room code':'Room code'}<input id="room" placeholder="ABC123" maxlength="6" value="${esc(initialRoom)}" autocapitalize="characters"></label><label class="field">Your name<input id="name" placeholder="e.g. Alex" maxlength="24"></label><div class="field"><strong>Choose your cricket avatar</strong><p class="muted">Pick your favorite sticker. Other players can choose the same one.</p>${['Iconic Cricket Moments','Cricket Avatars'].map(group=>`<div class="avatar-group-label">${group==='Iconic Cricket Moments'?'🏆 Iconic cricket moments':'🏏 Cricket favorites'}</div><div class="preset-avatar-grid cricket-avatar-grid" role="group" aria-label="${group}">${PRESET_AVATARS.filter(x=>x.collection===group).map(x=>`<button type="button" class="preset-avatar cricket-avatar" data-avatar-preset="${x.id}" aria-label="${avatarLabel(x.id)}" title="${avatarLabel(x.id)}" aria-pressed="${joinAvatar==='preset:'+x.id}"><img src="/avatars/${x.file}" alt="" loading="lazy"><small>${avatarLabel(x.id)}</small></button>`).join('')}</div>`).join('')}</div><button id="join">Join game</button></section>${playerLanding?`<details class="host-link-disclosure"><summary>Want to host your own game?</summary><p class="muted">Create a separate room for your friends.</p><a class="button secondary" href="/?host=1">Create your own game room</a></details>`:''}</div>`;
 document.getElementById('create')&&(document.getElementById('create').onclick=()=>send('create',{rounds:7,category:document.getElementById('category').value,origin:location.origin},r=>{hostMeta=r;save({code:r.code,hostToken:r.hostToken});render();history.replaceState({},'',`/?room=${r.code}`)}));
 document.getElementById('test-create')&&(document.getElementById('test-create').onclick=()=>send('create',{testMode:true,category:document.getElementById('category').value,origin:location.origin},r=>{hostMeta=r;save({code:r.code,hostToken:r.hostToken});history.replaceState({},'',`/?room=${r.code}`);render();notice('Test room ready — four simulated players joined!')}));
 document.querySelectorAll('[data-avatar-preset]').forEach(el=>el.addEventListener('click',()=>{const id=el.dataset.avatarPreset;if(!PRESET_AVATARS.some(x=>x.id===id))return;joinAvatar='preset:'+id;document.querySelectorAll('[data-avatar-preset]').forEach(x=>x.setAttribute('aria-pressed',String(x===el)));}));
 document.getElementById('join').onclick=()=>{const code=document.getElementById('room').value.trim().toUpperCase(),name=document.getElementById('name').value.trim();send('join',{code,name,avatar:joinAvatar},r=>{save({code,playerToken:r.playerToken,name:r.name});history.replaceState({},'',`/?room=${code}`)})};
}
let testSeatId=null,testSlot=0,testOption=null;
function testPanel(){
 if(!state?.host||!state.testMode)return '';
 const players=state.testPlayers||[];
 const p=players.find(x=>x.id===testSeatId)||players[0];
 if(!p)return '';
 testSeatId=p.id;
 const phase=state.phase;
 const bet=p.bets.find(x=>x.slot===testSlot);
 const selectedOption=testOption??bet?.optionId??null;
 const previewBoard=phase==='betting'?(()=>{const old=state;state={...old,isPlayer:true,host:false,ownBets:p.bets,publicBets:old.publicBets};const html=board(false).replace(/data-option=/g,'data-preview-option=');state=old;return html;})():'';
 return `<section class="panel test-panel test-player-preview">
 <div class="eyebrow">TEST MODE · REAL GAME SIMULATION</div>
 <div class="test-switch"><strong>Viewing as</strong><select id="test-seat" aria-label="Switch simulated player">${players.map(x=>`<option value="${esc(x.id)}" ${x.id===p.id?'selected':''}>${esc(x.name)} · ${fmt(x.chips)} chips</option>`).join('')}</select><span class="pill">Player view</span></div>
 <p class="muted">Switch players above. This preview uses the live game board and the same game rules; actions affect the selected simulated player.</p>
 <div class="test-player-screen"><div class="eyebrow">${phase==='lobby'?'LOBBY · WAITING TO START':`ROUND ${state.round} / ${state.maxRounds} · ${esc(phase.toUpperCase())}`}</div>
 ${phase==='lobby'?'<h2>Waiting for the game to start</h2>':`<div class="question-with-image"><div class="question">${esc(state.question||'')}</div>${state.questionImage?.url?`<img class="question-photo" src="${esc(state.questionImage.url)}" alt="" loading="lazy">`:''}</div>`}
 ${phase==='guessing'?`<div class="test-player-action"><strong>Your private guess</strong><p>${p.guess===null?'Enter a number. Other players cannot see it yet.':'✓ Saved guess: '+fmt(p.guess)}</p><input type="number" id="test-preview-guess" min="0" max="1000000000" placeholder="Your number" value="${p.guess??''}"><button id="test-preview-submit">Submit guess</button></div>`:''}
 ${phase==='betting'?`<div class="test-player-action"><strong>Place up to 2 bets</strong><p>1. Choose a chip · 2. Tap a guess · 3. Save your bet</p><div class="bet-chip-grid">${[0,1].map(slot=>{const x=p.bets.find(z=>z.slot===slot);return `<button type="button" class="bet-chip-card ${slot===testSlot?'bet-chip-active':''} ${x?'bet-chip-placed':''}" data-preview-slot="${slot}"><strong>Chip ${slot+1}</strong><small>${x?'✓ '+esc(optionLabel(state.guesses.find(o=>o.id===x.optionId)))+' · '+(x.extra+1)+' total chips':'Not saved'}</small></button>`}).join('')}</div><div class="test-preview-board">${previewBoard}</div><div class="bet-selected-number">Selected guess: <strong id="test-preview-target">${selectedOption===null?'Tap a guess above':esc(optionLabel(state.guesses.find(o=>o.id===selectedOption)))}</strong></div><div class="field"><label for="test-preview-extra">Extra earned chips on this bet (optional)</label><div class="bet-extra-stepper test-extra-stepper"><button type="button" class="secondary" id="test-extra-minus" aria-label="Remove one extra chip">−</button><input id="test-preview-extra" aria-label="Extra earned chips" inputmode="numeric" type="number" min="0" max="${p.chips+(bet?.extra||0)}" step="1" value="${bet?.extra||0}"><button type="button" class="secondary" id="test-extra-plus" aria-label="Add one extra chip">+</button></div></div><p class="muted">Total stake: <strong id="test-preview-total">${1+(bet?.extra||0)}</strong> chips (1 permanent + extras). Available earned chips: ${fmt(p.chips)}</p><button id="test-preview-bet" ${selectedOption===null?'disabled':''}>Save chip ${testSlot+1} →</button></div>`:''}
 ${phase==='locked-bets'?'<p>Betting is closed. Waiting for the answer reveal.</p>':''}
 ${phase==='results'&&state.results?`<div class="winner reveal-hero"><div class="muted">ACTUAL ANSWER</div><div class="big">${fmt(state.results.answer)}</div><p>${state.results.winningOptionId==='all-high'?'All guesses too high':`Winning guess: ${fmt(state.results.winningValue)}`}</p></div><div class="payout-card"><strong>${esc(p.name)} · Your round payout</strong><span class="big">+${fmt(state.results.payouts.find(x=>x.name===p.name)?.payout||0)}</span></div><p>${esc(state.results.explanation||'')}</p>`:''}
 ${phase==='finished'?`<div class="winner champion-reveal"><strong>GAME OVER</strong><div class="big">${esc(state.players[0]?.name||'Champion')}</div><p>Champion · ${fmt(state.players[0]?.chips||0)} chips</p></div>${awardCards()}`:''}
 </div>
 <details class="test-tools"><summary>Host simulation controls</summary><div class="row"><button class="secondary" data-test="advance">${phase==='lobby'?'Start test game':phase==='guessing'?'End guessing':phase==='betting'?'Lock bets':phase==='locked-bets'?'Reveal answer':phase==='results'?'Next round':'Game complete'}</button>
 ${phase==='guessing'?'<button data-test="autoGuess">Auto-fill missing guesses</button><button class="secondary" data-test="resetGuesses">Clear guesses</button>':''}
 ${phase==='betting'?'<button data-test="autoBet">Auto-place other bets</button><button class="secondary" data-test="resetBets">Clear bets</button>':''}</div></details>
 </section>`;
}
function updateHostProgress(){const e=document.getElementById('host-progress');if(!e||!state?.host)return;if(state.phase==='betting'){const bets=state.publicBets||[];const missing=state.players.map(p=>({name:p.name,count:bets.filter(b=>b.name===p.name).length})).filter(p=>p.count<2);e.innerHTML=`<strong>${state.players.length-missing.length}/${state.players.length} players placed both chips</strong><div class="progress-track"><div style="width:${state.players.length?(state.players.length-missing.length)/state.players.length*100:0}%"></div></div><small>${missing.length?'Still placing: '+esc(missing.map(p=>p.name+' ('+p.count+'/2)').join(', ')):'Everyone has placed both chips!'}</small>`;return;}const done=state.players.filter(p=>p.submitted);e.innerHTML=`<strong>${done.length} / ${state.players.length} guesses submitted</strong><div class="progress-track"><div style="width:${state.players.length?done.length/state.players.length*100:0}%"></div></div><small>Waiting for: ${esc(state.players.filter(p=>!p.submitted).map(p=>p.name).join(', ')||'Nobody — all ready!')}</small>`;}
function betReadiness(){
 if(!state||!['betting','locked-bets'].includes(state.phase))return '';
 const bets=state.publicBets||[];
 const ready=state.players.filter(p=>bets.filter(b=>b.name===p.name).length>=2).length;
 return `<div class="bet-readiness"><div class="bet-readiness-title"><strong>🪙 Betting readiness</strong><span id="bet-readiness-count">${ready} of ${state.players.length} ready</span></div><div class="bet-readiness-players" id="bet-readiness-players">${state.players.map(p=>{const count=bets.filter(b=>b.name===p.name).length;return `<span class="bet-readiness-player ${count===2?'ready':''}" data-bet-player="${esc(p.name)}">${avatar(p.name)} <span>${esc(p.name)}</span> <strong>${count}/2 ${count===2?'✓':''}</strong></span>`}).join('')}</div></div>`;
}
function updateBetReadiness(){
 const container=document.getElementById('bet-readiness-players');if(!container||!state)return;
 const bets=state.publicBets||[];
 const ready=state.players.filter(p=>bets.filter(b=>b.name===p.name).length>=2).length;
 const counter=document.getElementById('bet-readiness-count');if(counter)counter.textContent=ready+' of '+state.players.length+' ready';
 container.innerHTML=state.players.map(p=>{const count=bets.filter(b=>b.name===p.name).length;return `<span class="bet-readiness-player ${count===2?'ready':''}" data-bet-player="${esc(p.name)}">${avatar(p.name)} <span>${esc(p.name)}</span> <strong>${count}/2 ${count===2?'✓':''}</strong></span>`}).join('');
}
function markBetDirty(){
 betDraftDirty=true;
 const status=document.getElementById('bet-draft-status');
 if(status){status.textContent='● Unsaved changes — tap Place / Update to confirm';status.classList.add('unsaved');}
 updateStickyBetBar();
}
function resetBetDirty(){
 betDraftDirty=false;betSubmitting=false;
 const status=document.getElementById('bet-draft-status');
 if(status){status.textContent='✓ All changes saved';status.classList.remove('unsaved');}
 updateStickyBetBar();
}
function roundHighlights(){
 const payouts=state.results?.payouts||[];
 if(!payouts.length)return '';
 const top=Math.max(...payouts.map(p=>p.payout||0));
 const leaders=payouts.filter(p=>(p.payout||0)===top);
 const bonus=payouts.filter(p=>(p.guessBonus||0)>0);
 return `<div class="round-highlights"><div class="eyebrow">✨ ROUND ${state.round} HIGHLIGHTS</div><div class="round-highlights-grid"><div><span>🪙 Biggest round payout</span><strong>${leaders.map(p=>esc(p.name)).join(', ')}</strong><small>+${fmt(top)} earned chips</small></div><div><span>🎯 Best numerical guess</span><strong>${bonus.length?bonus.map(p=>esc(p.name)).join(', '):'No qualifying guess'}</strong><small>${bonus.length?'Bonus chips awarded':'All guesses were too high'}</small></div></div></div>`;
}
function finalShareText(){
 return ['🏆 WITS & BETS · FINAL RESULTS','Room '+state.code,'Champion: '+(state.players[0]?.name||'—'),...state.players.map((p,i)=>(i+1)+'. '+p.name+' — '+fmt(p.chips)+' chips'),'Played '+(state.maxRounds||7)+' rounds · Virtual chips only'].join('\n');
}
function renderGameHeader(){
 const steps=[{key:'guessing',label:'Guess'},{key:'betting',label:'Bet'},{key:'results',label:'Reveal'}];
 const phase=state.phase==='locked-bets'?'betting':state.phase==='finished'?'results':state.phase;
 const stageIndex=steps.findIndex(x=>x.key===phase);
 const round=Math.max(1,state.round||1),total=state.maxRounds||7;
 return `<div class="game-progress"><div class="progress-top"><span class="pill">ROOM ${esc(state.code)}</span><strong>${state.phase==='lobby'?'Waiting to start':`Round ${Math.min(round,total)} of ${total}`}</strong><div class="round-progress-track"><div style="width:${Math.min(100,((Math.min(round,total)-1)/total)*100+(Math.max(0,stageIndex+1)/3)*(100/total))}%"></div></div>${state.isPlayer?`<span class="pill">◈ ${fmt(myChips())} earned</span>`:''}</div><div class="stage-steps">${steps.map((x,i)=>`<span class="stage-step ${i===stageIndex?'stage-current':i<stageIndex?'stage-done':''}">${i<stageIndex?'✓ ':''}${x.label}</span>`).join('')}</div><details class="progress-actions game-preferences"><summary aria-label="Game settings">⚙ Settings</summary><div class="game-preferences-actions"><button id="sound-toggle" class="secondary sound-toggle">${soundEnabled?'🔊 Sounds on':'🔇 Sounds off'}</button>${state.host?`<button id="presentation-toggle" class="secondary sound-toggle" aria-pressed="${presentationMode}">${presentationMode?'Exit presentation':'⛶ Present on TV'}</button>`:''}</div></details></div>`;
}
function stickyBetBar(){
 if(!state.isPlayer||state.phase!=='betting')return '';
 const own=state.ownBets||[];
 const bet=own.find(b=>b.slot===activeSlot);
 return `<div class="sticky-bet-bar" id="sticky-bet-bar"><div class="sticky-bet-meta"><strong>Chip ${activeSlot+1} · ${own.length}/2 placed</strong><small id="sticky-bet-target">${selected===null?'Choose a number':esc(optionLabel(state.guesses.find(o=>o.id===selected)))}</small></div><button id="sticky-place" ${selected===null?'disabled':''}>${bet?'Update':'Place'} chip ${activeSlot+1} →</button></div>`;
}
function updateStickyBetBar(){
 const bar=document.getElementById('sticky-bet-bar');if(!bar||!state)return;
 const own=state.ownBets||[],bet=own.find(b=>b.slot===activeSlot);
 const meta=bar.querySelector('.sticky-bet-meta strong'),target=document.getElementById('sticky-bet-target'),button=document.getElementById('sticky-place');
 if(meta)meta.textContent='Chip '+(activeSlot+1)+' · '+own.length+'/2 placed';
 if(target)target.textContent=selected===null?'Choose a number':optionLabel(state.guesses.find(o=>o.id===selected));
 if(button){button.disabled=selected===null||betSubmitting;button.textContent=betSubmitting?'Saving…':(betDraftDirty?'● Save ':'')+(bet?'Update':'Place')+' chip '+(activeSlot+1)+' →';}
}

function recoveryPanel(){
 if(!state?.host||state.phase==='finished')return '';
 const players=state.recoveryPlayers||[];
 return `<section class="panel section"><h3>🔄 Player rejoin links</h3><p class="muted">If someone closes their browser or loses their place, send them their personal rejoin link. It restores their same player, chips, guesses and current round. Share each link privately.</p><div class="row">${players.map((p,i)=>`<button class="secondary" data-recover="${i}">Copy ${esc(p.name)}'s rejoin link</button>`).join('')}</div></section>`;
}
function myChips(){return state.players.find(p=>p.name===auth?.name)?.chips??0}
function confidenceMeter(){
 const c=state?.confidence;if(!c)return '';
 const width=c.description==='Strong agreement'?20:c.description==='Some disagreement'?56:c.description==='Wildly divided'?94:5;
 return `<section class="crowd-meter" aria-label="Crowd agreement"><div class="row between"><strong>How divided is the crowd?</strong><span>${esc(c.description)}</span></div><div class="crowd-track"><div style="width:${width}%"></div></div><small>${c.count} private guesses · Spread: ${fmt(c.spread)} · Revealed only after guessing closes</small></section>`;
}
function rankMovement(){
 const r=state?.results;if(!r?.rankBefore)return '';
 return `<section class="rank-movement"><h2>Leaderboard shake-up</h2><div class="rank-movement-grid">${state.players.map(p=>{const before=r.rankBefore.indexOf(p.id)+1;const after=r.rankAfter.indexOf(p.id)+1;const delta=before&&after?before-after:0;return `<div class="rank-move ${delta>0?'rank-up':delta<0?'rank-down':''}"><span>${avatar(p.name)} ${esc(p.name)}</span><strong>${before||'—'} → ${after||'—'}</strong><small>${delta>0?'↑ '+delta+' place'+(delta>1?'s':''):delta<0?'↓ '+Math.abs(delta)+' place'+(delta< -1?'s':''):'No change'}</small></div>`}).join('')}</div></section>`;
}
function awardCards(){
 const awards=state.awards||[];
 return awards.length?`<section class="awards"><h2>Game night awards</h2><div class="awards-grid">${awards.map((a,i)=>`<div class="award-card"><span class="award-symbol">${['✦','◎','↗','★'][i%4]}</span><strong>${esc(a.title)}</strong><span>${esc(a.name)}</span><small>${esc(a.detail)}</small></div>`).join('')}</div></section>`:'';
}
function shareableRecap(){
 const awards=state.awards||[];
 return `<section id="recap-card" class="recap-card"><div class="recap-brand">WITS & BETS <span>GAME NIGHT</span></div><h2>Final standings</h2><p>${state.maxRounds||7} rounds · ${esc(state.category||'Trivia')}</p><div class="recap-winner">✦ ${esc(state.players[0]?.name||'Champion')} <strong>${fmt(state.players[0]?.chips||0)} chips</strong></div><div class="recap-list">${state.players.map((p,i)=>`<div><span>#${i+1} ${esc(p.name)}</span><strong>${fmt(p.chips)}</strong></div>`).join('')}</div><div class="recap-awards">${awards.slice(1).map(a=>`<span>${esc(a.title)}: <strong>${esc(a.name)}</strong></span>`).join('')}</div></section>`;
}
async function shareRecapImage(){
 const card=document.getElementById('recap-card');if(!card)return;
 // SVG is generated from escaped text, not an external screenshot dependency.
 const players=state.players.slice(0,20);
 const awards=(state.awards||[]).slice(1,4);
 const h=270+players.length*39+awards.length*30;
 const xmlEscape=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
 const rows=players.map((p,i)=>`<text x="62" y="${240+i*39}" font-size="22" fill="#253a37">#${i+1}  ${xmlEscape(p.name)}</text><text x="680" y="${240+i*39}" font-size="22" text-anchor="end" fill="#253a37">${fmt(p.chips)}</text>`).join('');
 const badges=awards.map((a,i)=>`<text x="62" y="${250+players.length*39+i*30}" font-size="18" fill="#4e6a61">${xmlEscape(a.title+': '+a.name)}</text>`).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="740" height="${h}" viewBox="0 0 740 ${h}"><rect width="740" height="${h}" fill="#f5f4ef"/><rect x="25" y="25" width="690" height="${h-50}" rx="22" fill="#ffffff" stroke="#d9e2dc"/><text x="62" y="89" font-family="Georgia,serif" font-size="41" fill="#263d38">Wits &amp; Bets</text><text x="62" y="124" font-size="16" fill="#667e72">GAME NIGHT · ${xmlEscape(state.category||'Trivia')}</text><text x="62" y="182" font-family="Georgia,serif" font-size="29" fill="#263d38">✦ ${xmlEscape(players[0]?.name||'Champion')} wins!</text>${rows}${badges}</svg>`;
 const blob=new Blob([svg],{type:'image/svg+xml'});const file=new File([blob],'wits-bets-recap.svg',{type:'image/svg+xml'});
 try{if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'Wits & Bets game recap'});return;}}catch(e){if(e.name==='AbortError')return;}
 const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='wits-bets-recap.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function leaderboard(){const me=state.players.find(p=>p.id===state.ownPlayerId)||state.players.find(p=>p.name===auth?.name);const rank=me?state.players.indexOf(me)+1:0;return `<details class="panel section compact-standings" ${state.host?'open':''}><summary><strong>Standings</strong><span>${me?`You: #${rank} · ${fmt(me.chips)} chips`:`${state.players.length} players`} <span class="standings-expand">View all</span></span></summary><table class="leaderboard"><thead><tr><th>Rank</th><th>Player</th><th>Earned chips</th></tr></thead><tbody>${state.players.map((p,i)=>`<tr><td>${i+1}</td><td>${avatar(p.name)} ${esc(p.name)} ${p.connected?'🟢':'⚪'}</td><td><strong>${fmt(p.chips)}</strong></td></tr>`).join('')}</tbody></table></details>`}
function hostPlayerControls(){
 if(!state?.host)return '';
 return `<section class="panel section"><div class="row between"><div><h2 style="margin:0">Manage players</h2><p class="muted" style="margin:5px 0 0">Remove a player so they can join again with a fresh profile and photo.</p></div></div><div class="host-player-list">${state.players.filter(p=>!p.bot).map(p=>`<div class="host-player-row"><span>${avatar(p.name)} <strong>${esc(p.name)}</strong> <small class="muted">${p.connected?'Connected':'Disconnected'} · ${fmt(p.chips)} chips${p.avatar?' · Photo added':' · No photo'}</small></span><button class="secondary" data-remove-player="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">Remove</button></div>`).join('')||'<p class="muted">No players have joined.</p>'}</div></section>`;
}
function lobby(){return `<div class="panel stack"><div class="eyebrow">${esc(state.category||'bollywood')} · Game lobby</div><h1 style="margin:0">Ready to play?</h1><p>Waiting for the host to begin. Share this room code with friends.</p><div class="code">${esc(state.code)}</div>${state.host?`<div class="hostjoin"><img id="qr" alt="QR code to join game" src="/qr/${encodeURIComponent(state.code)}"><div><p>Scan to join from any phone.</p><div class="row"><button class="secondary" id="copy">Copy invite link</button></div></div></div>`:''}${guessingTimerSettings()}${timerSettings()}<div class="row"><span class="pill" id="lobby-player-count">${state.players.length} / 30 players</span><span class="pill">${state.maxRounds} rounds</span></div><div class="row" id="lobby-player-list">${state.players.map(p=>`<span class="pill player-pill">${avatar(p.name)} ${esc(p.name)}</span>`).join('')}</div>${state.host?`<button id="advance" ${state.players.length<2?'disabled':''}>Start game →</button>`:'<p class="muted">The host will start when everyone is ready.</p>'}</div>`}
function reopenControls(){
 if(!state.host)return '';
 if(state.phase==='guessing')return '<button class="secondary" id="reopen-guessing">Restart guessing timer</button>';
 if(state.phase==='betting')return '<button class="secondary" id="reopen-guessing">Reopen guessing (reset bets)</button>';
 if(state.phase==='locked-bets')return '<div class="row"><button class="secondary" id="reopen-betting">Reopen betting</button><button class="secondary" id="reopen-guessing">Reopen guessing (reset bets)</button></div>';
 return '';
}
function guessing(){return `<div class="panel stack"><div class="eyebrow">${esc(state.category||'bollywood')} · Round ${state.round} · Secret guesses</div><div class="question-with-image"><div class="question">${esc(state.question)}</div>${state.questionImage?.url?`<img class="question-photo" src="${esc(state.questionImage.url)}" alt="${esc(state.questionImage.alt||'Cricket')}" loading="lazy" onerror="this.style.display='none'">`:``}</div><div id="host-progress" class="host-progress"></div><div class="guess-arrivals"><div class="guess-arrivals-heading"><strong>Who has submitted?</strong><span id="live-guess-status">${state.players.filter(p=>p.submitted).length} of ${state.players.length} guesses received</span></div><div class="guess-arrivals-list">${state.players.map(p=>`<span class="guess-arrival ${p.submitted?'arrived':'waiting'}" data-guess-player="${esc(p.id)}">${avatar(p.name)} <span data-guess-status="${esc(p.id)}">${p.submitted?'✓':'…'} ${esc(p.name)}</span></span>`).join('')}</div><p class="muted">Only submission status is visible. Everyone’s actual number stays secret until guessing ends.</p></div><div class="row">${pauseControls()}<strong id="pause-indicator" class="pause-indicator">${state.paused?'⏸ GAME PAUSED':''}</strong><span class="pill">⏱ Guessing: <strong id="guess-timer">${formatTimer((state.guessingDeadline||0)-Date.now())}</strong></span></div>${state.isPlayer?`<p>Enter your best numerical guess. Other players won't see it until the host reveals all guesses.</p><label class="field">Your numerical answer<input id="guess" type="number" min="0" max="1000000000" step="1" placeholder="Enter a whole number" value="${esc(guessDraft??state.ownGuess??'')}"></label><button id="submitGuess">${state.ownGuess===null?'Submit guess':'Update guess'}</button><div id="guess-saved" class="save-status">${state.ownGuess!==null?'✓ Saved answer: '+fmt(state.ownGuess):'Not submitted yet'}</div>`:`${guessingTimerSettings()}${timerSettings()}${reopenControls()}<button class="secondary" id="replace-question">↻ Replace this question</button><p class="muted">Already seen this question? Replace it with an unused random question. Existing guesses for this question will be cleared.</p><button id="advance">End guessing early →</button>`}</div>`}
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
 const chosen=editable&&state.isPlayer&&selected===o.id;
 return `<div class="tabletop-lane ${winner?'lane-winner':''} ${chosen?'lane-selected':''} ${o.id==='all-high'?'lane-all-high':''}" ${editable&&state.isPlayer?'data-option="'+esc(o.id)+'" role="button" tabindex="0" aria-label="Select bet on '+(o.id==='all-high'?'all guesses too high':fmt(o.value))+'" aria-pressed="'+chosen+'"':''}>
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
 if(el){const seconds=Math.max(0,state.paused?(state.pausedRemaining||0):remaining)/1000;el.closest('.pill')?.classList.toggle('timer-urgent',state.phase==='betting'&&seconds<=15);el.closest('.pill')?.style.setProperty('--timer-progress',Math.max(0,Math.min(100,seconds/(state.bettingSeconds||180)*100))+'%');}
 if(state.phase==='betting'&&state.isPlayer){const ms=state.paused?(state.pausedRemaining||0):remaining;const count=(state.ownBets||[]).length;if(ms>0&&ms<=15000&&count<2&&lastBetWarningRound!==state.round){lastBetWarningRound=state.round;notice('⏰ Only '+count+'/2 chips placed! Place your remaining chip before betting closes.');}}
 const guessing=document.getElementById('guess-timer');
 if(guessing)guessing.textContent=state.phase==='guessing'?(state.paused?formatTimer(state.pausedRemaining||0):state.guessingDeadline?formatTimer(state.guessingDeadline-Date.now()):'Time up'):'00:00';
 if(guessing){const ms=state.paused?(state.pausedRemaining||0):(state.guessingDeadline||0)-Date.now();guessing.closest('.pill')?.classList.toggle('timer-urgent',state.phase==='guessing'&&ms<=15000);guessing.closest('.pill')?.style.setProperty('--timer-progress',Math.max(0,Math.min(100,ms/((state.guessingSeconds||120)*1000)*100))+'%');}
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
 return `<div class="panel stack"><div class="eyebrow">Round ${state.round} · ${editable?'Live public betting':'Betting closed'}</div><div class="question-with-image"><div class="question">${esc(state.question)}</div>${state.questionImage?.url?`<img class="question-photo" src="${esc(state.questionImage.url)}" alt="${esc(state.questionImage.alt||'Cricket')}" loading="lazy" onerror="this.style.display='none'">`:``}</div>
 ${confidenceMeter()}
 <p class="bet-rule-hint">Pick the guess closest to the answer without going over. Both permanent chips are free and return next round.</p>
 <div class="row"><span class="pill">⏱ <strong id="bet-timer">${formatTimer((state.bettingDeadline||0)-Date.now())}</strong></span><span class="pill">${editable?'Betting open · changes allowed':'Bets locked'}</span></div>
 ${timerSettings()}
 <div class="row">${pauseControls()}<strong id="pause-indicator" class="pause-indicator">${state.paused?'⏸ GAME PAUSED':''}</strong></div>
 ${reopenControls()}
 ${state.isPlayer&&editable?`<div class="bet-controls bet-journey"><div class="bet-step-heading"><strong>Place up to 2 bets</strong><span id="bet-summary" class="bet-count">${own.length} of 2 placed</span></div><div class="bet-chip-grid" aria-label="Choose which chip to place">${[0,1].map(slot=>{const b=own.find(x=>x.slot===slot);const o=b?state.guesses.find(x=>x.id===b.optionId):null;return `<button type="button" data-slot="${slot}" class="bet-chip-card ${activeSlot===slot?'bet-chip-active':''} ${b?'bet-chip-placed':''}" aria-pressed="${activeSlot===slot}"><span class="bet-chip-top">${b?'✓':'◉'} CHIP ${slot+1}</span><strong>${b?esc(optionLabel(o)):'Select this chip'}</strong><small>${b?'✓ Saved'+(b.extra?' · +'+fmt(b.extra)+' extra':'')  :'Not saved yet'}</small></button>`}).join('')}</div><div class="bet-howto"><span><b>1</b> Choose chip</span><span><b>2</b> Tap a guess below</span><span><b>3</b> Save bet</span></div><div id="bet-guidance" class="bet-guidance" role="status" aria-live="polite">${own.length===2?'✓ Both permanent chips placed! Tap either chip to move it or adjust extras.':chosen?'Chip '+(activeSlot+1)+' selected. Tap another guess to move it, then save.':'Step '+(activeSlot+1)+' of 2: Tap a number on the board, then confirm your chip.'}</div><p class="muted">You can put both chips on the same number or different numbers. Everyone sees your bets live.</p></div>`:''}
 <div id="host-progress" class="host-progress"></div>
 ${betReadiness()}
 ${playerLegend()}
 <div id="live-board">${board(false)}</div>
 ${state.isPlayer&&editable?`<div class="bet-controls bet-editor"><div class="bet-step-heading"><strong>Chip ${activeSlot+1} · ${chosen?'Edit your bet':'Place your bet'}</strong><span class="bet-balance">◈ <span id="chips-available">${fmt(myChips())}</span> available</span></div><div class="bet-selected-number">Selected number: <strong id="bet-target">${selected===null?'Tap a number above':esc(optionLabel(state.guesses.find(o=>o.id===selected)))}</strong></div><details class="bet-extra-details" ${chosen?.extra||betAmount?'open':''}><summary>Add more chips to this bet (optional)</summary><div class="bet-extra-panel"><div><strong>Increase your stake</strong><p class="muted">Each bet starts with 1 permanent chip. Add any earned chips here to wager more on this same guess. Extra chips are at risk if the bet loses.</p></div><div class="bet-extra-stepper"><button type="button" class="secondary" id="extra-minus" aria-label="Remove one extra chip">−</button><input id="amount" aria-label="Extra earned chips" inputmode="numeric" type="number" min="0" max="${available}" step="1" value="${chosen?.extra??betAmount}"><button type="button" class="secondary" id="extra-plus" aria-label="Add one extra chip">+</button></div><div class="bet-extra-summary">Total stake: <strong id="bet-total-stake">${1+(chosen?.extra??betAmount)}</strong> chips (1 permanent + extras). Available extras: <strong id="bet-extra-max">${fmt(available)}</strong> · Extra chips are returned if you reduce your bet.</div><button type="button" class="secondary bet-clear-extras" id="extra-clear">Remove all extras</button></div></details><button id="place" ${selected===null?'disabled':''}>${chosen?'Update Chip '+(activeSlot+1):'Place Chip '+(activeSlot+1)} →</button><div id="bet-draft-status" class="bet-draft-status">✓ All changes saved</div><div id="bet-saved" class="save-status">${chosen?'✓ Chip '+(activeSlot+1)+' saved on '+esc(chosenLabel):'Chip '+(activeSlot+1)+' not placed yet'}</div></div>`:(state.host&&editable?'<button id="advance">Close betting now →</button>':state.host?'<button id="advance">Reveal the correct answer →</button>':'<p class="muted">Waiting for the host.</p>')}
 </div>`;
}
function results(){
 const r=state.results;
 return `<div class="panel stack"><div class="eyebrow">Round ${state.round} · Betting reveal</div><div class="question-with-image"><div class="question">${esc(state.question)}</div>${state.questionImage?.url?`<img class="question-photo" src="${esc(state.questionImage.url)}" alt="${esc(state.questionImage.alt||'Cricket')}" loading="lazy" onerror="this.style.display='none'">`:``}</div>
 <div class="winner reveal-hero reveal-sequence-answer"><div class="muted">✨ ACTUAL ANSWER ✨</div><div class="big">${fmt(r.answer)}</div><p>${r.winningOptionId==='all-high'?'🏆 All Answers Too High wins! Every numerical guess was above the actual answer.':`🏆 Winning guess: <strong>${fmt(r.winningValue)}</strong>. Players who guessed it earn +${state.round} bonus chip${state.round===1?'':'s'}.`}</p></div>
 ${confidenceMeter()}
 <h2 class="reveal-sequence-board">🏆 Winning lane, guesses & bets</h2><p class="muted">Every gold chip represents one permanent betting position. Stacked extras are shown alongside the player's name. The winning card is highlighted.</p>
 ${playerLegend()}
 ${board(true)}
 <div class="reveal-highlights reveal-sequence-payout"><div><strong>🎯 Winning original guess</strong><p>${(state.guesses.find(o=>o.id===r.winningOptionId)?.guessers||[]).map(g=>`<span class="winner-person" style="--player-color:${g.color}">${esc(g.name)}</span>`).join(' ')||'No numerical guess qualified.'}</p></div><div><strong>🪙 Winning bets</strong><p>${(r.revealedBets||[]).filter(b=>b.optionId===r.winningOptionId).map(b=>`<span class="winner-person" style="--player-color:${playerColor(b.name)}">${esc(b.name)} · Chip ${b.slot+1}</span>`).join(' ')||'Nobody bet on the winning lane.'}</p></div></div>
 ${roundHighlights()}
 <details class="round-rank-details"><summary>See leaderboard movements</summary>${rankMovement()}</details>
 <div class="answer-fact"><h2>💡 About the answer</h2><p>${esc(r.explanation||'This number describes the event in the question.')}</p></div>
 <h2 class="reveal-sequence-payout">💰 Round payouts</h2><div class="payout-grid">${r.payouts.map(p=>`<div class="payout-card"><strong>${esc(p.name)}</strong><span class="big">+${fmt(p.payout)}</span><small>Bet winnings: +${fmt(p.betWinnings)} · Best guess: +${fmt(p.guessBonus)}</small></div>`).join('')}</div>
 <p class="muted">Both permanent betting chips return next round; earned chips carry forward.</p>${state.host?`<button id="advance">${state.round>=state.maxRounds?'Finish game →':'Next round →'}</button>`:'<p>Waiting for host to start the next round…</p>'}</div>`;
}
function finished(){const history=state.roundHistory||[];const winner=state.players[0];return `<div class="panel stack">${shareableRecap()}${awardCards()}<div class="eyebrow">Final results</div><h1>🎉 Game over!</h1><div class="winner champion-reveal"><div class="muted">🏆 PARTY CHAMPION 🏆</div><div class="big">${esc(state.players[0]?.name||'No winner')}</div><p>${fmt(state.players[0]?.chips||0)} virtual chips</p></div><div class="final-share"><h2>📸 Share your results</h2><p>Capture this scoreboard or copy a formatted summary to your group chat.</p><button id="share-recap" type="button">Share recap card</button><button id="share-results" type="button">Share results</button><button id="copy-results" type="button" class="secondary">Copy scoreboard</button></div><h2>Final standings</h2><div class="final-standings">${state.players.map((p,i)=>`<div class="final-standing"><strong>${i===0?"🥇":i===1?"🥈":i===2?"🥉":"#"+(i+1)} ${avatar(p.name)} ${esc(p.name)}</strong><span>${fmt(p.chips)} chips</span></div>`).join("")}</div><h2>Round-by-round results</h2><div class="history-scroll"><table class="leaderboard"><thead><tr><th>Round</th>${state.players.map(p=>`<th>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>${history.map(h=>`<tr><td>${h.round}</td>${state.players.map(p=>{const score=h.payouts.find(x=>x.name===p.name);return `<td><strong>+${fmt(score?.payout||0)}</strong><small class="muted"> · ${fmt(score?.total||0)} total</small></td>`}).join('')}</tr>`).join('')}</tbody></table></div><p>Thanks for playing! To host another game, open a new private browser tab and create a fresh room.</p><button class="secondary" id="newGame">Create a new game</button></div>`}
function wireBoardChoices(){
 document.querySelectorAll('[data-option]').forEach(el=>{const choose=()=>{selected=el.dataset.option;markBetDirty();document.querySelectorAll('[data-option]').forEach(lane=>lane.classList.toggle('lane-selected',lane.dataset.option===selected));const place=document.getElementById('place');if(place)place.disabled=false;const guide=document.getElementById('bet-guidance');if(guide)guide.textContent='✓ '+optionLabel(state.guesses.find(o=>o.id===selected))+' selected for chip '+(activeSlot+1)+'. Press Save bet to confirm.';updateStickyBetBar();const target=document.getElementById('bet-target');if(target)target.textContent=optionLabel(state.guesses.find(o=>o.id===selected));};el.onclick=choose;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose()}}});
}
let chatOpen=false,chatLastSeen=0,chatUpload=null;
function chatPreview(m){return m?.type==='text'||m?.type==='reaction'?m.value:m?.type==='gif'?'Sent a GIF':'Sent a photo';}
function reactionStage(){
 const now=Date.now();
 const items=(state?.reactions||[]).filter(r=>now-r.at<4500).slice(-5);
 return items.length?`<div class="reaction-stage" aria-label="Recent reactions">${items.map((r,i)=>`<span class="reaction-pop" style="--reaction-index:${i}"><b>${esc(r.value)}</b><small>${esc(r.name)}</small></span>`).join('')}</div>`:'';
}
function gameChat(){
 const messages=state.chat||[];
 const latest=messages[messages.length-1];
 const unread=messages.filter(m=>m.at>chatLastSeen).length;
 const canSend=state.chatEnabled!==false;
 return `<div class="game-chat-widget">
 <button class="chat-peek" id="chat-peek" aria-label="Open game chat" aria-expanded="${chatOpen}" title="Open game chat"><span class="chat-peek-icon">◌</span><span class="chat-peek-copy"><strong>${latest?`${avatar(latest.name)} ${esc(latest.name)}`:'Game chat'}</strong><span>${latest?esc(chatPreview(latest)):'Chat with everyone in the room'}</span></span>${unread&&!chatOpen?`<span class="chat-unread">${Math.min(unread,99)}</span>`:''}<span class="chat-peek-arrow">${chatOpen?'×':'↑'}</span></button>
 ${chatOpen?`<section class="chat-panel" aria-label="Game chat"><div class="chat-panel-head"><strong>Game chat</strong><span>${state.players.length} players</span><button type="button" class="secondary" id="chat-close" aria-label="Close chat">×</button></div>
 <div class="chat-messages" id="chat-messages" role="log" aria-live="polite">${messages.length?messages.map(m=>`<div class="chat-message"><div class="chat-message-head"><strong class="chat-player-identity">${avatar(m.name)}<span>${esc(m.name)}</span></strong><time>${new Date(m.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</time>${state.host?`<button type="button" class="chat-delete" data-chat-delete="${esc(m.id)}" title="Delete message">×</button>`:''}</div>${m.type==='image'||m.type==='gif'?`<img class="chat-media" src="${esc(m.value)}" alt="${m.type==='gif'?'Shared GIF':'Shared photo'}" loading="lazy">`:`<div class="chat-bubble">${esc(m.value)}</div>`}</div>`).join(''):'<p class="muted">No messages yet. Say hello!</p>'}</div>
 <div class="chat-reactions">${['😂','🔥','😱','👏','❤️','🙌'].map(e=>`<button type="button" data-chat-reaction="${e}" ${canSend?'':'disabled'}>${e}</button>`).join('')}</div>
 <div class="chat-compose"><input id="chat-text" maxlength="500" placeholder="${canSend?'Message your friends…':'Chat is disabled'}" ${canSend?'':'disabled'}><button type="button" id="chat-send" ${canSend?'':'disabled'}>Send</button></div>
 <div class="chat-attachments"><label class="chat-upload-label">＋ Photo<input type="file" id="chat-photo" accept="image/*" hidden ${canSend?'':'disabled'}></label><input id="chat-gif-url" placeholder="Paste Tenor or Giphy GIF URL" aria-label="GIF URL" ${canSend?'':'disabled'}><button type="button" id="chat-gif-send" class="secondary" ${canSend?'':'disabled'}>GIF</button></div>
 ${state.host?`<div class="chat-moderation"><button class="secondary" id="chat-toggle">${canSend?'Disable chat':'Enable chat'}</button><select id="chat-mute-player" aria-label="Choose player to mute"><option value="">Mute / unmute player…</option>${state.players.filter(p=>!p.bot).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${state.chatMuted?.includes(p.id)?' (muted)':''}</option>`).join('')}</select></div>`:''}
 </section>`:''}
 </div>`;
}
function bindGameChat(){
 document.getElementById('chat-peek')?.addEventListener('click',()=>{chatOpen=!chatOpen;if(chatOpen)chatLastSeen=Date.now();render();});
 document.getElementById('chat-close')?.addEventListener('click',()=>{chatOpen=false;render();});
 document.getElementById('chat-send')?.addEventListener('click',()=>{const input=document.getElementById('chat-text');const value=input?.value.trim();if(value)send('chatSend',{type:'text',value},()=>{input.value='';});});
 document.getElementById('chat-text')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();document.getElementById('chat-send')?.click();}});
 document.querySelectorAll('[data-chat-reaction]').forEach(el=>el.addEventListener('click',()=>send('chatSend',{type:'reaction',value:el.dataset.chatReaction})));
 document.getElementById('chat-photo')?.addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{const value=await resizeAvatar(file);send('chatSend',{type:'image',value});}catch(err){notice(err.message)}e.target.value='';});
 document.getElementById('chat-gif-send')?.addEventListener('click',()=>{const input=document.getElementById('chat-gif-url');const value=input?.value.trim();if(value)send('chatSend',{type:'gif',value},()=>{input.value='';});});
 document.querySelectorAll('[data-chat-delete]').forEach(el=>el.addEventListener('click',()=>send('chatModerate',{action:'delete',messageId:el.dataset.chatDelete})));
 document.getElementById('chat-toggle')?.addEventListener('click',()=>send('chatModerate',{action:'toggle'}));
 document.getElementById('chat-mute-player')?.addEventListener('change',e=>{if(e.target.value)send('chatModerate',{action:'mute',playerId:e.target.value});});
 const box=document.getElementById('chat-messages');if(box)box.scrollTop=box.scrollHeight;
}
function render(){if(!state)return renderWelcome();const oldGuess=document.getElementById('guess');const guessFocused=oldGuess&&document.activeElement===oldGuess;const cursor=guessFocused?oldGuess.selectionStart:null;root.innerHTML='<div id="network-banner" class="network-banner"></div>'+renderGameHeader()+testPanel()+({lobby,guessing,betting,'open-bets':betting,'final-betting':betting,'locked-bets':betting,results,finished}[state.phase]?.()||'')+(state.phase==='lobby'?'':leaderboard())+hostPlayerControls()+recoveryPanel()+stickyBetBar()+gameChat()+reactionStage();bindGameChat();updateBetTimer();updateHostProgress();updatePauseControls();updateStickyBetBar();
 document.getElementById('presentation-toggle')?.addEventListener('click',()=>{presentationMode=!presentationMode;try{localStorage.setItem('wb_presenter',presentationMode?'on':'off')}catch{}document.body.classList.toggle('presentation-mode',presentationMode);render();});
 document.body.classList.toggle('presentation-mode',presentationMode&&!!state.host);
 document.getElementById('sticky-place')?.addEventListener('click',()=>{const original=document.getElementById('place');if(original&&!original.disabled)original.click();});
 document.getElementById('test-seat')?.addEventListener('change',e=>{testSeatId=e.target.value;testSlot=0;testOption=null;render();});
 document.querySelectorAll('[data-preview-slot]').forEach(el=>el.addEventListener('click',()=>{testSlot=Number(el.dataset.previewSlot);testOption=null;render();}));
 document.querySelectorAll('[data-preview-option]').forEach(el=>{const choose=()=>{testOption=el.dataset.previewOption;document.querySelectorAll('[data-preview-option]').forEach(x=>x.classList.toggle('lane-selected',x.dataset.previewOption===testOption));const target=document.getElementById('test-preview-target');if(target)target.textContent=optionLabel(state.guesses.find(o=>o.id===testOption));const save=document.getElementById('test-preview-bet');if(save)save.disabled=false;};el.addEventListener('click',choose);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose()}});});
 document.getElementById('test-preview-submit')?.addEventListener('click',()=>{const input=document.getElementById('test-preview-guess');if(!input?.value.trim())return notice('Enter a guess');send('testAction',{action:'guess',playerId:testSeatId,value:Number(input.value)},()=>notice('Guess saved'))});
 const testExtra=document.getElementById('test-preview-extra');
 const adjustTestExtra=n=>{if(!testExtra)return;const max=Number(testExtra.max)||0;testExtra.value=String(Math.max(0,Math.min(max,Math.floor(n)||0)));const total=document.getElementById('test-preview-total');if(total)total.textContent=String(1+Number(testExtra.value));};
 document.getElementById('test-extra-minus')?.addEventListener('click',()=>adjustTestExtra(Number(testExtra?.value||0)-1));
 document.getElementById('test-extra-plus')?.addEventListener('click',()=>adjustTestExtra(Number(testExtra?.value||0)+1));
 testExtra?.addEventListener('input',()=>{const total=document.getElementById('test-preview-total');if(total)total.textContent=Number.isInteger(Number(testExtra.value))&&Number(testExtra.value)>=0?String(1+Number(testExtra.value)):'—';});
 testExtra?.addEventListener('change',()=>adjustTestExtra(Number(testExtra.value)));
 document.getElementById('test-preview-bet')?.addEventListener('click',()=>{const p=state.testPlayers?.find(x=>x.id===testSeatId);const optionId=testOption??p?.bets.find(b=>b.slot===testSlot)?.optionId;const extra=Number(document.getElementById('test-preview-extra')?.value||0);if(!optionId)return notice('Tap a guess first');if(!Number.isInteger(extra)||extra<0)return notice('Enter a valid extra-chip amount');send('testAction',{action:'bet',playerId:testSeatId,slot:testSlot,optionId,extra},()=>{notice('✓ Chip '+(testSlot+1)+' saved');testSlot=testSlot===0&&!p?.bets.some(b=>b.slot===1)?1:testSlot;testOption=null;})});
 document.getElementById('copy-results')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(finalShareText());notice('Scoreboard copied!')}catch{notice('Copy unavailable on this browser. Take a screenshot instead.')}});
 document.getElementById('share-recap')?.addEventListener('click',shareRecapImage);
 document.getElementById('share-results')?.addEventListener('click',async()=>{try{if(navigator.share)await navigator.share({title:'Wits & Bets results',text:finalShareText()});else if(navigator.clipboard){await navigator.clipboard.writeText(finalShareText());notice('Scoreboard copied!')}else notice('Take a screenshot to share the scoreboard.')}catch(e){if(e.name!=='AbortError')notice('Sharing unavailable — try Copy scoreboard.')}});
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
 document.querySelectorAll('[data-remove-player]').forEach(el=>el.addEventListener('click',()=>{
  const p=state?.players.find(x=>x.id===el.dataset.removePlayer);
  if(!p||!confirm('Remove '+p.name+' from this game? Their score and current bets will be deleted. They can join again as a new player.'))return;
  send('removePlayer',{playerId:p.id},()=>notice(p.name+' removed. They may join again with a new photo.'));
 }));
 document.getElementById('advance')?.addEventListener('click',()=>send('advance',{}));
 document.getElementById('submitGuess')?.addEventListener('click',()=>{const input=document.getElementById('guess');if(!input.value.trim())return notice('Enter a number');send('guess',{value:Number(input.value)},()=>{guessDraft=null;const e=document.getElementById('guess-saved');if(e)e.textContent='✓ Saved answer: '+fmt(Number(input.value));playCue('guess');notice('✓ Guess saved!')})});
 document.querySelectorAll('[data-layout]').forEach(el=>el.addEventListener('click',()=>setBoardLayout(el.dataset.layout)));
 wireBoardChoices();
 document.querySelectorAll('[data-slot]').forEach(el=>el.onclick=()=>{if(betDraftDirty&&!confirm('Your changes to this chip are not saved. Switch chips and discard those changes?'))return;betDraftDirty=false;activeSlot=Number(el.dataset.slot);const saved=state.ownBets?.find(b=>b.slot===activeSlot);selected=saved?.optionId??null;betAmount=saved?.extra??0;render()});
 const amountInput=document.getElementById('amount');
 const currentExtraMax=()=>Math.max(0,myChips()+(state.ownBets?.find(b=>b.slot===activeSlot)?.extra||0));
 const setExtra=(value)=>{if(!amountInput)return;betAmount=Math.max(0,Math.min(currentExtraMax(),Math.floor(Number(value)||0)));amountInput.value=String(betAmount);const total=document.getElementById('bet-total-stake');if(total)total.textContent=String(1+betAmount);markBetDirty();};
 amountInput?.addEventListener('input',e=>{betAmount=Number(e.target.value);const total=document.getElementById('bet-total-stake');if(total)total.textContent=Number.isFinite(betAmount)?String(1+betAmount):'—';markBetDirty()});
 amountInput?.addEventListener('change',e=>setExtra(e.target.value));
 document.getElementById('extra-minus')?.addEventListener('click',()=>setExtra((Number(amountInput.value)||0)-1));
 document.getElementById('extra-plus')?.addEventListener('click',()=>setExtra((Number(amountInput.value)||0)+1));
 document.getElementById('extra-clear')?.addEventListener('click',()=>setExtra(0));
 document.getElementById('set-guessing-timer')?.addEventListener('click',()=>{
  const seconds=Number(document.getElementById('guessing-seconds').value);
  send('setGuessingTimer',{seconds},()=>notice('Guessing timer updated'));
 });
 document.getElementById('set-timer')?.addEventListener('click',()=>{
  const seconds=Number(document.getElementById('timer-seconds').value);
  send('setBettingTimer',{seconds},()=>notice('Betting timer updated'));
 });
 document.getElementById('place')?.addEventListener('click',()=>{
  const amountField=document.getElementById('amount');
  const raw=amountField?.value??'0';
  const amount=Number(raw);
  if(raw.trim()===''||!Number.isInteger(amount)||amount<0||amount>currentExtraMax())return notice('Choose a whole number of extra chips between 0 and '+currentExtraMax());
  if(selected===null)return notice('Tap a number on the board first.');
  const placedSlot=activeSlot;
  if(betSubmitting)return;
  betSubmitting=true;updateStickyBetBar();
  send('bet',{slot:placedSlot,optionId:selected,extra:amount},()=>{
   resetBetDirty();playCue('bet');
   notice('✓ Chip '+(placedSlot+1)+' saved on '+optionLabel(state.guesses.find(o=>o.id===selected))+'!');
   const next=placedSlot===0&&!state.ownBets?.some(b=>b.slot===1)?1:placedSlot;
   activeSlot=next;
   selected=state.ownBets?.find(b=>b.slot===next)?.optionId??null;
   betAmount=state.ownBets?.find(b=>b.slot===next)?.extra??0;
   render();
  });
  setTimeout(()=>{if(betSubmitting){betSubmitting=false;updateStickyBetBar();}},11000);
 });
 document.getElementById('copy')?.addEventListener('click',async()=>{const url=`${location.origin}/?room=${state.code}&join=1`;try{await navigator.clipboard.writeText(url);notice('Invite link copied!')}catch{notice(url)}});
 document.getElementById('newGame')?.addEventListener('click',()=>{try{sessionStorage.removeItem('wb_auth');localStorage.removeItem('wb_auth_last');if(state?.code)localStorage.removeItem('wb_auth_'+state.code)}catch{}state=null;auth=null;history.replaceState({},'','/');renderWelcome()});
}
renderWelcome();
timerTick=setInterval(updateBetTimer,250);
if(!socket){document.getElementById('connection').textContent='Connection unavailable';notice('Unable to load live connection. Refresh this page.');}
