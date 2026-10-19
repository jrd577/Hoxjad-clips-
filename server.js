import express from 'express';import multer from 'multer';import {spawn} from 'child_process';import fs from 'fs';import path from 'path';import {randomUUID} from 'crypto';
const app=express(),PORT=process.env.PORT||3000,DATA=process.env.DATA_DIR||'./data',MAXN=+process.env.MAX_CLIPS||100,CODE=process.env.ACCESS_CODE||'';
fs.mkdirSync(path.join(DATA,'tmp'),{recursive:true});
const up=multer({dest:path.join(DATA,'tmp'),limits:{fileSize:2e9}}),jobs={};
app.use(express.static('public'));app.use('/clips',express.static(path.join(DATA,'out')));
app.use('/api',(q,r,n)=>CODE&&q.get('x-access-code')!==CODE?r.status(401).json({error:'Wrong access code'}):n());
const run=(cmd,args,cwd)=>new Promise((res,rej)=>{const p=spawn(cmd,args.map(String),{cwd});let e='';p.stderr.on('data',d=>e+=d);p.on('error',rej);p.on('close',c=>c?rej(new Error(cmd+' failed: '+e.slice(-300))):res())});
app.post('/api/jobs',up.single('file'),(q,r)=>{const b=q.body,id=randomUUID().slice(0,8);
  const o={url:(b.url||'').trim(),file:q.file?.path,n:Math.min(MAXN,Math.max(1,+b.n||3)),min:+b.min||30,max:+b.max||60,prompt:b.prompt||'Select the most interesting moments',vertical:b.vertical!=='false',captions:b.captions!=='false',niche:b.niche||'general'};
  if(!o.url&&!o.file)return r.status(400).json({error:'Paste a link or upload a file'});
  if(o.url&&!/^https?:\/\//.test(o.url))return r.status(400).json({error:'Link must start with http(s)://'});
  jobs[id]={status:'running',step:'Queued',clips:[]};work(id,o).catch(e=>{jobs[id].status='error';jobs[id].step=e.message});r.json({id})});
app.get('/api/jobs/:id',(q,r)=>jobs[q.params.id]?r.json(jobs[q.params.id]):r.status(404).json({error:'Not found'}));
async function work(id,o){const J=jobs[id],W=path.join(DATA,'work',id),O=path.join(DATA,'out',id),S=s=>J.step=s;fs.mkdirSync(W,{recursive:true});fs.mkdirSync(O,{recursive:true});
  if(o.url){S('Downloading video');await run('yt-dlp',['-f','bv*[height<=1080]+ba/b','--merge-output-format','mp4','--no-playlist','-o','source.mp4',o.url],W)}else fs.renameSync(o.file,path.join(W,'source.mp4'));
  S('Extracting audio');await run('ffmpeg',['-y','-i','source.mp4','-vn','-ac','1','-ar','16000','-b:a','32k','a.mp3'],W);
  S('Transcribing speech');const segs=await transcribe(path.join(W,'a.mp3'));if(!segs.length)throw new Error('No speech found in this video');
  const dur=segs.at(-1).end;S('AI is choosing clips');const picks=await choose(segs,o,dur);
  for(let i=0;i<picks.length;i++){S(`Cutting clip ${i+1} of ${picks.length}`);await cut(W,O,segs,picks[i],i,o);J.clips.push({...picks[i],file:`/clips/${id}/clip-${i+1}.mp4`})}
  J.clips.sort((a,b)=>b.score-a.score);J.status='done';S('Done');fs.rmSync(W,{recursive:true,force:true})}
async function transcribe(f){const fd=new FormData();fd.append('file',new Blob([fs.readFileSync(f)]),'a.mp3');fd.append('model','whisper-1');fd.append('response_format','verbose_json');
  const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY},body:fd});
  if(!r.ok)throw new Error('Transcription failed: '+(await r.text()).slice(0,200));return(await r.json()).segments.map(s=>({start:s.start,end:s.end,text:s.text.trim()}))}
async function choose(segs,o,dur){const B=Math.ceil(o.n/10),out=[];
  for(let b=0;b<B;b++){const k=Math.min(10,o.n-b*10),a=b*dur/B,z=(b+1)*dur/B,t=segs.filter(s=>s.start>=a&&s.start<z).map(s=>`[${s.start.toFixed(1)}] ${s.text}`).join('\n').slice(0,150000);
    const p=`You are a short-form video editor and growth strategist. Transcript lines are [start seconds] text, covering seconds ${a.toFixed(0)}-${z.toFixed(0)} of a ${dur.toFixed(0)}s video.
User request: "${o.prompt}". Niche: ${o.niche}.
Pick exactly ${k} non-overlapping clips of ${o.min}-${o.max} seconds. Start where a thought begins, end where it finishes. Score critically using the full 0-100 range.
Return only a JSON array of {"start":sec,"end":sec,"title":"","reason":"one sentence","score":0-100,"hook":0-100,"flow":0-100,"value":0-100,"trend":0-100,"caption":"post caption under 200 chars","hashtags":["#a"],"bestTime":"best weekday and local time to post for this niche"}.
Transcript:
${t}`;
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model:process.env.CLAUDE_MODEL||'claude-sonnet-5-5',max_tokens:6000,messages:[{role:'user',content:p}]})});
    const j=await r.json();if(!r.ok)throw new Error('AI failed: '+JSON.stringify(j).slice(0,200));
    JSON.parse(j.content.map(c=>c.text||'').join('').replace(/```json|```/g,'').trim()).forEach(c=>{const s=Math.max(0,+c.start),e=Math.min(dur,+c.end);if(e-s>=5)out.push({...c,start:s,end:e,hashtags:(c.hashtags||[]).join(' ')})})}
  return out}
const ts=t=>{const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=Math.floor(t%60),ms=Math.floor(t%1*1000);return[h,m,s].map(v=>String(v).padStart(2,'0')).join(':')+','+String(ms).padStart(3,'0')};
async function cut(W,O,segs,c,i,o){let n=0,srt='';segs.filter(s=>s.end>c.start&&s.start<c.end).forEach(s=>{srt+=`${++n}\n${ts(Math.max(0,s.start-c.start))} --> ${ts(Math.min(c.end,s.end)-c.start)}\n${s.text}\n\n`});
  fs.writeFileSync(path.join(W,`c${i}.srt`),srt);
  const vf=[o.vertical?'crop=ih*9/16:ih,scale=1080:1920':'scale=-2:1080'];
  if(o.captions&&n)vf.push(`subtitles=c${i}.srt:force_style='FontName=DejaVu Sans,Bold=1,Fontsize=${o.vertical?15:20},Alignment=2,MarginV=${o.vertical?180:40},Outline=3,PrimaryColour=&H00FFFFFF&'`);
  await run('ffmpeg',['-y','-ss',c.start,'-to',c.end,'-i','source.mp4','-vf',vf.join(','),'-c:v','libx264','-preset','veryfast','-crf','23','-c:a','aac',path.join('..','..','out',path.basename(O),`clip-${i+1}.mp4`)],W)}
app.listen(PORT,()=>console.log('Hoxjad Clips on '+PORT));
