const $ = id => document.getElementById(id);
const categories = ['식비','카페·간식','교통','쇼핑','주거·통신','건강','문화·여가','기타'];
const won = n => new Intl.NumberFormat('ko-KR').format(n) + '원';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
let editing = null, records = [], requestId = 0;
$('month').value = today().slice(0,7);
categories.forEach(c => $('category').add(new Option(c,c)));
async function api(url, options = {}) {
  const response = await fetch('/api' + url, { ...options, headers: { 'Content-Type':'application/json' }, credentials:'same-origin' });
  const data = await response.json();
  if (!response.ok) { if(response.status === 401 && url !== '/login') showLogin(); throw new Error(data.error || '요청에 실패했습니다.'); }
  return data;
}
function showLogin() { $('login-view').hidden = false; $('dashboard').hidden = true; $('editor').close(); }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 4500); }
function node(tag, text, className) { const el = document.createElement(tag); if(text !== undefined) el.textContent = text; if(className) el.className = className; return el; }
async function load() {
  const id = ++requestId;
  try {
    const query = new URLSearchParams({ month:$('month').value });
    if($('date-filter').value) query.set('date',$('date-filter').value);
    const data = await api('/expenses?' + query);
    if(id !== requestId) return;
    records = data.expenses;
    $('total').textContent = won(data.total); $('count').textContent = data.count + '건';
    const sorted = [...data.categories].sort((a,b) => b.amount-a.amount), top = sorted[0];
    $('top').textContent = top.amount ? top.category : '—'; $('top-amount').textContent = top.amount ? won(top.amount) + ' 사용했어요' : '아직 기록이 없어요';
    $('rows').replaceChildren(); $('empty').hidden = records.length > 0;
    for(const row of records) {
      const tr=node('tr'), title=node('td'); title.append(node('span',row.date,'date'),node('span',row.title));
      const category=node('td'); category.append(node('span',row.category,'tag'));
      const actions=node('td',undefined,'actions');
      const edit=node('button','수정'); edit.setAttribute('aria-label',row.title+' 수정'); edit.onclick=()=>openEditor(row);
      const del=node('button','삭제'); del.setAttribute('aria-label',row.title+' 삭제'); del.onclick=async()=>{ if(!confirm(`'${row.title}' 내역을 삭제할까요?`)) return; del.disabled=true; try{await api('/expenses/'+row.id,{method:'DELETE'});toast('내역을 삭제했어요.');await load();}catch(e){toast(e.message);del.disabled=false;} };
      actions.append(edit,del); tr.append(title,category,node('td',won(row.amount),'right'),actions); $('rows').append(tr);
    }
    $('chart').replaceChildren();
    for(const entry of sorted) {
      const item=node('div',undefined,'bar-item'),label=node('div',undefined,'bar-label');label.append(node('span',entry.category),node('span',won(entry.amount)));
      const track=node('div',undefined,'track'),fill=node('div',undefined,'fill'); fill.style.width=(top.amount ? entry.amount/top.amount*100 : 0)+'%';track.append(fill);item.append(label,track);$('chart').append(item);
    }
  } catch(e) { if(id === requestId){$('rows').replaceChildren();records=[];$('chart').replaceChildren();$('total').textContent='—';$('count').textContent='—';$('top').textContent='—';$('top-amount').textContent='';$('empty').hidden=false;$('empty').textContent=e.message;toast(e.message);} }
}
function openEditor(row) { editing=row?.id ?? null; $('expense-form').reset();$('editor-title').textContent=editing?'지출 수정하기':'지출 기록하기';$('expense-date').value=row?.date || today();$('title').value=row?.title || '';$('category').value=row?.category || categories[0];$('amount').value=row?.amount || '';$('form-error').textContent='';$('editor').showModal(); }
$('login-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;$('login-error').textContent='';try{await api('/login',{method:'POST',body:JSON.stringify({password:$('password').value})});$('password').value='';$('login-view').hidden=true;$('dashboard').hidden=false;await load();}catch(err){$('login-error').textContent=err.message;}finally{button.disabled=false;}};
$('logout').onclick=async()=>{try{await api('/logout',{method:'POST'});++requestId;records=[];showLogin();}catch(e){toast(e.message);}};
$('add').onclick=()=>openEditor();$('close').onclick=()=>$('editor').close();
$('expense-form').onsubmit=async e=>{e.preventDefault();$('save').disabled=true;$('form-error').textContent='';try{const body={date:$('expense-date').value,title:$('title').value.trim(),category:$('category').value,amount:Number($('amount').value)};await api('/expenses'+(editing?'/'+editing:''),{method:editing?'PUT':'POST',body:JSON.stringify(body)});$('month').value=body.date.slice(0,7);$('date-filter').value='';$('editor').close();toast('지출을 저장했어요.');await load();}catch(err){$('form-error').textContent=err.message;}finally{$('save').disabled=false;}};
$('month').onchange=()=>{if(!$('month').value)return;$('date-filter').value='';load();};
$('date-filter').onchange=()=>{if($('date-filter').value)$('month').value=$('date-filter').value.slice(0,7);load();};
$('clear').onclick=()=>{$('date-filter').value='';load();};
function moveMonth(delta){const [y,m]=$('month').value.split('-').map(Number);const date=new Date(y,m-1+delta,1);if(date.getFullYear()<1900||date.getFullYear()>9999)return;$('month').value=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;$('date-filter').value='';load();}
$('prev').onclick=()=>moveMonth(-1);$('next').onclick=()=>moveMonth(1);
(async()=>{try{await api('/session');$('login-view').hidden=true;$('dashboard').hidden=false;await load();}catch(e){if(!e.message.includes('로그인'))$('login-error').textContent=e.message;}})();
