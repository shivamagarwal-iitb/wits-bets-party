import crypto from 'node:crypto';
import QRCode from 'qrcode';
import {readFileSync} from 'node:fs';
const BANK=JSON.parse(readFileSync(new URL('./data/trivia.json',import.meta.url),'utf8'));
const rooms=new Map();
const rand=()=>crypto.randomBytes(3).toString('hex').toUpperCase();
const secret=()=>crypto.randomBytes(20).toString('hex');
const safe=x=>String(x||'').trim().replace(/[<>]/g,'').slice(0,24);
export function installTrivia(io){
 const send=(ack,result)=>typeof ack==='function'&&ack(result);
 const get=(code)=>rooms.get(String(code||'').toUpperCase());
 const current=room=>room.deck[room.round-1];
 const view=(room,socket)=>{
  const host=socket.data.triviaHost===room.hostToken;
  const player=room.players.get(socket.data.triviaPlayer);
  const reveal=room.phase==='reveal'||room.phase==='finished';
  const q=current(room);
  return {mode:'trivia',code:room.code,phase:room.phase,round:room.round,total:room.total,category:room.category,points:room.points,host,playerId:player?.id||null,players:[...room.players.values()].map(p=>({id:p.id,name:p.name,avatar:p.avatar,score:p.score,submitted:p.answer!==null})).sort((a,b)=>b.score-a.score),question:q?{text:q.q,options:q.options}:null,ownAnswer:player?.answer??null,correct:reveal?q?.answer:null,explanation:reveal?q?.explanation:null,answers:reveal||host&&room.phase!=='lobby'?[...room.players.values()].map(p=>({name:p.name,avatar:p.avatar,choice:p.answer,correct:p.answer===q?.answer})):[],deadline:room.deadline,seconds:room.seconds,joinRequests:host?[...room.pending.values()].map(p=>({id:p.id,name:p.name})):[]};
 };
 const emit=room=>{for(const socket of io.sockets.sockets.values())if(socket.data.triviaCode===room.code)socket.emit('triviaState',view(room,socket));};
 const stop=room=>{clearTimeout(room.timer);room.timer=null;room.deadline=null;};
 const reveal=room=>{if(room.phase!=='answering')return;stop(room);room.phase='reveal';const q=current(room);for(const p of room.players.values())if(p.answer===q.answer)p.score+=room.points;emit(room);};
 const next=room=>{stop(room);if(room.round>=room.total){room.phase='finished';emit(room);return;}room.round++;room.phase='answering';for(const p of room.players.values())p.answer=null;room.deadline=Date.now()+room.seconds*1000;room.timer=setTimeout(()=>reveal(room),room.seconds*1000);emit(room);};
 const hostRoom=socket=>{const room=get(socket.data.triviaCode);return room?.hostToken===socket.data.triviaHost?room:null;};
 io.on('connection',socket=>{
  socket.on('triviaCreate',async(data,ack)=>{
   const category=['cricket','bollywood'].includes(data?.category)?data.category:'cricket';
   let code;do{code=rand()}while(rooms.has(code));
   const deck=[...BANK[category]].sort(()=>crypto.randomInt(3)-1);
   for(let i=deck.length-1;i>0;i--){const j=crypto.randomInt(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];}
   const total=Math.min(Math.max(Number(data?.rounds)||10,3),20,deck.length);
   const room={code,hostToken:secret(),category,deck,total,round:0,phase:'lobby',points:10,seconds:30,deadline:null,timer:null,players:new Map(),pending:new Map()};
   rooms.set(code,room);socket.data.triviaCode=code;socket.data.triviaHost=room.hostToken;
   const base=String(data?.origin||'').replace(/\/$/,'');
   const joinUrl=base+'/trivia.html?room='+code;
   let qr='';try{qr=await QRCode.toDataURL(joinUrl,{width:280,margin:1});}catch{}
   send(ack,{ok:true,code,hostToken:room.hostToken,joinUrl,qr});emit(room);
  });
  socket.on('triviaResume',(data,ack)=>{
   const room=get(data?.code);if(!room)return send(ack,{ok:false,error:'Room not found. Create a new game.'});
   if(data?.hostToken===room.hostToken){socket.data.triviaCode=room.code;socket.data.triviaHost=room.hostToken;socket.data.triviaPlayer=null;}
   else {const p=[...room.players.values()].find(p=>p.token===data?.playerToken);if(!p)return send(ack,{ok:false,error:'Player session not found.'});socket.data.triviaCode=room.code;socket.data.triviaHost=null;socket.data.triviaPlayer=p.id;}
   send(ack,{ok:true});emit(room);
  });
  socket.on('triviaJoin',(data,ack)=>{
   const room=get(data?.code),name=safe(data?.name);
   if(!room||!name)return send(ack,{ok:false,error:'Enter a valid room and name.'});
   if([...room.players.values(),...room.pending.values()].some(p=>p.name.toLowerCase()===name.toLowerCase()))return send(ack,{ok:false,error:'Name already taken.'});
   if(room.players.size>=30)return send(ack,{ok:false,error:'Room is full.'});
   const p={id:secret(),token:secret(),name,avatar:typeof data?.avatar==='string'&&data.avatar.startsWith('preset:')?data.avatar:null,score:0,answer:null};
   if(room.phase!=='lobby'){room.pending.set(p.id,{...p,socketId:socket.id});socket.data.triviaPending=room.code;send(ack,{ok:true,pending:true});emit(room);return;}
   room.players.set(p.id,p);socket.data.triviaCode=room.code;socket.data.triviaPlayer=p.id;send(ack,{ok:true,code:room.code,playerToken:p.token});emit(room);
  });
  socket.on('triviaReview',(data,ack)=>{
   const room=hostRoom(socket);if(!room)return send(ack,{ok:false,error:'Host only.'});
   const p=room.pending.get(data?.id);if(!p)return send(ack,{ok:false,error:'Request expired.'});
   room.pending.delete(p.id);const guest=io.sockets.sockets.get(p.socketId);
   if(data?.approve&&guest?.connected){room.players.set(p.id,p);guest.data.triviaCode=room.code;guest.data.triviaPlayer=p.id;guest.emit('triviaDecision',{ok:true,code:room.code,playerToken:p.token});}
   else guest?.emit('triviaDecision',{ok:false,error:'Host declined your request.'});
   send(ack,{ok:true});emit(room);
  });
  socket.on('triviaAnswer',(data,ack)=>{
   const room=get(socket.data.triviaCode),p=room?.players.get(socket.data.triviaPlayer);
   if(!p||room.phase!=='answering'||(room.deadline&&Date.now()>room.deadline))return send(ack,{ok:false,error:'Answers are closed.'});
   if(!Number.isInteger(data?.choice)||data.choice<0||data.choice>3)return send(ack,{ok:false,error:'Choose A, B, C or D.'});
   p.answer=data.choice;send(ack,{ok:true});emit(room);
  });
  socket.on('triviaAdvance',(data,ack)=>{
   const room=hostRoom(socket);if(!room)return send(ack,{ok:false,error:'Host only.'});
   if(room.phase==='lobby'&&room.players.size<2)return send(ack,{ok:false,error:'At least two players needed.'});
   if(room.phase==='answering')reveal(room);else if(['lobby','reveal'].includes(room.phase))next(room);else return send(ack,{ok:false,error:'Game already finished.'});
   send(ack,{ok:true});emit(room);
  });
  socket.on('triviaSetTimer',(data,ack)=>{const room=hostRoom(socket);if(!room)return send(ack,{ok:false,error:'Host only.'});if(!Number.isInteger(data?.seconds)||data.seconds<10||data.seconds>300)return send(ack,{ok:false,error:'Choose 10–300 seconds.'});room.seconds=data.seconds;send(ack,{ok:true});emit(room);});
  socket.on('triviaDisconnect',(_,ack)=>send(ack,{ok:true}));
 });
}
