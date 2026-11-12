import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { readFileSync } from 'node:fs';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
app.disable('x-powered-by');
app.use(express.static('public'));
const rooms = new Map();
const PLAYER_COLORS=['#ff7878','#68c8ff','#ffcf65','#a8e27a','#d5a0ff','#ff9bce','#6be2c6','#ffa66b','#a2b8ff','#e6e778','#f48e9a','#85d5df'];
const PRESET_AVATARS=new Set(["star-batter","fast-bowler","spin-wizard","wicket-keeper","captain","all-rounder","cricket-legend","six-hitter","cricket-queen","trophy-champion","helmet-hero","stadium-star","lords","mcg","eden-gardens","wankhede","ashes","world-cup","cricket-ball","cricket-bat","stumps-bails","india-fan","team-jersey","cricket-fan","commentator","umpire","dhonis-six","yuvis-six-sixes","dada-at-lords","kapils-1983","sachins-farewell","sachin-carried","jontys-dive","kohlis-chase","2003-uppercut","gabba-victory","stokes-at-headingley","malingas-yorkers"]);
const validAvatar=x=>typeof x==='string' && /^preset:[a-z0-9-]+$/.test(x) && PRESET_AVATARS.has(x.slice(7));
const STARTING_CHIPS = 0; // Earned chips; two permanent betting tokens are separate.
const QUESTION_BANK = JSON.parse(readFileSync(new URL('./data/questions.json',import.meta.url),'utf8'));
const CATEGORIES = Object.keys(QUESTION_BANK);
function questionTopic(q){
 if(q.topic)return q.topic;
 if(/in which year|what year|which year/i.test(q.q))return 'year';
 if(/centur|runs|wickets|score|matches|average/i.test(q.q))return 'career-records';
 if(/world cup|final|tournament/i.test(q.q))return 'tournament';
 return 'other';
}
function questionImage(q,category){
 if(!q)return null;
 if(category!=='cricket')return null;
 const topic=questionTopic(q);
 const text=q.q.toLowerCase();
 const file=text.includes('lord')||text.includes('1983 world cup')?'The_pitch_at_Lord%27s_Cricket_Ground.jpg':
 text.includes('edgbaston')||text.includes('ashes')?'Edgbaston.jpg':
 topic==='stadiums-and-history'?'Morning_Cricket_Ground.jpg':
 topic==='unusual-records'||topic==='captains-and-legends'?'Cricketball.jpg':
 'Cricket_ground_%281%29.jpg';
 return {url:'https://commons.wikimedia.org/wiki/Special:FilePath/'+file,alt:'Cricket photography',credit:'Wikimedia Commons'};
}
function drawQuestion(room){
 const pool=QUESTION_BANK[room.category].filter(q=>!room.usedQuestionIds.has(q.id));
 if(!pool.length)return null;
 const history=room.questionTopics||[];
 const last=history[history.length-1];
 // Avoid repeating the previous theme; prefer themes used least often in this game.
 const candidates=pool.filter(q=>questionTopic(q)!==last);
 const choices=candidates.length?candidates:pool;
 const counts=new Map(history.map(t=>[t,history.filter(x=>x===t).length]));
 const min=Math.min(...choices.map(q=>counts.get(questionTopic(q))||0));
 const diverse=choices.filter(q=>(counts.get(questionTopic(q))||0)===min);
 const chosen=diverse[crypto.randomInt(diverse.length)];
 room.usedQuestionIds.add(chosen.id);
 room.questionTopics=history.concat(questionTopic(chosen));
 return chosen;
}
const code = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const token = () => crypto.randomBytes(24).toString('hex');
const safeName = x => String(x ?? '').trim().replace(/[<>]/g,'').slice(0,24);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const reply = (ack, data) => { if (typeof ack === 'function') ack(data); };
const err = (ack, message) => reply(ack,{ok:false,error:message});
function getRoom(id) { return rooms.get(String(id ?? '').toUpperCase()); }
function playerView(p) { return {id:p.id,name:p.name,chips:p.chips,connected:p.sockets.size,submitted:p.guess!==null,color:p.color,avatar:p.avatar||null}; }
function state(room, viewerId, host=false) {
  const isRevealed = ['betting','open-bets','final-betting','locked-bets','results'].includes(room.phase);
  return {
    code:room.code, phase:room.phase, round:room.round, maxRounds:room.maxRounds,
    category:room.category, categories:CATEGORIES, questionCount:QUESTION_BANK[room.category].length,
    testMode:!!room.testMode,testPlayers:host&&room.testMode?[...room.players.values()].filter(p=>p.bot).map(p=>({id:p.id,name:p.name,guess:p.guess,bets:p.bets,chips:p.chips})):[],paused:!!room.paused,pausedRemaining:room.pausedRemaining||null,roundHistory:room.roundHistory||[],
    players:[...room.players.values()].map(playerView).sort((a,b)=>b.chips-a.chips),
    chat:(room.chat||[]).slice(-60),reactions:(room.reactions||[]).filter(x=>x.at>Date.now()-4500),confidence:['betting','locked-bets','results'].includes(room.phase)?room.confidence:null,chatEnabled:room.chatEnabled!==false,chatMuted:host?[...(room.chatMuted||[])]:[],
    question:room.phase==='lobby'?null:room.current?.q,
    questionImage:room.phase==='lobby'?null:questionImage(room.current,room.category),
    guesses:isRevealed?room.options:[],
    results:room.phase==='results'?room.results:null,awards:room.phase==='finished'?computeAwards(room):[],
    publicBets:['betting','locked-bets','results'].includes(room.phase)?[...room.players.values()].flatMap(p=>p.bets.map(b=>({name:p.name,slot:b.slot,optionId:b.optionId,extra:b.extra}))):[],
    ownGuess:viewerId?room.players.get(viewerId)?.guess:null,
    ownBets:viewerId?room.players.get(viewerId)?.bets:[],
    bettingSeconds:room.bettingSeconds,bettingDeadline:room.bettingDeadline||null,
    guessingSeconds:room.guessingSeconds,guessingDeadline:room.guessingDeadline||null,
    host, isPlayer:!!viewerId,
    recoveryPlayers:host?[...room.players.values()].map(p=>({name:p.name,playerToken:p.secret})):[],
    canAdvance:host && room.phase!=='finished'
  };
}
function broadcast(room) {
  for(const socket of io.sockets.sockets.values()) {
    if(socket.data.roomCode===room.code) socket.emit('state',state(room,socket.data.playerId,socket.data.isHost));
  }
}
function identify(socket,room,{host=false,player=null}) {
  const oldRoom = getRoom(socket.data.roomCode);
  if(oldRoom && socket.data.playerId) oldRoom.players.get(socket.data.playerId)?.sockets.delete(socket.id);
  socket.data.roomCode=room.code; socket.data.isHost=host; socket.data.playerId=player?.id??null;
  socket.join(room.code);
  if(player) player.sockets.add(socket.id);
}
function hostRoom(socket) {const r=getRoom(socket.data.roomCode);return r && socket.data.isHost && r.hostToken===socket.data.hostToken?r:null;}
function emitError(socket, message){socket.emit('notice',{error:message});}
function stopGuessingClock(room){if(room.guessingTimer)clearTimeout(room.guessingTimer);room.guessingTimer=null;room.guessingDeadline=null;}
function finishGuessing(room){
 if(room.paused)return;
 if(room.phase!=='guessing')return;
 stopGuessingClock(room);
 // If nobody submitted, keep the question open for the host to resolve.
 if(![...room.players.values()].some(p=>p.guess!==null)){broadcast(room);return;}
 revealGuesses(room);broadcast(room);
}
function startGuessingClock(room){
 stopGuessingClock(room);room.paused=false;room.pausedRemaining=null;
 room.guessingDeadline=Date.now()+room.guessingSeconds*1000;
 room.guessingTimer=setTimeout(()=>finishGuessing(room),room.guessingSeconds*1000);
}
function stopBettingClock(room){if(room.bettingTimer)clearTimeout(room.bettingTimer);room.bettingTimer=null;room.bettingDeadline=null;}
function closeBetting(room){if(room.paused)return;if(room.phase!=='betting')return;stopBettingClock(room);room.phase='locked-bets';broadcast(room);}
function startBettingClock(room){
 stopBettingClock(room);room.paused=false;room.pausedRemaining=null;
 room.bettingDeadline=Date.now()+room.bettingSeconds*1000;
 room.bettingTimer=setTimeout(()=>closeBetting(room),room.bettingSeconds*1000);
}
function reopenGuessing(room){
 // Changing guesses invalidates the betting board. Refund all extra stakes before rebuilding.
 stopBettingClock(room);stopGuessingClock(room);
 for(const p of room.players.values()){
  p.chips+=p.bets.reduce((total,b)=>total+b.extra,0);
  p.bets=[];
 }
 room.options=[];room.phase='guessing';room.results=null;
 startGuessingClock(room);broadcast(room);
}
function reopenBetting(room){
 stopBettingClock(room);
 const guesses=[...room.players.values()].map(p=>p.guess).filter(v=>v!==null);
  const spread=guesses.length>1?Math.max(...guesses)-Math.min(...guesses):0;
  const sorted=[...guesses].sort((a,b)=>a-b);
  const median=sorted.length?sorted[Math.floor(sorted.length/2)]:0;
  const relative=median===0?(spread?1:0):spread/Math.abs(median);
  room.confidence={count:guesses.length,spread,description:guesses.length<2?'Only one guess submitted':relative<.15?'Strong agreement':relative<.6?'Some disagreement':'Wildly divided'};
  room.phase='betting';startBettingClock(room);broadcast(room);
}
function startRound(room) {
  if(room.round>=room.maxRounds){room.phase='finished';return;}
  stopBettingClock(room);stopGuessingClock(room);
  room.round++;
  room.current=drawQuestion(room);
  if(!room.current){room.phase='finished';return;}
  room.phase='guessing';room.options=[];room.results=null;room.confidence=null;
  for(const p of room.players.values()){p.guess=null;p.bets=[];}
  startGuessingClock(room);
}
function revealGuesses(room){
  const values=[...new Set([...room.players.values()].map(p=>p.guess).filter(v=>v!==null))].sort((a,b)=>a-b);
  room.options=[{id:'all-high',value:null,odds:6,guessers:[]},...values.map((value,i)=>({id:String(i),value,guessers:[...room.players.values()].filter(p=>p.guess===value).map(p=>({name:p.name,color:p.color})),odds:values.length<=1?2:Math.max(2,Math.min(6,Math.round(2+Math.abs(i-(values.length-1)/2))))}))];
  room.phase='betting';startBettingClock(room);
}
function settle(room){
  const answer=room.current.a;
  const eligible=room.options.filter(o=>o.value!==null && o.value<=answer);
  const winning=eligible.length?eligible[eligible.length-1]:room.options.find(o=>o.id==='all-high');
  const before=[...room.players.values()].sort((a,b)=>b.chips-a.chips).map(p=>p.id);
  const payouts=[];
  for(const p of room.players.values()){
    let winnings=0;
    for(const bet of p.bets){
      if(winning && bet.optionId===winning.id){
        const option=room.options.find(o=>o.id===bet.optionId);
        // Permanent chip pays profit but never leaves the player.
        // Extra chips were deducted at placement; winning extra stake is returned.
        winnings+=(1+bet.extra)*option.odds+bet.extra;
      }
    }
    const guessBonus=winning && winning.id!=='all-high' && p.guess===winning.value ? room.round : 0;
    p.chips+=winnings+guessBonus;
    payouts.push({name:p.name,payout:winnings+guessBonus,betWinnings:winnings,guessBonus});
  }
  const revealedBets=[...room.players.values()].flatMap(p=>p.bets.map(b=>({name:p.name,slot:b.slot,optionId:b.optionId,extra:b.extra})));
  room.results={answer,explanation:room.current.fact,winningOptionId:winning?.id??null,winningValue:winning?.value??null,payouts,guessBonus:room.round,revealedBets,rankBefore:before,rankAfter:[...room.players.values()].sort((a,b)=>b.chips-a.chips).map(p=>p.id)};
  room.phase='results';
 room.roundHistory??=[];room.roundHistory.push({round:room.round,question:room.current.q,answer,guesses:[...room.players.values()].map(p=>({name:p.name,value:p.guess})),bets:revealedBets,winningOptionId:winning?.id,winningGuessers:room.options.find(o=>o.id===winning?.id)?.guessers?.map(g=>g.name)||[],payouts:payouts.map(x=>({...x,total:room.players.size?[...room.players.values()].find(p=>p.name===x.name)?.chips:0}))});
}
function computeAwards(room){
 const players=[...room.players.values()];
 const history=room.roundHistory||[];
 if(!players.length)return [];
 const winner=players.slice().sort((a,b)=>b.chips-a.chips)[0];
 const guessAccuracy=new Map(players.map(p=>[p.name,0]));
 const risk=new Map(players.map(p=>[p.name,0]));
 const comeback=new Map(players.map(p=>[p.name,0]));
 for(const h of history){
  const valid=(h.guesses||[]).filter(g=>typeof g.value==='number');
  if(valid.length){const best=Math.min(...valid.map(g=>Math.abs(g.value-h.answer)));for(const g of valid)if(Math.abs(g.value-h.answer)===best)guessAccuracy.set(g.name,(guessAccuracy.get(g.name)||0)+1);}
  for(const b of h.bets||[])risk.set(b.name,(risk.get(b.name)||0)+(b.extra||0));
  for(const p of h.payouts||[])comeback.set(p.name,Math.max(comeback.get(p.name)||0,p.payout||0));
 }
 const top=(map)=>[...map].sort((a,b)=>b[1]-a[1])[0];
 const awards=[{title:'Party Champion',name:winner.name,detail:'Highest final score'}];
 for(const [title,map,detail] of [['Closest Guesser',guessAccuracy,'Most rounds with the nearest guess'],['Risk Taker',risk,'Most extra chips wagered'],['Biggest Round',comeback,'Largest single-round payout']]){
  const result=top(map);if(result&&result[1]>0)awards.push({title,name:result[0],detail});
 }
 return awards;
}
io.on('connection',socket=>{
  socket.on('create',async (data,ack)=>{
    let id;do{id=code()}while(rooms.has(id));
    const hostToken=token();
    const maxRounds=7;
    const category=CATEGORIES.includes(data?.category)?data.category:'bollywood';
    const testMode=data?.testMode===true;
    const room={code:id,hostToken,hostSocket:socket.id,phase:'lobby',round:0,maxRounds,
      category,testMode,paused:false,pausedRemaining:null,roundHistory:[],usedQuestionIds:new Set(),questionTopics:[],players:new Map(),current:null,options:[],results:null,bettingSeconds:180,bettingDeadline:null,bettingTimer:null,guessingSeconds:120,guessingDeadline:null,guessingTimer:null,chat:[],chatMuted:new Set(),chatEnabled:true,reactions:[]};
    if(testMode){
      for(let i=0;i<4;i++){
        const name=['Alice','Bob','Charlie','Dana'][i];
        const p={id:token(),secret:token(),name,color:PLAYER_COLORS[i],avatar:null,chips:STARTING_CHIPS,guess:null,bets:[],sockets:new Set(),bot:true};
        room.players.set(p.id,p);
      }
      room.guessingSeconds=120;room.bettingSeconds=180;
    }
    rooms.set(id,room);socket.data.hostToken=hostToken;identify(socket,room,{host:true});
    const base=(process.env.PUBLIC_URL||data?.origin||'').replace(/\/$/,'');
    const url=base?`${base}/?room=${id}&join=1`:`/?room=${id}&join=1`;
    let qr='';try{qr=await QRCode.toDataURL(url,{margin:1,width:280});}catch{}
    reply(ack,{ok:true,code:id,hostToken,joinUrl:url,qr});broadcast(room);
  });
  socket.on('testAction',(data,ack)=>{
    const room=hostRoom(socket);if(!room||!room.testMode)return err(ack,'Only a test-room host can use these controls.');
    const bots=[...room.players.values()].filter(p=>p.bot);
    const pick=()=>bots.find(p=>p.id===data?.playerId)||bots[0];
    const action=data?.action;
    if(room.paused)return err(ack,'Resume the game before test actions.');
    if(action==='guess'||action==='autoGuess'){
      if(room.phase!=='guessing')return err(ack,'Guessing is not open.');
      const chosen=action==='guess'?[pick()]:bots.filter(p=>p.guess===null);
      const base=room.current?.a||100;
      for(const p of chosen){
        const value=action==='guess'?data?.value:Math.max(0,Math.round(base*(.55+crypto.randomInt(95)/100)));
        if(!integer(value)||value>1000000000)return err(ack,'Enter a valid whole number.');
        p.guess=value;
      }
    }else if(action==='bet'||action==='autoBet'){
      if(room.phase!=='betting')return err(ack,'Betting is not open.');
      const chosen=action==='bet'?[pick()]:bots;
      const opts=room.options;
      if(!opts.length)return err(ack,'No betting options.');
      for(const p of chosen){
        const optionId=action==='bet'?data?.optionId:opts[crypto.randomInt(opts.length)].id;
        if(!opts.some(o=>o.id===optionId))return err(ack,'Invalid betting lane.');
        const slot=action==='bet'?data?.slot:0;
        if(!Number.isInteger(slot)||slot<0||slot>1)return err(ack,'Invalid chip.');
        const extra=action==='bet'?data?.extra:0;
        if(!integer(extra)||extra>p.chips+(p.bets.find(b=>b.slot===slot)?.extra||0))return err(ack,'Not enough earned chips.');
        p.chips+=p.bets.find(b=>b.slot===slot)?.extra||0;
        p.chips-=extra;
        p.bets=p.bets.filter(b=>b.slot!==slot);
        p.bets.push({slot,optionId,extra});
        if(action==='autoBet')p.bets.push({slot:1,optionId:opts[crypto.randomInt(opts.length)].id,extra:0});
      }
    }else if(action==='advance'){
      if(room.phase==='lobby')startRound(room);
      else if(room.phase==='guessing'){if(!bots.some(p=>p.guess!==null))return err(ack,'Submit at least one guess first.');finishGuessing(room);}
      else if(room.phase==='betting')closeBetting(room);
      else if(room.phase==='locked-bets')settle(room);
      else if(room.phase==='results')startRound(room);
      else return err(ack,'Game finished.');
    }else if(action==='resetGuesses'){
      if(room.phase!=='guessing')return err(ack,'Only available while guessing.');
      for(const p of bots)p.guess=null;
    }else if(action==='resetBets'){
      if(room.phase!=='betting')return err(ack,'Only available while betting.');
      for(const p of bots){p.chips+=p.bets.reduce((n,b)=>n+b.extra,0);p.bets=[];}
    }else return err(ack,'Unknown test action.');
    reply(ack,{ok:true});broadcast(room);
  });
  socket.on('replaceQuestion',(data,ack)=>{
    const room=hostRoom(socket);if(!room)return err(ack,'Only the host can replace a question.');
    if(room.phase!=='guessing')return err(ack,'Questions can only be replaced during guessing, before betting begins.');
    const replacement=drawQuestion(room);
    if(!replacement)return err(ack,'No unused questions remain in this category.');
    stopGuessingClock(room);
    room.current=replacement;room.options=[];room.results=null;
    for(const p of room.players.values())p.guess=null;
    startGuessingClock(room);
    reply(ack,{ok:true});broadcast(room);
  });
  socket.on('resumeHost',(data,ack)=>{
    const room=getRoom(data?.code);
    if(!room||room.hostToken!==data?.hostToken)return err(ack,'Host credentials not recognized');
    socket.data.hostToken=room.hostToken;identify(socket,room,{host:true});room.hostSocket=socket.id;
    reply(ack,{ok:true});broadcast(room);
  });
  socket.on('join',(data,ack)=>{
    const room=getRoom(data?.code);
    if(!room)return err(ack,'Room not found. Ask the host for a new code.');
    if(room.phase==='finished')return err(ack,'This game has finished.');
    const name=safeName(data?.name);
    let player=[...room.players.values()].find(p=>p.secret===data?.playerToken);
    if(!player){
      if(!name)return err(ack,'Enter a name.');
      const existing=[...room.players.values()].find(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase());
      if(existing){
        // A stored private token is preferred. A name alone can recover a disconnected
        // seat, but must never silently displace someone who is actively playing.
        if(existing.sockets.size)return err(ack,'That name is already playing. Use your original browser or ask the host for help.');
        if(existing.bot)return err(ack,'That name is reserved by a test player.');
        player=existing;
      }else{
        if(room.players.size>=30)return err(ack,'Room is full (30 players).');
        player={id:token(),secret:token(),name,color:PLAYER_COLORS[room.players.size%PLAYER_COLORS.length],avatar:validAvatar(data?.avatar)?data.avatar:null,chips:STARTING_CHIPS,guess:null,bets:[],sockets:new Set()};
        room.players.set(player.id,player);
      }
    }
    // A rejoining player retains their score, guesses, bets and avatar.
    identify(socket,room,{player});reply(ack,{ok:true,playerToken:player.secret,name:player.name,rejoined:!!data?.playerToken||player!==null});broadcast(room);
  });
  socket.on('chatSend',(data,ack)=>{
    const room=getRoom(socket.data.roomCode);
    const p=room?.players.get(socket.data.playerId);
    const host=!!hostRoom(socket);
    if(!room||(!p&&!host))return err(ack,'Join the game before chatting.');
    if(room.chatEnabled===false)return err(ack,'Chat is disabled by the host.');
    if(p&&room.chatMuted?.has(p.id))return err(ack,'The host has muted your chat.');
    const type=data?.type;
    let value='';
    if(type==='text')value=String(data?.value||'').trim().slice(0,500);
    else if(type==='reaction'&&['😂','🔥','😱','👏','❤️','🙌'].includes(data?.value))value=data.value;
    else if(type==='image'&&validAvatar(data?.value))value=data.value;
    else if(type==='gif'&&typeof data?.value==='string'){
      try{const u=new URL(data.value);if(u.protocol==='https:'&&['media.tenor.com','media.giphy.com','i.giphy.com'].includes(u.hostname)&&u.href.length<1200)value=u.href;}catch{}
    }
    if(!value)return err(ack,'Invalid or empty chat message.');
    if(Date.now()-(socket.data.lastChatAt||0)<650)return err(ack,'Please wait before sending another message.');
    socket.data.lastChatAt=Date.now();
    const message={id:token(),name:host?'Host':p.name,playerId:p?.id||null,type,value,at:Date.now()};
    if(type==='reaction'){room.reactions??=[];room.reactions.push({id:message.id,name:message.name,value,at:message.at});room.reactions=room.reactions.filter(x=>x.at>Date.now()-4500).slice(-12);}
    room.chat??=[];room.chat.push(message);if(room.chat.length>100)room.chat.shift();
    reply(ack,{ok:true});broadcast(room);
  });
  socket.on('chatModerate',(data,ack)=>{
    const room=hostRoom(socket);if(!room)return err(ack,'Only the host can moderate chat.');
    if(data?.action==='delete'){
      room.chat=(room.chat||[]).filter(m=>m.id!==data.messageId);
    }else if(data?.action==='toggle'){
      room.chatEnabled=room.chatEnabled===false;
    }else if(data?.action==='mute'){
      if(!room.players.has(data.playerId))return err(ack,'Player not found.');
      room.chatMuted??=new Set();
      if(room.chatMuted.has(data.playerId))room.chatMuted.delete(data.playerId);
      else room.chatMuted.add(data.playerId);
    }else return err(ack,'Invalid moderation action.');
    reply(ack,{ok:true});broadcast(room);
  });
  socket.on('removePlayer',(data,ack)=>{
    const room=hostRoom(socket);
    if(!room)return err(ack,'Only the host can remove players.');
    const player=room.players.get(data?.playerId);
    if(!player)return err(ack,'Player not found.');
    if(player.bot)return err(ack,'Test players cannot be removed here.');
    // Invalidate the old player token and any open sessions immediately.
    for(const id of player.sockets){
      const client=io.sockets.sockets.get(id);
      if(client){client.data.playerId=null;client.data.roomCode=null;client.data.isHost=false;client.leave(room.code);client.emit('removed',{message:'The host removed you from the room. You can join again as a new player.'});}
    }
    player.sockets.clear();
    room.players.delete(player.id);
    room.chatMuted?.delete(player.id);
    // Preserve an already-revealed betting board's option IDs and existing bets,
    // while removing the former player's displayed attribution.
    for(const option of room.options||[])option.guessers=option.guessers?.filter(g=>g.name!==player.name)||[];
    reply(ack,{ok:true});broadcast(room);
  });
  socket.on('guess',(data,ack)=>{
    const room=getRoom(socket.data.roomCode);const p=room?.players.get(socket.data.playerId);
    if(!p||room.phase!=='guessing'||room.paused||(room.guessingDeadline&&Date.now()>=room.guessingDeadline)){if(room?.phase==='guessing'&&room.guessingDeadline&&Date.now()>=room.guessingDeadline)finishGuessing(room);return err(ack,'Guessing is closed.');}
    if(typeof data?.value!=='number'||!integer(data.value)||data.value>1000000000)return err(ack,'Enter a whole number from 0 to 1,000,000,000.');
    p.guess=data.value;reply(ack,{ok:true});broadcast(room);
  });
  socket.on('reopenGuessing',(data,ack)=>{
    const room=hostRoom(socket);if(!room)return err(ack,'Only the host can reopen guessing.');
    if(!['guessing','betting','locked-bets'].includes(room.phase))return err(ack,'Cannot reopen guessing after the answer has been revealed.');
    reopenGuessing(room);reply(ack,{ok:true});
  });
  socket.on('reopenBetting',(data,ack)=>{
    const room=hostRoom(socket);if(!room)return err(ack,'Only the host can reopen betting.');
    if(room.phase!=='locked-bets')return err(ack,'Betting can only be reopened before the answer is revealed.');
    reopenBetting(room);reply(ack,{ok:true});
  });
  socket.on('togglePause',(data,ack)=>{
    const room=hostRoom(socket);if(!room)return err(ack,'Only the host can pause the game.');
    if(!['guessing','betting'].includes(room.phase))return err(ack,'Pause is available while guessing or betting.');
    if(!room.paused){const deadline=room.phase==='guessing'?room.guessingDeadline:room.bettingDeadline;room.pausedRemaining=Math.max(1000,(deadline||Date.now())-Date.now());room.paused=true;if(room.phase==='guessing')stopGuessingClock(room);else stopBettingClock(room);}
    else {const remaining=room.pausedRemaining||1000;room.paused=false;room.pausedRemaining=null;if(room.phase==='guessing'){room.guessingDeadline=Date.now()+remaining;room.guessingTimer=setTimeout(()=>finishGuessing(room),remaining);}else{room.bettingDeadline=Date.now()+remaining;room.bettingTimer=setTimeout(()=>closeBetting(room),remaining);}}
    reply(ack,{ok:true});broadcast(room);
  });
  socket.on('setGuessingTimer',(data,ack)=>{
    const room=hostRoom(socket);if(!room)return err(ack,'Only the host can set the timer.');
    const seconds=data?.seconds;
    if(!Number.isInteger(seconds)||seconds<15||seconds>1800)return err(ack,'Choose 15 seconds to 30 minutes.');
    room.guessingSeconds=seconds;
    if(room.phase==='guessing'&&!room.paused)startGuessingClock(room);
    reply(ack,{ok:true});broadcast(room);
  });
  socket.on('setBettingTimer',(data,ack)=>{
    const room=hostRoom(socket);if(!room)return err(ack,'Only the host can set the timer.');
    const seconds=data?.seconds;
    if(!Number.isInteger(seconds)||seconds<15||seconds>1800)return err(ack,'Choose 15 seconds to 30 minutes.');
    room.bettingSeconds=seconds;
    if(room.phase==='betting'&&!room.paused)startBettingClock(room);
    reply(ack,{ok:true});broadcast(room);
  });
  socket.on('bet',(data,ack)=>{
    const room=getRoom(socket.data.roomCode);const p=room?.players.get(socket.data.playerId);
    if(!p||room.phase!=='betting'||room.paused||!room.bettingDeadline||Date.now()>=room.bettingDeadline){if(room?.phase==='betting'&&Date.now()>=room.bettingDeadline)closeBetting(room);return err(ack,'Betting is locked.');}
    const slot=data?.slot,extra=data?.extra;
    if(!Number.isInteger(slot)||slot<0||slot>1)return err(ack,'Choose betting chip 1 or 2.');
    if(!room.options.some(o=>o.id===data?.optionId))return err(ack,'Choose a valid answer.');
    if(!integer(extra))return err(ack,'Extra chips must be a nonnegative whole number.');
    const previous=p.bets.find(b=>b.slot===slot);
    const available=p.chips+(previous?.extra||0);
    if(extra>available)return err(ack,'Not enough earned chips.');
    p.chips=available-extra;
    const updated={slot,optionId:data.optionId,extra};
    p.bets=p.bets.filter(b=>b.slot!==slot);
    p.bets.push(updated);
    p.bets.sort((a,b)=>a.slot-b.slot);
    reply(ack,{ok:true});broadcast(room);
  });
  socket.on('advance',(data,ack)=>{
    const room=hostRoom(socket);if(!room)return err(ack,'Only the host can advance the game.');
    if(room.paused)return err(ack,'Resume the game before advancing.');
    if(room.phase==='lobby'){
      if(room.players.size<2)return err(ack,'At least two players are required.');
      startRound(room);
    }else if(room.phase==='guessing'){
      if(![...room.players.values()].some(p=>p.guess!==null))return err(ack,'Wait for at least one guess.');
      finishGuessing(room);
    }else if(room.phase==='betting')closeBetting(room);
    else if(room.phase==='locked-bets')settle(room);
    else if(room.phase==='results')startRound(room);
    else return err(ack,'The game has ended.');
    reply(ack,{ok:true});broadcast(room);
  });
  socket.on('disconnect',()=>{
    const room=getRoom(socket.data.roomCode);
    if(room&&socket.data.playerId){room.players.get(socket.data.playerId)?.sockets.delete(socket.id);broadcast(room);}
  });
});
app.get('/qr/:roomCode',async(req,res)=>{
  const room=getRoom(req.params.roomCode);
  if(!room)return res.status(404).send('Room not found');
  try{
    const origin=(process.env.PUBLIC_URL||`${req.protocol}://${req.get('host')}`).replace(new RegExp('/+$'),'');
    const url=`${origin}/?room=${encodeURIComponent(room.code)}&join=1`;
    const png=await QRCode.toBuffer(url,{type:'png',margin:2,width:360,errorCorrectionLevel:'M'});
    res.set('Content-Type','image/png');res.set('Cache-Control','no-store');res.send(png);
  }catch(e){console.error('QR generation failed',e);res.status(500).send('QR generation failed');}
});
app.get('/health',(_req,res)=>res.json({ok:true,rooms:rooms.size}));
const port=Number(process.env.PORT||3000);
server.listen(port,()=>console.log(`Wits & Bets Party listening on http://localhost:${port}`));
