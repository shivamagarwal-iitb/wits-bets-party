const root=document.getElementById('app');
const socket=io({transports:['polling','websocket'],reconnection:true});
const params=new URLSearchParams(location.search),roomParam=params.get('room')?.toUpperCase();
let state=null,hostMeta=null,pending=false,selectedAvatar=null;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const letters=['A','B','C','D'];
const stored=()=>{try{return JSON.parse(sessionStorage.getItem('wb_trivia_auth')||'null')}catch{return null}};
const save=a=>sessionStorage.setItem('wb_trivia_auth',JSON.stringify(a));
const send=(event,data={},callback)=>{if(!socket.connected)return alert('Connection lost. Please retry.');socket.timeout(12000).emit(event,data,(err,res)=>{if(err||!res?.ok)return alert(err?'Server did not respond. Please retry.':res?.error||'Request failed');callback?.(res)})};
socket.on('connect',()=>{document.getElementById('connection').textContent='● Live';const a=stored();if(a?.code&&(!roomParam||a.code===roomParam))send('triviaResume',a);else welcome();});
socket.on('disconnect',()=>document.getElementById('connection').textContent='○ Reconnecting…');
socket.on('triviaState',s=>{state=s;render();});
socket.on('triviaDecision',r=>{pending=false;if(r.ok){save({code:r.code,playerToken:r.playerToken});history.replaceState({},'','?room='+r.code);root.innerHTML='<div class="panel">✓ Approved! Loading game…</div>';}else{alert(r.error||'Request declined');welcome();}});
function welcome(){
 state=null;
 const join=!!roomParam;
 root.innerHTML='<div class="hero"><div class="pill">🎯 FOUR CHOICES · ONE WINNER</div><h1>Trivia Challenge</h1><p>Secret answers, dramatic reveals, and 10 points for every correct answer.</p></div><div class="'+(join?'':'split')+'">'+(join?'':`<section class="panel stack"><h2>🎤 Host Trivia</h2><label>Question category<select id="category"><option value="cricket">🏏 Cricket</option><option value="bollywood">🎬 Bollywood</option></select></label><label>Questions per game<select id="rounds"><option>20</option><option>10</option><option>7</option><option>15</option></select></label><button id="create">Create trivia room</button><small>Everyone answers secretly. Host controls the reveal.</small></section>`)+`<section class="panel stack"><h2>📱 Join Trivia</h2><label>Room code<input id="code" maxlength="6" value="${esc(roomParam||'')}" placeholder="ABC123"></label><label>Your name<input id="name" maxlength="24" placeholder="Player name"></label><button id="join">Join game</button><small>Late joiners require host approval.</small></section></div>`;
 document.getElementById('create')?.addEventListener('click',()=>send('triviaCreate',{category:document.getElementById('category').value,rounds:Number(document.getElementById('rounds').value),origin:location.origin},r=>{hostMeta=r;save({code:r.code,hostToken:r.hostToken});history.replaceState({},'','?room='+r.code);render();}));
 document.getElementById('join')?.addEventListener('click',()=>{const code=document.getElementById('code').value.trim().toUpperCase(),name=document.getElementById('name').value.trim();if(!code||!name)return alert('Enter room code and name');send('triviaJoin',{code,name},r=>{if(r.pending){pending=true;root.innerHTML='<div class="panel center"><h2>⏳ Waiting for host approval</h2><p>Keep this tab open.</p></div>';}else{save({code:r.code,playerToken:r.playerToken});history.replaceState({},'','?room='+r.code);}})});
}
function leaderboard(){return '<section class="panel"><h2>🏆 Leaderboard</h2>'+state.players.map((p,i)=>'<div class="score"><span>'+(i+1)+'. '+esc(p.name)+(state.phase==='answering'?(p.submitted?' ✓':' ⏳'):'')+'</span><strong>'+p.score+' pts</strong></div>').join('')+'</section>';}
function hostControls(){
 if(!state.host)return '';
 const url=location.origin+'/trivia.html?room='+state.code;
 const btn=state.phase==='lobby'?'Start game →':state.phase==='answering'?'Close answers & reveal →':state.phase==='reveal'?(state.round===state.total?'Finish & show winner →':'Next question →'):'';
 return '<section class="panel stack"><div class="row"><h2>🎤 Host controls</h2><span class="pill">Room '+esc(state.code)+'</span></div>'+(state.phase==='lobby'?'<div class="center">'+(hostMeta?.qr?'<img class="qr" src="'+hostMeta.qr+'" alt="Join QR code">':'<p>Share the link below</p>')+'</div><div class="link">'+esc(url)+'</div><button class="secondary" id="copy-link">Copy player join link</button>':'')+(state.phase==='lobby'?'<label>Answer timer<select id="seconds"><option value="30">30 seconds</option><option value="45">45 seconds</option><option value="60">60 seconds</option><option value="90">90 seconds</option><option value="120">120 seconds</option></select></label>':'')+(btn?'<button id="advance">'+btn+'</button>':'')+(state.joinRequests.length?'<h3>Late join requests</h3>'+state.joinRequests.map(p=>'<div class="row"><span>'+esc(p.name)+'</span><div><button class="approve" data-id="'+esc(p.id)+'">Allow</button> <button class="secondary reject" data-id="'+esc(p.id)+'">Decline</button></div></div>').join(''):'')+'</section>';
}
function question(){
 const q=state.question;
 if(!q)return '';
 const reveal=['reveal','finished'].includes(state.phase);
 return '<section class="panel stack"><div class="row"><span class="pill">Question '+state.round+' / '+state.total+'</span><span class="pill">'+state.points+' points per correct answer</span></div><h2>'+esc(q.text)+'</h2>'+(state.phase==='answering'?'<div class="row"><span class="status">🔒 Answers are secret</span><span class="clock" id="clock"></span></div>':'')+q.options.map((o,i)=>'<button class="choice '+(reveal&&state.correct===i?'correct':reveal&&state.ownAnswer===i&&i!==state.correct?'wrong':state.ownAnswer===i?'selected':'')+'" data-choice="'+i+'" '+(state.phase!=='answering'||state.host?'disabled':'')+'><b>'+letters[i]+'</b><span>'+esc(o)+'</span>'+(reveal&&state.correct===i?' ✓ Correct':'')+'</button>').join('')+(state.phase==='answering'?(state.host?'<p class="muted">Only the host can see submitted choices before reveal.</p>':state.ownAnswer===null?'<p class="muted">Tap an option to submit. You can change it until answers close.</p>':'<p class="status">✓ Answer saved privately. You can still change it.</p>'):'')+(reveal?'<div class="panel"><h2>🎉 Answer revealed</h2><p>'+esc(state.explanation)+'</p><h3>Everyone’s answers</h3>'+state.answers.map(a=>'<div class="answer-row">'+(a.correct?'✅ ':'❌ ')+esc(a.name)+' — '+(a.choice===null?'No answer':letters[a.choice]+'. '+esc(q.options[a.choice]))+(a.correct?' (+10)':'')+'</div>').join('')+'</div>':'')+'</section>';
}
function render(){
 if(!state)return welcome();
 if(state.phase==='lobby')root.innerHTML='<div class="hero"><h1>🎯 Trivia Challenge</h1><p>Waiting for players · '+state.category+' · '+state.total+' questions</p></div>'+hostControls()+leaderboard()+(state.host?'':'<div class="panel center"><h2>Ready to play?</h2><p>Waiting for host to start the game.</p></div>');
 else root.innerHTML='<div class="hero"><span class="pill">'+esc(state.category.toUpperCase())+' TRIVIA</span><h1>'+(state.phase==='finished'?'🏆 Game Over!':'Trivia Challenge')+'</h1>'+(state.phase==='finished'?'<p class="big">'+esc(state.players[0]?.name||'Winner')+' wins!</p>':'')+'</div>'+hostControls()+(state.phase==='finished'?'':question())+leaderboard()+(state.phase==='finished'?'<div class="panel center"><a href="/trivia.html">Host another Trivia game</a></div>':'');
 document.getElementById('advance')?.addEventListener('click',()=>send('triviaAdvance'));
 document.getElementById('copy-link')?.addEventListener('click',()=>{const url=location.origin+'/trivia.html?room='+state.code;navigator.clipboard?.writeText(url).then(()=>alert('Link copied!'),()=>prompt('Copy link',url));});
 document.getElementById('seconds')?.addEventListener('change',e=>send('triviaSetTimer',{seconds:Number(e.target.value)}));
 document.querySelectorAll('[data-choice]').forEach(b=>b.addEventListener('click',()=>send('triviaAnswer',{choice:Number(b.dataset.choice)})));
 document.querySelectorAll('.approve,.reject').forEach(b=>b.addEventListener('click',()=>send('triviaReview',{id:b.dataset.id,approve:b.classList.contains('approve')})));
 updateClock();
}
function updateClock(){const e=document.getElementById('clock');if(e)e.textContent=state?.deadline?Math.max(0,Math.ceil((state.deadline-Date.now())/1000))+'s':'—';}
setInterval(updateClock,500);
welcome();
