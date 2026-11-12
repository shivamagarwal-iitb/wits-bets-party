import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import { Server } from 'socket.io';
import QRCode from 'qrcode';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
app.disable('x-powered-by');
app.use(express.static('public'));
const rooms = new Map();
const PLAYER_COLORS=['#ff7878','#68c8ff','#ffcf65','#a8e27a','#d5a0ff','#ff9bce','#6be2c6','#ffa66b','#a2b8ff','#e6e778','#f48e9a','#85d5df'];
const STARTING_CHIPS = 0; // Earned chips; two permanent betting tokens are separate.
const QUESTIONS = [
  {
    "q": "How many awards had the 2000 film Kaho Naa... Pyaar Hai reportedly won when its makers sought a Guinness World Records entry?",
    "a": 92,
    "fact": "A July 2001 report said Kaho Naa... Pyaar Hai had collected 92 awards across the cast, music and crew. The Hrithik Roshan debut became famous for its extraordinary award haul. Source: Rediff, July 2, 2001."
  },
  {
    "q": "How many Bollywood stars made cameo appearances in the song Deewangi Deewangi from Om Shanti Om (2007)?",
    "a": 31,
    "fact": "The star-studded song featured 31 celebrity cameos. Director Farah Khan later recalled that Amitabh Bachchan could not participate because of Abhishek Bachchan and Aishwarya Rai's wedding that week. Source: The Indian Express, May 2024."
  },
  {
    "q": "How many metric tonnes of tomatoes were flown in from Portugal for the La Tomatina sequence in Zindagi Na Milegi Dobara (2011)?",
    "a": 16,
    "fact": "The production imported about 16 tonnes of tomatoes from Portugal because the local tomatoes were not ripe enough. Producer Ritesh Sidhwani described the scene as an enormous logistical challenge. Source: Bollywood Hungama, March 2011."
  },
  {
    "q": "Approximately how many mirrors were used to create the Aaina Mahal set for Deewani Mastani in Bajirao Mastani (2015)?",
    "a": 20000,
    "fact": "Contemporary reporting described over 20,000 mirrors brought from Jaipur for the grand Aaina Mahal set. The question uses the rounded reported figure. Source: The Indian Express, September 2015."
  },
  {
    "q": "Across how many locations in Spain was Zindagi Na Milegi Dobara (2011) reportedly filmed?",
    "a": 107,
    "fact": "A behind-the-scenes retrospective reported that the film was shot at 107 locations across Spain, including the celebrated Tomatina sequence. Source: The Indian Express, July 2023."
  },
  {
    "q": "According to Bollywood Hungama's box-office records, how many days did 3 Idiots (2009) take to reach ₹200 crore in Indian net box-office collections?",
    "a": 70,
    "fact": "3 Idiots was the first Hindi film to join the ₹200-crore domestic net club. Bollywood Hungama's milestone table lists 70 days to cross it. Box-office tracking methods can vary between publications. Source: Bollywood Hungama, ₹200 Crore Club feature."
  },
  {
    "q": "According to Bollywood Hungama, how many days did Sultan (2016) take to cross ₹200 crore in Indian net box-office collections?",
    "a": 6,
    "fact": "Salman Khan's Sultan crossed ₹200 crore in six days, one of the quickest milestones at the time. Source: Bollywood Hungama, ₹200 Crore Club feature."
  }
];
const code = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const token = () => crypto.randomBytes(24).toString('hex');
const safeName = x => String(x ?? '').trim().replace(/[<>]/g,'').slice(0,24);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const reply = (ack, data) => { if (typeof ack === 'function') ack(data); };
const err = (ack, message) => reply(ack,{ok:false,error:message});
function getRoom(id) { return rooms.get(String(id ?? '').toUpperCase()); }
function playerView(p) { return {id:p.id,name:p.name,chips:p.chips,connected:p.sockets.size,submitted:p.guess!==null,color:p.color}; }
function state(room, viewerId, host=false) {
  const isRevealed = ['betting','open-bets','final-betting','locked-bets','results'].includes(room.phase);
  return {
    code:room.code, phase:room.phase, round:room.round, maxRounds:room.maxRounds,
    players:[...room.players.values()].map(playerView).sort((a,b)=>b.chips-a.chips),
    question:room.phase==='lobby'?null:room.current?.q,
    guesses:isRevealed?room.options:[],
    results:room.phase==='results'?room.results:null,
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
 if(room.phase!=='guessing')return;
 stopGuessingClock(room);
 // If nobody submitted, keep the question open for the host to resolve.
 if(![...room.players.values()].some(p=>p.guess!==null)){broadcast(room);return;}
 revealGuesses(room);broadcast(room);
}
function startGuessingClock(room){
 stopGuessingClock(room);
 room.guessingDeadline=Date.now()+room.guessingSeconds*1000;
 room.guessingTimer=setTimeout(()=>finishGuessing(room),room.guessingSeconds*1000);
}
function stopBettingClock(room){if(room.bettingTimer)clearTimeout(room.bettingTimer);room.bettingTimer=null;room.bettingDeadline=null;}
function closeBetting(room){if(room.phase!=='betting')return;stopBettingClock(room);room.phase='locked-bets';broadcast(room);}
function startBettingClock(room){
 stopBettingClock(room);
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
 room.phase='betting';startBettingClock(room);broadcast(room);
}
function startRound(room) {
  if(room.round>=room.maxRounds){room.phase='finished';return;}
  stopBettingClock(room);stopGuessingClock(room);
  room.round++;
  room.current=room.questions[room.round-1];
  room.phase='guessing';room.options=[];room.results=null;
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
  room.results={answer,explanation:room.current.fact,winningOptionId:winning?.id??null,winningValue:winning?.value??null,payouts,guessBonus:room.round,revealedBets};
  room.phase='results';
}
io.on('connection',socket=>{
  socket.on('create',async (data,ack)=>{
    let id;do{id=code()}while(rooms.has(id));
    const hostToken=token();
    const maxRounds=7;
    const room={code:id,hostToken,hostSocket:socket.id,phase:'lobby',round:0,maxRounds,
      questions:QUESTIONS.slice(0,maxRounds),players:new Map(),current:null,options:[],results:null,bettingSeconds:180,bettingDeadline:null,bettingTimer:null,guessingSeconds:120,guessingDeadline:null,guessingTimer:null};
    rooms.set(id,room);socket.data.hostToken=hostToken;identify(socket,room,{host:true});
    const base=(process.env.PUBLIC_URL||data?.origin||'').replace(/\/$/,'');
    const url=base?`${base}/?room=${id}&join=1`:`/?room=${id}&join=1`;
    let qr='';try{qr=await QRCode.toDataURL(url,{margin:1,width:280});}catch{}
    reply(ack,{ok:true,code:id,hostToken,joinUrl:url,qr});broadcast(room);
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
    let player=[...room.players.values()].find(p=>p.secret===data?.playerToken);
    if(!player){
      if(room.phase!=='lobby')return err(ack,'Game already started. Ask the host to start a new game.');
      const name=safeName(data?.name);
      if(!name)return err(ack,'Enter a name.');
      if(room.players.size>=30)return err(ack,'Room is full (30 players).');
      if([...room.players.values()].some(p=>p.name.toLowerCase()===name.toLowerCase()))return err(ack,'That name is taken.');
      player={id:token(),secret:token(),name,color:PLAYER_COLORS[room.players.size%PLAYER_COLORS.length],chips:STARTING_CHIPS,guess:null,bets:[],sockets:new Set()};
      room.players.set(player.id,player);
    }
    identify(socket,room,{player});reply(ack,{ok:true,playerToken:player.secret,name:player.name});broadcast(room);
  });
  socket.on('guess',(data,ack)=>{
    const room=getRoom(socket.data.roomCode);const p=room?.players.get(socket.data.playerId);
    if(!p||room.phase!=='guessing'||(room.guessingDeadline&&Date.now()>=room.guessingDeadline)){if(room?.phase==='guessing'&&room.guessingDeadline&&Date.now()>=room.guessingDeadline)finishGuessing(room);return err(ack,'Guessing is closed.');}
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
  socket.on('setGuessingTimer',(data,ack)=>{
    const room=hostRoom(socket);if(!room)return err(ack,'Only the host can set the timer.');
    const seconds=data?.seconds;
    if(!Number.isInteger(seconds)||seconds<15||seconds>1800)return err(ack,'Choose 15 seconds to 30 minutes.');
    room.guessingSeconds=seconds;
    if(room.phase==='guessing')startGuessingClock(room);
    reply(ack,{ok:true});broadcast(room);
  });
  socket.on('setBettingTimer',(data,ack)=>{
    const room=hostRoom(socket);if(!room)return err(ack,'Only the host can set the timer.');
    const seconds=data?.seconds;
    if(!Number.isInteger(seconds)||seconds<15||seconds>1800)return err(ack,'Choose 15 seconds to 30 minutes.');
    room.bettingSeconds=seconds;
    if(room.phase==='betting')startBettingClock(room);
    reply(ack,{ok:true});broadcast(room);
  });
  socket.on('bet',(data,ack)=>{
    const room=getRoom(socket.data.roomCode);const p=room?.players.get(socket.data.playerId);
    if(!p||room.phase!=='betting'||!room.bettingDeadline||Date.now()>=room.bettingDeadline){if(room?.phase==='betting'&&Date.now()>=room.bettingDeadline)closeBetting(room);return err(ack,'Betting is locked.');}
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
