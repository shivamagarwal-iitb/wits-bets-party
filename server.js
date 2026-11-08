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
const STARTING_CHIPS = 100;
const QUESTIONS = [
  {q:"How many oil lamps were lit in Ayodhya's Deepotsav 2022 record?", a:1576944},
  {q:"How many diyas were displayed in Ayodhya's Deepotsav 2023 record?", a:2223676},
  {q:"How many diyas were displayed in Ayodhya's Deepotsav 2024 record?", a:2512585},
  {q:"How many diyas were displayed in Ayodhya's Deepotsav 2025 record?", a:2617215},
  {q:"How many people performed diya rotations simultaneously at Ayodhya's 2024 Saryu Aarti record?", a:1121},
  {q:"Within how many minutes were all the record-breaking diyas lit at Ayodhya's 2025 Deepotsav?", a:25},
  {q:"Across how many ghats were the record-breaking lamps arranged at Ayodhya's 2025 Deepotsav?", a:56}
];
const code = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const token = () => crypto.randomBytes(24).toString('hex');
const safeName = x => String(x ?? '').trim().replace(/[<>]/g,'').slice(0,24);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const reply = (ack, data) => { if (typeof ack === 'function') ack(data); };
const err = (ack, message) => reply(ack,{ok:false,error:message});
function getRoom(id) { return rooms.get(String(id ?? '').toUpperCase()); }
function playerView(p) { return {id:p.id,name:p.name,chips:p.chips,connected:p.sockets.size,submitted:p.guess!==null,betCount:p.bets.length}; }
function state(room, viewerId, host=false) {
  const isRevealed = ['betting','results'].includes(room.phase);
  return {
    code:room.code, phase:room.phase, round:room.round, maxRounds:room.maxRounds,
    players:[...room.players.values()].map(playerView).sort((a,b)=>b.chips-a.chips),
    question:room.phase==='lobby'?null:room.current?.q,
    guesses:isRevealed?room.options:[],
    results:room.phase==='results'?room.results:null,
    ownGuess:viewerId?room.players.get(viewerId)?.guess:null,
    ownBets:viewerId?room.players.get(viewerId)?.bets:[],
    host, isPlayer:!!viewerId,
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
  room.options=values.map((value,i)=>({id:String(i),value,odds:values.length<=1?2:Math.max(2,Math.min(6,Math.round(2+Math.abs(i-(values.length-1)/2))))}));
  room.phase='betting';
}
function settle(room){
  const answer=room.current.a;
  const eligible=room.options.filter(o=>o.value<=answer);
  const winning=eligible.length?eligible[eligible.length-1]:null;
  const payouts=[];
  for(const p of room.players.values()){
    let payout=0;
    for(const bet of p.bets){
      const option=room.options.find(o=>o.id===bet.optionId);
      if(winning && bet.optionId===winning.id) payout+=bet.amount*(option.odds+1);
    }
    p.chips+=payout;
    payouts.push({name:p.name,payout});
  }
  room.results={answer,winningOptionId:winning?.id??null,winningValue:winning?.value??null,payouts};
  room.phase='results';
}
io.on('connection',socket=>{
  socket.on('create',async (data,ack)=>{
    let id;do{id=code()}while(rooms.has(id));
    const hostToken=token();
    const maxRounds=7;
    const room={code:id,hostToken,hostSocket:socket.id,phase:'lobby',round:0,maxRounds,
      questions:[...QUESTIONS].sort(()=>Math.random()-.5).slice(0,maxRounds),players:new Map(),current:null,options:[],results:null};
    rooms.set(id,room);socket.data.hostToken=hostToken;identify(socket,room,{host:true});
    const base=(process.env.PUBLIC_URL||data?.origin||'').replace(/\/$/,'');
    const url=base?`${base}/?room=${id}`:`/?room=${id}`;
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
      player={id:token(),secret:token(),name,chips:STARTING_CHIPS,guess:null,bets:[],sockets:new Set()};
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
    if(!p||room.phase!=='betting')return err(ack,'Betting is closed.');
    if(!room.options.some(o=>o.id===data?.optionId))return err(ack,'Choose a valid answer.');
    if(!integer(data?.amount)||data.amount<1||data.amount>20)return err(ack,'Bet 1–20 chips at a time.');
    if(p.chips<data.amount)return err(ack,'Not enough chips.');
    if(p.bets.length>=2)return err(ack,'Maximum two bets per round.');
    p.chips-=data.amount;p.bets.push({optionId:data.optionId,amount:data.amount});
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
    }else if(room.phase==='betting')settle(room);
    else if(room.phase==='results')startRound(room);
    else return err(ack,'The game has ended.');
    reply(ack,{ok:true});broadcast(room);
  });
  socket.on('disconnect',()=>{
    const room=getRoom(socket.data.roomCode);
    if(room&&socket.data.playerId){room.players.get(socket.data.playerId)?.sockets.delete(socket.id);broadcast(room);}
  });
});
app.get('/health',(_req,res)=>res.json({ok:true,rooms:rooms.size}));
const port=Number(process.env.PORT||3000);
server.listen(port,()=>console.log(`Wits & Bets Party listening on http://localhost:${port}`));
