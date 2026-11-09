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
    "q": "In which year did a sitting U.S. president first personally celebrate Diwali at the White House?",
    "a": 2009,
    "fact": "Barack Obama lit a traditional diya at the White House in 2009, becoming the first sitting U.S. president to personally take part in its Diwali ceremony. Here's the twist: the White House had hosted Diwali events since 2003, under George W. Bush, but Bush did not personally attend. Obama later celebrated Diwali with schoolchildren in Mumbai in 2010."
  },
  {
    "q": "What was the highest reported rupee-per-point stake at Aamir Khan's Diwali card parties?",
    "a": 5000,
    "fact": "At Aamir Khan's Diwali card gatherings, a 2016 report described stakes ranging from just ₹5 all the way up to ₹5,000 per point, with roughly six card tables at his residence. That is quite a leap from the small-stakes card games many families enjoy during Diwali! The ₹5,000 figure is the reported upper end of the range, not what everyone bet."
  },
  {
    "q": "How many people performed aarti together at Ayodhya's 2025 Deepotsav to set a Guinness World Record?",
    "a": 2128,
    "fact": "At Ayodhya's 2025 Deepotsav, 2,128 participants performed aarti together in a record-setting ceremony on the banks of the Saryu River. The coordinated ritual was one of the festival's two headline Guinness World Records, alongside its enormous display of illuminated diyas."
  },
  {
    "q": "What was the reported price per kilogram of Lucknow's 24-karat gold-covered Exotica mithai?",
    "a": 50000,
    "fact": "A luxury mithai with a seriously extravagant price tag! Lucknow's Chappan Bhog sold Exotica for a reported ₹50,000 per kilogram. The sweet was finished with edible 24-karat gold leaf and featured ingredients such as macadamia nuts, blackberries and imported raisins. This is the reported price at the time of the story, not a current menu price."
  },
  {
    "q": "How many metric tons of gold were estimated to have been sold across India on Dhanteras in 2025?",
    "a": 40,
    "fact": "Dhanteras is traditionally an auspicious time to buy gold, and jewellery shops see a major festive rush. For Dhanteras 2025, the Gems and Jewellery Domestic Council estimated sales of about 40 metric tons of gold across India—that's roughly 40,000 kilograms in a single day! The number is an industry estimate, not an exact audited count, and estimates can vary by source."
  },
  {
    "q": "How many minutes does India's special Diwali Muhurat Trading session last?",
    "a": 60,
    "fact": "Diwali is normally a stock-market holiday in India, but the NSE and BSE open for a special, symbolic Muhurat Trading session lasting 60 minutes. The tradition marks an auspicious start for investors, and some buy a small amount of shares as a good-luck gesture. The exact clock time changes from year to year, but the special trading session lasts one hour."
  },
  {
    "q": "Roughly what percentage of India's fireworks are manufactured in and around Sivakasi, Tamil Nadu?",
    "a": 90,
    "fact": "A huge share of India's festive fireworks comes from one remarkable manufacturing hub: Sivakasi in Tamil Nadu, often called India's fireworks capital. Industry figures have commonly put its share at around 90%, although estimates vary by year and scope. The town is also famous for match-making and printing, and has long been nicknamed 'Kutty Japan' (Little Japan) for its industrial activity."
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
    publicBets:['open-bets','locked-bets','results'].includes(room.phase)?[...room.players.values()].flatMap(p=>p.bets.map(b=>({name:p.name,slot:b.slot,optionId:b.optionId,extra:b.extra}))):[],
    ownGuess:viewerId?room.players.get(viewerId)?.guess:null,
    ownBets:viewerId?room.players.get(viewerId)?.bets:[],
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
function startRound(room) {
  if(room.round>=room.maxRounds){room.phase='finished';return;}
  room.round++;
  room.current=room.questions[room.round-1];
  room.phase='guessing';room.options=[];room.results=null;
  for(const p of room.players.values()){p.guess=null;p.bets=[];}
}
function revealGuesses(room){
  const values=[...new Set([...room.players.values()].map(p=>p.guess).filter(v=>v!==null))].sort((a,b)=>a-b);
  room.options=[{id:'all-high',value:null,odds:6,guessers:[]},...values.map((value,i)=>({id:String(i),value,guessers:[...room.players.values()].filter(p=>p.guess===value).map(p=>({name:p.name,color:p.color})),odds:values.length<=1?2:Math.max(2,Math.min(6,Math.round(2+Math.abs(i-(values.length-1)/2))))}))];
  room.phase='betting';
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
      questions:QUESTIONS.slice(0,maxRounds),players:new Map(),current:null,options:[],results:null};
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
    if(!p||room.phase!=='guessing')return err(ack,'Guessing is closed.');
    if(typeof data?.value!=='number'||!integer(data.value)||data.value>1000000000)return err(ack,'Enter a whole number from 0 to 1,000,000,000.');
    p.guess=data.value;reply(ack,{ok:true});broadcast(room);
  });
  socket.on('bet',(data,ack)=>{
    const room=getRoom(socket.data.roomCode);const p=room?.players.get(socket.data.playerId);
    if(!p||!['betting','final-betting'].includes(room.phase))return err(ack,'Betting is locked.');
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
      revealGuesses(room);
    }else if(room.phase==='betting')room.phase='open-bets';
    else if(room.phase==='open-bets')room.phase='final-betting';
    else if(room.phase==='final-betting')room.phase='locked-bets';
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
