import { resolveCuratedTheme, restoredThemeSelection, selectedTheme } from './themes.js';
import { DEFAULT_LAYOUT_STYLE, availabilityNote, effectiveLayoutStyle, layoutStyles, wordProfileFor } from './layouts/styles.js';

function generatePuzzle(options) {
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./puzzle-worker.js',import.meta.url),{type:'module'});
  const timeout=setTimeout(()=>{worker.terminate();reject(new Error('This grid is taking too long. Please try generating again.'));},15000);
  const finish=()=>{clearTimeout(timeout);worker.terminate();};
  worker.onmessage=({data})=>{finish();if(data.error){const error=new Error(data.error);error.code=data.code;reject(error);}else resolve(data.puzzle);};
  worker.onerror=()=>{finish();reject(new Error('The puzzle generator could not load. Refresh the page and try again.'));};
  worker.postMessage(options);
 });
}
const $ = s => document.querySelector(s);
// Attribution for AI-supplied themes: which model answered and what the call cost in tokens.
function sourceLine(source) {const usage=source.usage;const format=(value)=>value==null?'unknown':value.toLocaleString();const tokens=usage?` · ${format(usage.input)} tokens in / ${format(usage.output)} out`:'';return `AI-generated theme words · ${source.model}${tokens}`;}
function showSource(source) {const note=$('#ai-note');note.hidden=!source;if(source)$('#ai-note-text').textContent=sourceLine(source);}
function newRequestId() {return crypto.randomUUID();}
// Concise, user-facing copy for the layout-generation error codes the worker can surface; unknown codes fall through to the generic handling below.
const CODE_MESSAGES=Object.freeze({'american-theme-anchors-insufficient':'This theme doesn’t have enough American-style anchor words yet. Try a broader theme, or generate again.','american-fill-exhausted':'The grid ran out of matching fill words. Please generate again.','american-deadline-exceeded':'This grid took too long to fill. Please generate again.'});
function retryDelay(response, attempt) {const retryAfter=Number(response.headers.get('retry-after'));return Math.min(4000, Number.isFinite(retryAfter)&&retryAfter>=0?retryAfter*1000:500*2**attempt);}
async function fetchThemeWords(payload, requestId) {
 const body=JSON.stringify({...payload,requestId});
 for(let attempt=0;attempt<3;attempt++){
  let response;
  try {response=await fetch('/api/words',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(130000)});}
  catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,Math.min(4000,500*2**attempt)));continue;}
  const data=await response.json().catch(()=>({}));
  if(response.ok)return data;
  const retryable=response.status===202||data.retryable===true;
  if(retryable&&attempt<2){await new Promise(resolve=>setTimeout(resolve,retryDelay(response,attempt)));continue;}
  const error=new Error(data.error||'Could not generate this theme. Please try again.');error.status=response.status;error.retryable=retryable;throw error;
 }
 throw new Error('Could not generate this theme. Please try again.');
}
$('.board-actions').after($('#keyboard'));
let size = 5, difficulty = 'easy', puzzle, letters = {}, selected = null, active = 0, elapsed = 0, solved = false, wrong = new Set(), history = [];
try { history = JSON.parse(localStorage.getItem('crossfolk-history') || '[]'); if (!Array.isArray(history)) history=[]; } catch {}
let preferredLayoutStyle=DEFAULT_LAYOUT_STYLE;
for(const style of layoutStyles){const opt=document.createElement('option');opt.value=style.id;opt.textContent=style.label;$('#layout-style').append(opt);}
$('#layout-style').value=preferredLayoutStyle;
function updateLayoutStyleHint() {const style=layoutStyles.find(s=>s.id===preferredLayoutStyle);const note=availabilityNote(preferredLayoutStyle,size);const hint=$('#layout-style-hint');hint.textContent=style.helper+(note?` ⚠ ${note}`:'');hint.classList.toggle('is-note',Boolean(note));}
$('#layout-style').onchange=e=>{preferredLayoutStyle=e.target.value;updateLayoutStyleHint();};
function setControlsDisabled(disabled) {$('#layout-style').disabled=disabled;$('#theme-preset').disabled=disabled;$('#theme').disabled=disabled;for(const b of $('#sizes').children)b.disabled=disabled;for(const b of $('#difficulties').children)b.disabled=disabled;}
updateLayoutStyleHint();
const key = (r,c) => `${r},${c}`;
const cellsFor = e => [...e.answer].map((_,i)=>key(e.row+(e.direction==='down'?i:0),e.col+(e.direction==='across'?i:0)));
function save() { try { localStorage.setItem('crossfolk-game',JSON.stringify({puzzle,letters,elapsed,active,selected,solved})); localStorage.setItem('crossfolk-history',JSON.stringify(history.slice(-100))); } catch {} }
function selectEntry(i,cell) { active=i; selected=cell || cellsFor(puzzle.entries[i]).find(k=>!letters[k]) || cellsFor(puzzle.entries[i])[0]; render(); }
function selectCell(k) { const matches=puzzle.entries.map((e,i)=>cellsFor(e).includes(k)?i:-1).filter(i=>i>=0); if(k===selected && matches.length>1) active=matches.find(i=>i!==active); else if(!matches.includes(active)) active=matches[0]; selected=k; render(); }
function render() {
 if(!puzzle)return;
 const restoreFocus = document.activeElement?.closest('#board');
 const entry=puzzle.entries[active], current=cellsFor(entry);
 $('#puzzle-title').textContent=puzzle.theme;
 $('#puzzle-size').textContent=`${puzzle.size} × ${puzzle.size}`;
 $('#puzzle-difficulty').textContent=puzzle.difficulty || difficulty;
 $('#word-count').textContent=puzzle.layoutStyle==='american'?`${puzzle.entries.length} entries · ${puzzle.entries.filter(e=>e.isTheme).length} featured theme entries`:`${puzzle.entries.length} words${puzzle.entries.some(e=>e.isTheme!==undefined)?' · '+puzzle.entries.filter(e=>e.isTheme).length+' themed':''}`;
 const coverage=new Map();puzzle.entries.forEach(e=>cellsFor(e).forEach(k=>coverage.set(k,(coverage.get(k)||0)+1)));
 $('#crossing-count').textContent=`${Math.round([...coverage.values()].filter(n=>n===2).length/coverage.size*100)}% crossed`;
 showSource(puzzle.source);
 $('#active-clue').replaceChildren(); const b=document.createElement('b'); b.textContent=`${entry.number} ${entry.direction==='across'?'→':'↓'}`; const t=document.createElement('span');t.textContent=entry.clue;$('#active-clue').append(b,t);
 const board=$('#board');board.style.setProperty('--size',puzzle.size);board.replaceChildren();$('.board-scroll').className=`board-scroll ${puzzle.size===13?'large':puzzle.size===9?'medium':''}`;
 let filled=0,total=0,correct=0;
 puzzle.grid.forEach((row,r)=>row.forEach((answer,c)=>{
 const k=key(r,c), cell=document.createElement(answer?'button':'div');cell.className='cell';
 if(!answer){cell.classList.add('block');cell.setAttribute('aria-hidden','true');}
 else {total++;if(letters[k])filled++;if(letters[k]===answer)correct++;
 cell.type='button';cell.dataset.large=puzzle.size>5;cell.tabIndex=k===selected?0:-1;
 if(current.includes(k))cell.classList.add('in-word');if(k===selected)cell.classList.add('selected');if(wrong.has(k))cell.classList.add('wrong');
 const start=puzzle.entries.find(e=>e.row===r&&e.col===c);if(start){const n=document.createElement('small');n.textContent=start.number;cell.append(n);}const letter=document.createElement('span');letter.textContent=letters[k]||'';cell.append(letter);
 cell.setAttribute('aria-label',`Row ${r+1}, column ${c+1}${start?`, clue ${start.number}`:''}: ${letters[k]||'empty'}${wrong.has(k)?', incorrect':''}`);cell.setAttribute('aria-pressed',String(k===selected));cell.addEventListener('click',()=>selectCell(k));}
 board.append(cell);
 }));
 for(const direction of ['across','down']){const container=$('#'+direction);container.replaceChildren();puzzle.entries.forEach((e,i)=>{if(e.direction!==direction)return;const btn=document.createElement('button');btn.className='clue'+(i===active?' active':'')+(cellsFor(e).every((k,j)=>letters[k]===e.answer[j])?' done':'');btn.setAttribute('aria-pressed',String(i===active));const n=document.createElement('b');n.textContent=e.number;const text=document.createElement('span');text.textContent=e.clue+' ';const len=document.createElement('span');len.className='length';len.textContent=`(${e.answer.length})`;text.append(len);btn.append(n,text);btn.onclick=()=>selectEntry(i);container.append(btn);});}
 const percent=Math.round(filled/total*100);$('#progress-count').textContent=percent+'%';$('#progress-bar').style.width=percent+'%';$('#progress-label').textContent=filled?`${filled} of ${total} squares filled`:'Your next little win starts here.';
 if(correct===total&&!solved){solved=true;$('#game-message').textContent='Beautifully done! Every word, connected. Create another to keep exploring.';}else if(correct!==total)solved=false;
 save();
 if(restoreFocus)$('#board .selected')?.focus({preventScroll:true});
}
function enter(value) {if(!puzzle||!selected)return;const cells=cellsFor(puzzle.entries[active]);let pos=cells.indexOf(selected);wrong.delete(selected);$('#game-message').textContent='';
 if(value==='Backspace'){if(!letters[selected]&&pos>0)selected=cells[--pos];delete letters[selected];wrong.delete(selected);}
 else if(value==='Delete'){delete letters[selected];}
 else if(/^[a-z]$/i.test(value)){letters[selected]=value.toUpperCase();if(pos<cells.length-1)selected=cells[pos+1];}
 else return;render();}
function nextClue(back=false){selectEntry((active+(back?-1:1)+puzzle.entries.length)%puzzle.entries.length);}
 document.addEventListener('keydown',e=>{if(!puzzle||$('#help-dialog').open||e.target.matches('input,textarea,select')||e.ctrlKey||e.metaKey||e.altKey)return;if(e.target.closest('.settings')||e.target.closest('header'))return;
 if(e.key==='Tab' && e.target.closest('#board')){e.preventDefault();nextClue(e.shiftKey);$('#board .selected')?.focus({preventScroll:true});}
 else if(e.key===' ' && e.target.closest('#board')){e.preventDefault();selectCell(selected);$('#board .selected')?.focus({preventScroll:true});}
 else if(e.key.startsWith('Arrow')){e.preventDefault();const [r,c]=selected.split(',').map(Number);const dr=e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0,dc=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;let nr=r+dr,nc=c+dc;while(nr>=0&&nc>=0&&nr<puzzle.size&&nc<puzzle.size){if(puzzle.grid[nr][nc]){selectCell(key(nr,nc));break;}nr+=dr;nc+=dc;}$('#board .selected')?.focus({preventScroll:true});}
 else if(/^[a-z]$/i.test(e.key)||['Backspace','Delete'].includes(e.key)){e.preventDefault();enter(e.key);$('#board .selected')?.focus({preventScroll:true});}
 });
 $('#sizes').onclick=e=>{const b=e.target.closest('[data-size]');if(!b)return;size=Number(b.dataset.size);for(const x of $('#sizes').children){x.classList.toggle('chosen',x===b);x.setAttribute('aria-pressed',String(x===b));}updateLayoutStyleHint();};
 $('#difficulties').onclick=e=>{const b=e.target.closest('[data-difficulty]');if(!b)return;difficulty=b.dataset.difficulty;for(const x of $('#difficulties').children){x.classList.toggle('chosen',x===b);x.setAttribute('aria-pressed',String(x===b));}};
async function create(initial=false){const theme=selectedTheme($('#theme').value,$('#theme-preset').value);if(!theme){$('#theme').setCustomValidity('Enter a few words for your theme.');$('#theme').reportValidity();return;}$('#theme').setCustomValidity('');$('#generate').disabled=true;setControlsDisabled(true);$('#generate').textContent='Connecting the clues…';$('#error').textContent='';
 // One frozen snapshot drives both the AI request and the worker call, so a control changed mid-flight cannot pair mismatched requests.
 const layoutStyle=effectiveLayoutStyle(preferredLayoutStyle,size);const wordProfile=wordProfileFor(layoutStyle);
 const requestId=newRequestId();const requestPayload=Object.freeze({theme,size,difficulty,exclude:history.slice(-8).flat().slice(-100),wordProfile});
 const intent=Object.freeze({theme,size,difficulty,layoutStyle,wordProfile});
 let words,aiUnavailable=false,source=null,aiNotice='';
 try {
 if(!initial&&!resolveCuratedTheme(theme)){
  $('#ai-note').hidden=false;$('#ai-note-text').textContent='Asking the AI for theme words…';
  try {const data=await fetchThemeWords(requestPayload,requestId);words=data.words;source=data.source||null;}
  catch(error){if((error.status===503||error.status===429)&&!error.retryable){aiUnavailable=true;aiNotice=error.message;}else throw error;}
 }
 const next=await generatePuzzle({...intent,history,words,deadline:Date.now()+13500});puzzle={...next,difficulty,source};letters={};elapsed=0;solved=false;wrong.clear();active=0;selected=cellsFor(puzzle.entries[0])[0];history.push(puzzle.entries.map(e=>e.answer));$('#game-message').textContent='';$('#error').textContent=aiNotice;render();updateTimer();
 }catch(error){showSource(puzzle?.source);const needsAi=aiUnavailable&&error.code==='theme-words-unavailable';const codeMessage=CODE_MESSAGES[error.code];const message=codeMessage||(error.name==='TimeoutError'?'Theme generation took too long. Please try again.':error.message||'Something went wrong. Please try again.');$('#error').textContent=needsAi?`${error.message} To play any theme, set OPENROUTER_API_KEY (for example in .env) and restart the server.`:message;}finally{$('#generate').disabled=false;setControlsDisabled(false);$('#generate').innerHTML='Create my crossword <span>→</span>';}}
 $('#settings-form').onsubmit=e=>{e.preventDefault();create();};$('#theme-preset').onchange=()=>{$('#theme').value='';$('#theme').setCustomValidity('');};$('#theme').oninput=()=>{$('#theme-preset').value='';$('#theme').setCustomValidity('');};
 $('#check').onclick=()=>{wrong.clear();for(const [k,v]of Object.entries(letters)){const[r,c]=k.split(',').map(Number);if(v!==puzzle.grid[r][c])wrong.add(k);}$('#game-message').textContent=wrong.size?`${wrong.size} ${wrong.size===1?'letter needs':'letters need'} another look. Marked in red.`:Object.keys(letters).length?'Looking good. Your filled letters are correct!':'Add a few letters, then check your work.';render();};
 $('#reveal').onclick=()=>{const[r,c]=selected.split(',').map(Number);letters[selected]=puzzle.grid[r][c];wrong.delete(selected);$('#game-message').textContent='A little nudge. One letter revealed.';render();};
 $('#clear').onclick=()=>{if(!Object.keys(letters).length)return;if(confirm('Clear all your letters in this puzzle?')){letters={};wrong.clear();solved=false;$('#game-message').textContent='A fresh start. You’ve got this.';render();}};
 const dialog=$('#help-dialog');$('#help').onclick=()=>dialog.showModal();$('.close').onclick=()=>dialog.close();$('.close-help').onclick=()=>dialog.close();dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
 for(const row of ['QWERTYUIOP','ASDFGHJKL','ZXCVBNM']){const div=document.createElement('div');div.className='key-row';for(const letter of row){const b=document.createElement('button');b.textContent=letter;b.setAttribute('aria-label',`Enter ${letter}`);b.onclick=()=>enter(letter);div.append(b);}if(row==='ZXCVBNM'){const next=document.createElement('button');next.textContent='Next';next.className='wide';next.onclick=()=>nextClue();div.prepend(next);const back=document.createElement('button');back.textContent='⌫';back.className='wide';back.setAttribute('aria-label','Backspace');back.onclick=()=>enter('Backspace');div.append(back);}$('#keyboard').append(div);}
 function updateTimer(){$('#timer').textContent=`${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;}
 setInterval(()=>{if(puzzle&&!solved&&!document.hidden&&!dialog.open){elapsed++;updateTimer();if(elapsed%5===0)save();}},1000);
 try{const saved=JSON.parse(localStorage.getItem('crossfolk-game'));if(saved?.puzzle?.entries?.length&&saved.puzzle.grid){({puzzle,letters,elapsed,active,selected,solved}=saved);size=puzzle.size;difficulty=puzzle.difficulty||'easy';preferredLayoutStyle=puzzle.layoutStyle??'freeform';$('#layout-style').value=preferredLayoutStyle;const themeSelection=restoredThemeSelection(puzzle.theme);$('#theme-preset').value=themeSelection.preset;$('#theme').value=themeSelection.custom;document.querySelector(`[data-size="${size}"]`).click();document.querySelector(`[data-difficulty="${difficulty}"]`).click();render();updateTimer();}}catch{puzzle=null;}
 if(!puzzle)create(true);
