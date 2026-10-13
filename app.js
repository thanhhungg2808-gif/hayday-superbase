/* ===== Tiện ích ===== */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => new Intl.NumberFormat('vi-VN').format(Math.round(n)) + 'đ';
const fdate = t => new Date(t).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});

/* Hiển thị ảnh nếu có, không thì dùng emoji */
const pic=(o,alt)=>o&&typeof o.img==='string'&&/^(data:image\/|https:\/\/)/.test(o.img)?`<img src="${esc(o.img)}" alt="${esc(alt||o.name||'')}">`:esc((o&&o.emoji)||'📦');

/* ===== Kết nối Supabase ===== */
const CFG=window.APP_CONFIG||{};
const configured=!!CFG.SUPABASE_URL&&!!CFG.SUPABASE_ANON_KEY&&!/YOUR-/i.test(CFG.SUPABASE_URL+CFG.SUPABASE_ANON_KEY);
const sb=configured&&window.supabase?window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY):null;
const emailOf=n=>String(n).trim().toLowerCase()+'@'+(CFG.EMAIL_DOMAIN||'hayday-shop.vn');
const friendly=e=>(e&&e.message)||'Có lỗi xảy ra, thử lại.';
const uid=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
function mapAuthError(e){
  const m=(e&&e.message)||'';
  if(/already registered|already exists/i.test(m))return 'Tên đăng nhập này đã tồn tại. Hãy chọn tên khác.';
  if(/at least|too short|weak/i.test(m))return 'Mật khẩu quá yếu hoặc quá ngắn (tối thiểu 6 ký tự).';
  if(/rate limit|too many/i.test(m))return 'Bạn thao tác quá nhanh. Hãy đợi một lúc rồi thử lại.';
  if(/Database error saving new user/i.test(m))return 'Không tạo được tài khoản. Tên đăng nhập có thể đã tồn tại hoặc không hợp lệ.';
  return m||'Không tạo được tài khoản.';
}

/* ===== Dữ liệu (bản sao tải từ server; server mới là nơi quyết định) ===== */
const CATS=['Tiền tệ','Công cụ','Nguyên liệu','Sản phẩm'];
const DEFAULT_NOTES='Vui lòng kiểm tra tin nhắn Zalo/Facebook và mục Chat với shop khi cửa hàng liên hệ với bạn.\nNhập đúng số Zalo hoặc link Facebook, ghi rõ tên nông trại hoặc ID Hay Day ở ô ghi chú để shop giao đúng người.\nTheo dõi tình trạng đơn tại Ví & đơn hàng: Đang xử lý, sau đó chuyển sang Thành công khi shop giao xong.';
const DISCOUNT_QTY=1000, DISCOUNT_PCT=10; // mua trên 1000 cái trong một đơn: giảm 10% tổng tiền
const MIN_ITEM=10, MIN_ORDER=100, STEP_QTY=10; // tối thiểu mỗi món / mỗi đơn / bước nhảy số lượng (10, 20, 30…)
let db={products:[],settings:{momo:'',momoName:'',notes:DEFAULT_NOTES,wheel:[],milestones:[20000,50000,100000],milestoneBy:'topup'},users:[],orders:[],topups:[],messages:[]};
let sess=null;
const me=()=>db.users.find(u=>u.id===sess)||null;
const isAdmin=()=>{const u=me();return !!u&&u.role==='admin'};

const must=async p=>{const {data,error}=await p;if(error)throw error;return data||[]};
const T=x=>x?new Date(x).getTime():0;

async function loadAll(){
  const {data:{session}}=await sb.auth.getSession();
  sess=session?session.user.id:null;
  const jobs=[
    must(sb.from('products').select('*').order('sort',{ascending:true}).order('created_at',{ascending:true})),
    must(sb.from('settings').select('key,value'))
  ];
  if(sess)jobs.push(
    must(sb.from('profiles').select('*')),
    must(sb.from('inventory').select('*')),
    must(sb.from('user_wheel').select('*')),
    must(sb.from('wheel_history').select('*').eq('user_id',sess).order('created_at',{ascending:false}).limit(30)),
    must(sb.from('orders').select('*').order('created_at',{ascending:false}).limit(500)),
    must(sb.from('topups').select('*').order('created_at',{ascending:false}).limit(500)),
    must(sb.from('messages').select('*').order('created_at',{ascending:true}).limit(3000))
  );
  const [prods,sets,profs=[],invs=[],wheels=[],hist=[],ords=[],tops=[],msgs=[]]=await Promise.all(jobs);

  db.products=prods.map(p=>({id:p.id,emoji:p.emoji,name:p.name,cat:p.cat,price:Number(p.price),stock:p.stock,desc:p.descr||'',img:p.img||''}));
  const st={};sets.forEach(x=>{st[x.key]=x.value});
  db.settings={
    momo:st.momo||'',momoName:st.momo_name||'',notes:st.notes||DEFAULT_NOTES,
    wheel:Array.isArray(st.wheel)?st.wheel:[],
    milestones:Array.isArray(st.milestones)&&st.milestones.length?st.milestones.map(Number):[20000,50000,100000],
    milestoneBy:st.milestone_by||'topup'
  };
  db.users=profs.map(p=>({id:p.id,username:p.username,role:p.role,balance:Number(p.balance),locked:p.locked,contact:p.contact||null,created:T(p.created_at),inv:{},wheel:{spins:0,claimed:[],used:0,history:[]}}));
  const byId={};db.users.forEach(u=>{byId[u.id]=u});
  invs.forEach(i=>{const u=byId[i.user_id];if(u)u.inv[i.product_id]={name:i.name,emoji:i.emoji,qty:i.qty}});
  wheels.forEach(w=>{const u=byId[w.user_id];if(u)u.wheel={spins:w.spins,claimed:Array.isArray(w.claimed)?w.claimed.map(Number):[],used:w.used,history:[]}});
  if(byId[sess])byId[sess].wheel.history=hist.map(h=>({time:T(h.created_at),id:h.product_id,name:h.name,emoji:h.emoji,qty:h.qty}));
  db.orders=ords.map(o=>({id:o.id,userId:o.user_id,username:o.username,items:o.items||[],sub:Number(o.subtotal),disc:Number(o.discount),total:Number(o.total),contact:o.contact||null,status:o.status,cancelBy:o.cancel_by,cancelReason:o.cancel_reason,time:T(o.created_at)}));
  db.topups=tops.map(t=>({id:t.id,userId:t.user_id,username:t.username,amount:Number(t.amount),note:t.content,code:t.code,status:t.status,time:T(t.created_at)}));
  db.messages=msgs.map(m=>({id:m.id,cid:m.cid,from:m.from_role,text:m.body,read:m.read,time:T(m.created_at)}));

  const u=me();
  if(sess&&(!u||u.locked)){          // phiên cũ của tài khoản đã bị khóa/xóa
    await sb.auth.signOut();
    sess=null;db.users=[];db.orders=[];db.topups=[];db.messages=[];
  }
  if(sess&&!rtChan)startRealtime();
  if(!sess)stopRealtime();
}
async function refresh(){await loadAll();render()}

/* ----- Cập nhật tức thì qua Supabase Realtime ----- */
let rtChan=null,rtTimer=null;
function startRealtime(){
  stopRealtime();
  if(!sb||!sess)return;
  rtChan=sb.channel('shop-'+sess);
  ['messages','orders','topups','profiles','inventory','user_wheel','products','settings'].forEach(t=>{
    rtChan.on('postgres_changes',{event:'*',schema:'public',table:t},scheduleRefresh);
  });
  rtChan.subscribe();
}
function stopRealtime(){if(rtChan&&sb){sb.removeChannel(rtChan)}rtChan=null}
function scheduleRefresh(){clearTimeout(rtTimer);rtTimer=setTimeout(softRefresh,600)}
async function softRefresh(){
  if(ui.spinning||document.querySelector('#mf')){rtTimer=setTimeout(softRefresh,2000);return}
  const ci=$('#chatin'),v=ci?ci.value:'';
  try{await loadAll();render()}catch(e){return}
  const n=$('#chatin');if(n&&v){n.value=v;n.focus()}
}

async function init(){
  if(!sb){
    $('#hdr').innerHTML='<div class="logo"><span class="badge">🌾</span>Kho Làng Hay Day</div>';
    $('#app').innerHTML='<section class="panel"><h2>Chưa cấu hình Supabase</h2><p>Mở file <b>config.js</b> và điền <b>SUPABASE_URL</b> cùng <b>SUPABASE_ANON_KEY</b> (Supabase → Project Settings → API). Xem hướng dẫn trong README.md.</p></section>';
    return;
  }
  $('#app').innerHTML='<div class="empty"><b>⏳</b>Đang tải dữ liệu…</div>';
  try{await loadAll()}
  catch(e){
    $('#app').innerHTML='<section class="panel"><h2>Không tải được dữ liệu</h2><p>'+esc(friendly(e))+'</p><p class="stock">Kiểm tra: đã chạy supabase/schema.sql chưa, URL và anon key trong config.js có đúng không.</p><button class="btn" onclick="location.reload()">Thử lại</button></section>';
    return;
  }
  sb.auth.onAuthStateChange(ev=>{
    if(ev==='SIGNED_OUT'&&sess){sess=null;stopRealtime();db.users=[];db.orders=[];db.topups=[];db.messages=[];ui.view='shop';render()}
  });
  render();
}

/* ===== Trạng thái giao diện ===== */
const ui={view:'shop',tab:'products',cat:'Tất cả',q:'',sort:'default',cart:{}};

/* ===== Hiển thị ===== */
function renderHeader(){
  const u=me();
  const nav=[['shop','Cửa hàng']];
  if(u){nav.push(['inv','Kho của tôi'],['spin','Vòng quay'],['wallet','Ví & đơn hàng']);if(u.role!=='admin')nav.push(['chat','Chat với shop']);}
  if(u&&u.role==='admin')nav.push(['admin','Quản trị']);
  $('#hdr').innerHTML=`
    <div class="logo"><span class="badge">🌾</span>Kho Làng Hay Day</div>
    <nav class="nav">${nav.map(([k,l])=>`<button class="${ui.view===k?'on':''}" data-act="nav" data-id="${k}">${l}${navDot(k,u)}</button>`).join('')}</nav>
    <div class="who">
      ${u?`<button class="btn sun sm" data-act="cart">🛒 Giỏ hàng (${cartCount()})</button><span class="coin">💰 ${fmt(u.balance)}</span><span>Chào, <b>${esc(u.username)}</b></span><button class="btn sun sm" data-act="logout">Đăng xuất</button>`
         :`<button class="btn ghost sm" data-act="login">Đăng nhập</button><button class="btn sun sm" data-act="register">Tạo tài khoản</button>`}
    </div>`;
}

function render(){
  const u0=me();
  if(u0&&u0.role!=='admin'&&ui.view==='chat')markRead('user',u0.id);
  if(u0&&u0.role==='admin'&&ui.view==='admin'&&ui.tab==='chat'){ensureChatUid();if(ui.chatUid)markRead('admin',ui.chatUid)}
  renderHeader();
  const u=me();
  if((ui.view==='inv'||ui.view==='wallet'||ui.view==='chat'||ui.view==='spin')&&!u)ui.view='shop';
  if(ui.view==='chat'&&u&&u.role==='admin')ui.view='admin';
  if(ui.view==='admin'&&!isAdmin())ui.view='shop';
  const fn={shop:vShop,inv:vInv,wallet:vWallet,admin:vAdmin,chat:vChat,spin:vSpin}[ui.view];
  $('#app').innerHTML=fn()+`<div class="foot">Bản demo lưu dữ liệu ngay trong trình duyệt này. Không liên kết với Supercell.</div>`;
  const cl=$('#chatlog');if(cl)cl.scrollTop=cl.scrollHeight;
}

function vShop(){
  let list=db.products.filter(p=>(ui.cat==='Tất cả'||p.cat===ui.cat)&&p.name.toLowerCase().includes(ui.q.toLowerCase()));
  if(ui.sort==='asc')list=[...list].sort((a,b)=>a.price-b.price);
  if(ui.sort==='desc')list=[...list].sort((a,b)=>b.price-a.price);
  const u=me();
  return `
  <div class="hero"><div><h1>Vật phẩm Hay Day, giá rõ ràng</h1>
  <p>Mua theo bội số của ${STEP_QTY} (10, 20, 30…), tối thiểu ${MIN_ITEM} cái mỗi món, mỗi đơn từ ${MIN_ORDER} cái. Thêm món vào giỏ, đặt hàng, vật phẩm vào kho ngay.</p></div>
  ${u?'':`<button class="btn sun" data-act="register">Tạo tài khoản để mua</button>`}</div>
  <div class="notebox"><b>Lưu ý khi mua</b>${notesHtml()}</div>
  <div class="promo">🎉 Mua trên ${DISCOUNT_QTY} cái trong một đơn: giảm ${DISCOUNT_PCT}% tổng tiền.</div>
  <div class="promo">🎁 Tổng tiền ${metricLabel()} đạt ${mileText()}: nhận thêm 1 lượt quay vòng quay may mắn.</div>
  <div class="tools">
    <input id="q" type="search" placeholder="Tìm vật phẩm…" value="${esc(ui.q)}" aria-label="Tìm vật phẩm">
    <select id="sort" aria-label="Sắp xếp">
      <option value="default" ${ui.sort==='default'?'selected':''}>Mặc định</option>
      <option value="asc" ${ui.sort==='asc'?'selected':''}>Giá thấp đến cao</option>
      <option value="desc" ${ui.sort==='desc'?'selected':''}>Giá cao đến thấp</option>
    </select>
  </div>
  <div class="chips">${['Tất cả',...CATS].map(c=>`<button class="chip ${ui.cat===c?'on':''}" data-act="cat" data-id="${c}">${c}</button>`).join('')}</div>
  ${list.length?`<div class="grid">${list.map(p=>`
    <article class="item">
      <div class="crate"><span class="tag">${esc(p.cat)}</span>${pic(p)}</div>
      <div class="body">
        <h3>${esc(p.name)}</h3>
        <div class="desc">${esc(p.desc)}</div>
        <div class="row"><span class="price">${fmt(p.price)}</span><span class="stock ${p.stock<=5?'low':''}">${p.stock>0?'Còn '+p.stock:'Hết hàng'}</span></div>
        <button class="btn" data-act="buy" data-id="${p.id}" ${p.stock<MIN_ITEM?'disabled':''}>${p.stock<1?'Hết hàng':p.stock<MIN_ITEM?'Còn dưới mức tối thiểu':'Thêm vào giỏ'}</button>
      </div></article>`).join('')}</div>`
  :`<div class="empty"><b>🔍</b>Không có vật phẩm nào khớp. Thử bỏ bộ lọc hoặc đổi từ khóa.</div>`}`;
}

function vInv(){
  const u=me();
  const items=Object.entries(u.inv).filter(([,v])=>v.qty>0);
  const total=items.reduce((s,[,v])=>s+v.qty,0);
  return `
  <div class="hero"><div><h1>Kho của tôi</h1><p>Vật phẩm bạn đã mua. Shop sẽ gửi vào game theo thông tin bạn cung cấp.</p></div></div>
  <div class="stats">
    <div class="stat"><b>${items.length}</b><small>Loại vật phẩm</small></div>
    <div class="stat"><b>${fmt(u.balance)}</b><small>Số dư ví</small></div>
    <div class="stat"><b>${total}</b><small>Tổng số lượng</small></div>
  </div>
  <section class="panel">${items.length?`<div class="inv-grid">${items.map(([id,v])=>`
    <div class="slot"><span class="q">×${v.qty}</span><div class="e">${pic({...v,img:(db.products.find(x=>x.id===id)||{}).img})}</div><div class="n">${esc(v.name)}</div></div>`).join('')}</div>`
  :`<div class="empty"><b>📦</b>Kho đang trống. Ghé cửa hàng để mua vật phẩm đầu tiên.<br><br><button class="btn" data-act="nav" data-id="shop">Đến cửa hàng</button></div>`}</section>`;
}

function vWallet(){
  const u=me();
  const mine=db.topups.filter(t=>t.userId===u.id).sort((a,b)=>b.time-a.time);
  const ords=db.orders.filter(o=>o.userId===u.id).sort((a,b)=>b.time-a.time);
  const st={pending:['Chờ duyệt','warn'],approved:['Đã cộng','' ],rejected:['Từ chối','bad']};
  return `
  <div class="hero"><div><h1>Ví & đơn hàng</h1><p>Nạp tiền vào ví để mua vật phẩm.</p></div>
  <button class="btn sun" data-act="topup">Nạp tiền vào ví</button></div>
  <div class="stats"><div class="stat"><b>${fmt(u.balance)}</b><small>Số dư hiện tại</small></div>
  <div class="stat"><b>${ords.filter(o=>o.status!=='cancelled').length}</b><small>Đơn đã mua</small></div></div>
  <section class="panel"><h2>Yêu cầu nạp tiền</h2>
  ${mine.length?`<div class="scroll"><table class="tbl"><tr><th>Thời gian</th><th>Số tiền</th><th>Nội dung chuyển khoản</th><th>Trạng thái</th></tr>
  ${mine.map(t=>`<tr><td>${fdate(t.time)}</td><td>${fmt(t.amount)}</td><td>${esc(t.note||'—')}</td><td><span class="pill ${st[t.status][1]}">${st[t.status][0]}</span></td></tr>`).join('')}</table></div>`
  :`<div class="empty">Chưa có yêu cầu nạp tiền nào.</div>`}</section>
  <section class="panel"><h2>Lịch sử mua hàng</h2>
  ${ords.length?`<div class="scroll"><table class="tbl"><tr><th>Thời gian</th><th>Vật phẩm</th><th>Tổng</th><th>Nhận hàng qua</th><th>Trạng thái</th><th></th></tr>
  ${ords.map(o=>`<tr><td>${fdate(o.time)}</td><td>${o.items.map(i=>`${esc(i.name)} ×${i.qty}`).join(', ')}</td><td>${totalHtml(o)}</td><td>${contactHtml(o.contact)}</td><td>${statusHtml(o)}</td><td>${isOpen(o)?`<button class="btn sm danger" data-act="ocancel" data-id="${o.id}">Hủy đơn</button>`:''}</td></tr>`).join('')}</table></div>`
  :`<div class="empty">Chưa có đơn hàng nào.</div>`}</section>`;
}

function vAdmin(){
  const pend=db.topups.filter(t=>t.status==='pending').length;
  const rev=db.orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+o.total,0);
  const tabs=[['products','Vật phẩm'],['users','Tài khoản'],['topups','Nạp tiền'],['orders','Đơn hàng'],['chat','Tin nhắn'],['wheel','Vòng quay'],['settings','Cài đặt']];
  let body='';
  if(ui.tab==='products')body=`
    <section class="panel"><div class="row wrap-r"><h2>Quản lý vật phẩm</h2><button class="btn" data-act="padd">+ Thêm vật phẩm</button></div>
    <div class="scroll"><table class="tbl"><tr><th></th><th>Tên</th><th>Loại</th><th>Giá</th><th>Tồn kho</th><th></th></tr>
    ${db.products.map(p=>`<tr><td style="font-size:26px">${p.img?`<img class="thumb" src="${esc(p.img)}" alt="">`:esc(p.emoji)}</td><td>${esc(p.name)}</td><td>${esc(p.cat)}</td><td>${fmt(p.price)}</td>
    <td>${p.stock<1?'<span class="pill bad">Hết</span>':p.stock}</td>
    <td><div class="acts"><button class="btn sm sun" data-act="pedit" data-id="${p.id}">Sửa</button><button class="btn sm danger" data-act="pdel" data-id="${p.id}">Xóa</button></div></td></tr>`).join('')}</table></div></section>`;
  if(ui.tab==='users')body=`
    <section class="panel"><div class="row wrap-r"><h2>Quản lý tài khoản</h2><button class="btn" data-act="uadd">+ Tạo tài khoản</button></div>
    <div class="scroll"><table class="tbl"><tr><th>Tên đăng nhập</th><th>Vai trò</th><th>Số dư</th><th>Vật phẩm</th><th>Trạng thái</th><th></th></tr>
    ${db.users.map(u=>`<tr><td><b>${esc(u.username)}</b></td><td>${u.role==='admin'?'Quản trị':'Khách'}</td><td>${fmt(u.balance)}</td>
    <td>${Object.values(u.inv).reduce((s,v)=>s+v.qty,0)}</td>
    <td>${u.locked?'<span class="pill bad">Đã khóa</span>':'<span class="pill">Hoạt động</span>'}</td>
    <td><div class="acts">${u.role!=='admin'?`<button class="btn sm ghost" data-act="chatwith" data-id="${u.id}">Chat</button>`:''}<button class="btn sm sun" data-act="uedit" data-id="${u.id}">Sửa</button>${u.id!==sess?`<button class="btn sm danger" data-act="udel" data-id="${u.id}">Xóa</button>`:''}</div></td></tr>`).join('')}</table></div></section>`;
  if(ui.tab==='topups'){
    const l=[...db.topups].sort((a,b)=>b.time-a.time);
    body=`<section class="panel"><h2>Yêu cầu nạp tiền</h2>
    ${l.length?`<div class="scroll"><table class="tbl"><tr><th>Thời gian</th><th>Tài khoản</th><th>Số tiền</th><th>Nội dung chuyển khoản</th><th></th></tr>
    ${l.map(t=>`<tr><td>${fdate(t.time)}</td><td>${esc(t.username)}</td><td>${fmt(t.amount)}</td><td>${esc(t.note||'—')}</td>
    <td>${t.status==='pending'?`<div class="acts"><button class="btn sm" data-act="tok" data-id="${t.id}">Duyệt</button><button class="btn sm danger" data-act="tno" data-id="${t.id}">Từ chối</button></div>`
      :`<span class="pill ${t.status==='approved'?'':'bad'}">${t.status==='approved'?'Đã cộng':'Từ chối'}</span>`}</td></tr>`).join('')}</table></div>`
    :`<div class="empty">Chưa có yêu cầu nạp tiền.</div>`}</section>`;
  }
  if(ui.tab==='orders'){
    const l=[...db.orders].sort((a,b)=>b.time-a.time);
    body=`<section class="panel"><h2>Đơn hàng</h2>
    ${l.length?`<div class="scroll"><table class="tbl"><tr><th>Thời gian</th><th>Tài khoản</th><th>Vật phẩm</th><th>Tổng</th><th>Nhận hàng qua</th><th>Trạng thái</th><th></th></tr>
    ${l.map(o=>`<tr><td>${fdate(o.time)}</td><td>${esc(o.username)}</td><td>${o.items.map(i=>`${esc(i.name)} ×${i.qty}`).join(', ')}</td><td>${totalHtml(o)}</td><td>${contactHtml(o.contact)}${o.contact&&o.contact.note?`<br><small>Ghi chú: ${esc(o.contact.note)}</small>`:''}</td><td>${statusHtml(o)}</td><td><div class="acts">${o.status==='cancelled'?'':`<button class="btn sm" data-act="ostat" data-id="${o.id}">${o.status==='done'?'Về đang xử lý':'Đánh dấu thành công'}</button>`}${isOpen(o)?`<button class="btn sm danger" data-act="ocancel" data-id="${o.id}">Hủy đơn</button>`:''}<button class="btn sm sun" data-act="chatwith" data-id="${o.userId}">Chat</button></div></td></tr>`).join('')}</table></div>`
    :`<div class="empty">Chưa có đơn hàng.</div>`}</section>`;
  }
  if(ui.tab==='chat')body=adminChat();
  if(ui.tab==='wheel')body=adminWheel();
  if(ui.tab==='settings')body=`
    <section class="panel"><h2>Nạp tiền qua MoMo</h2>
    <p class="stock">Số MoMo này hiện cho khách khi họ bấm “Nạp tiền vào ví”.</p>
    <div class="two"><div class="f"><label for="mno">Số điện thoại MoMo</label><input id="mno" inputmode="numeric" value="${esc(db.settings.momo)}"></div>
    <div class="f"><label for="mnm">Tên chủ tài khoản (tùy chọn)</label><input id="mnm" value="${esc(db.settings.momoName||'')}"></div></div>
    <button class="btn" data-act="bank">Lưu thông tin</button>
    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <h2>Lưu ý khi mua</h2>
    <p class="stock">Mỗi dòng là một lưu ý. Hiện cho khách ở trang Cửa hàng và trong giỏ hàng khi đặt đơn.</p>
    <div class="f"><textarea id="notes" rows="6" maxlength="1500">${esc(db.settings.notes||DEFAULT_NOTES)}</textarea></div>
    <button class="btn" data-act="notes">Lưu lưu ý</button>
    </section>`;
  return `
  <div class="hero"><div><h1>Quản trị</h1></div></div>
  <div class="stats">
    <div class="stat"><b>${fmt(rev)}</b><small>Doanh thu</small></div>
    <div class="stat"><b>${db.users.length}</b><small>Tài khoản</small></div>
    <div class="stat"><b>${db.products.length}</b><small>Vật phẩm</small></div>
    <div class="stat"><b>${pend}</b><small>Nạp tiền chờ duyệt</small></div>
    <div class="stat"><b>${db.orders.filter(o=>isOpen(o)).length}</b><small>Đơn đang xử lý</small></div>
  </div>
  <div class="tabs">${tabs.map(([k,l])=>`<button class="${ui.tab===k?'on':''}" data-act="tab" data-id="${k}">${l}${k==='topups'&&pend?`<span class="dot">${pend}</span>`:''}${k==='chat'&&unreadFor('admin')?`<span class="dot">${unreadFor('admin')}</span>`:''}${k==='orders'&&db.orders.some(o=>isOpen(o))?`<span class="dot">${db.orders.filter(o=>isOpen(o)).length}</span>`:''}</button>`).join('')}</div>
  ${body}`;
}

/* ===== Modal & toast ===== */
function toast(t){
  const el=document.createElement('div');el.className='toast';el.textContent=t;el.setAttribute('role','status');
  document.body.appendChild(el);setTimeout(()=>el.remove(),2600);
}
function closeModal(){$('#layer').innerHTML=''}
function modal(title,html,onSubmit,okText='Lưu'){
  /* Không dùng nút submit thật: trang chạy trong khung sandbox của claude.ai nên trình duyệt chặn gửi form. */
  $('#layer').innerHTML=`<div class="ov" data-act="ovclose"><form class="box" id="mf" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <h2>${esc(title)}</h2><div id="merr"></div>${html}
    <div class="mf"><button type="button" class="btn ghost" data-act="close">Hủy</button>${okText?`<button type="button" class="btn" id="msub">${okText}</button>`:''}</div></form></div>`;
  const f=$('#mf');
  let busy=false;
  const run=async()=>{
    if(busy||!okText)return;
    if(!f.reportValidity())return;
    busy=true;
    try{
      const r=await onSubmit(new FormData(f),f);
      if(typeof r==='string'){const m=$('#merr');if(m){m.innerHTML=`<div class="err">${esc(r)}</div>`;m.scrollIntoView({block:'nearest'})}}
    }catch(err){
      const m=$('#merr');if(m)m.innerHTML=`<div class="err">Có lỗi xảy ra, thử lại.</div>`;
    }
    busy=false;
  };
  f.addEventListener('submit',e=>e.preventDefault());
  f.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA'&&e.target.tagName!=='BUTTON'&&e.target.type!=='file'){e.preventDefault();run()}
  });
  const sb=$('#msub');if(sb)sb.addEventListener('click',run);
  const first=f.querySelector('input,select,textarea');if(first)first.focus();
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});

/* ===== Đăng ký / đăng nhập ===== */
function openRegister(){
  modal('Tạo tài khoản',`
    <div class="f"><label for="un">Tên đăng nhập</label><input id="un" name="un" autocomplete="username" required><small>3–20 ký tự: chữ không dấu, số, dấu gạch dưới.</small></div>
    <div class="f"><label for="pw">Mật khẩu</label><input id="pw" name="pw" type="password" autocomplete="new-password" required><small>Tối thiểu 6 ký tự.</small></div>
    <div class="f"><label for="pw2">Nhập lại mật khẩu</label><input id="pw2" name="pw2" type="password" autocomplete="new-password" required></div>`,
  async fd=>{
    const un=fd.get('un').trim(),pw=fd.get('pw');
    if(!/^[A-Za-z0-9_]{3,20}$/.test(un))return 'Tên đăng nhập phải 3–20 ký tự, chỉ gồm chữ không dấu, số và dấu gạch dưới.';
    if(pw.length<6)return 'Mật khẩu cần ít nhất 6 ký tự.';
    if(pw!==fd.get('pw2'))return 'Hai mật khẩu chưa khớp.';
    const av=await sb.rpc('username_available',{p_username:un});
    if(av.error)return friendly(av.error);
    if(!av.data)return 'Tên đăng nhập này đã có người dùng. Hãy chọn tên khác.';
    const {data,error}=await sb.auth.signUp({email:emailOf(un),password:pw,options:{data:{username:un}}});
    if(error)return mapAuthError(error);
    if(!data.session)return 'Đã tạo tài khoản nhưng Supabase đang yêu cầu xác nhận email. Hãy tắt "Confirm email" trong Authentication → Providers → Email (xem README).';
    closeModal();ui.view='shop';await refresh();toast('Đã tạo tài khoản. Chào '+un+'!');
  },'Tạo tài khoản');
}

function openLogin(){
  modal('Đăng nhập',`
    <div class="f"><label for="un">Tên đăng nhập</label><input id="un" name="un" autocomplete="username" required></div>
    <div class="f"><label for="pw">Mật khẩu</label><input id="pw" name="pw" type="password" autocomplete="current-password" required></div>`,
  async fd=>{
    const {error}=await sb.auth.signInWithPassword({email:emailOf(fd.get('un')),password:fd.get('pw')});
    if(error)return 'Sai tên đăng nhập hoặc mật khẩu.';
    await loadAll();
    if(!sess)return 'Tài khoản này đã bị khóa hoặc không còn tồn tại. Liên hệ quản trị viên.';
    closeModal();ui.view='shop';render();toast('Đăng nhập thành công.');
  },'Đăng nhập');
}

/* ===== Hủy đơn hàng ===== */
function openCancel(id){
  const o=db.orders.find(x=>x.id===id);if(!o)return;
  const u=me();if(!u)return;
  const by=(isAdmin()&&ui.view==='admin')?'admin':'user';
  if(by==='user'&&o.userId!==u.id)return;
  if(!isOpen(o)){toast('Đơn này đã hoàn tất hoặc đã hủy, không thể hủy nữa.');return}
  const sum=o.items.map(i=>esc(i.name)+' ×'+i.qty).join(', ');
  modal('Hủy đơn hàng',`
    <p>${by==='admin'?'Hủy đơn của <b>'+esc(o.username)+'</b>':'Bạn muốn hủy đơn này?'}</p>
    <div class="note">${sum}<br>Tổng tiền: <b>${fmt(o.total)}</b></div>
    <div class="f"><label for="rs">Lý do (tùy chọn)</label><input id="rs" name="reason" maxlength="160"></div>
    <small class="stock">Khi hủy: ${fmt(o.total)} được hoàn vào ví ${by==='admin'?'của khách':'của bạn'}, vật phẩm của đơn bị thu hồi khỏi kho và tồn kho shop được cộng lại. Việc hủy không hoàn tác được.</small>`,
  async fd=>{
    const {error}=await sb.rpc('cancel_order',{p_order:id,p_reason:fd.get('reason').trim()});
    if(error)return friendly(error);
    closeModal();await refresh();toast('Đã hủy đơn, hoàn '+fmt(o.total)+' vào ví.');
  },'Hủy đơn');
}

/* ===== Điểm danh & vòng quay ===== */
const DEF_QTY=50, MAX_PRIZES=12;
const dayKey=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const todayKey=()=>dayKey(new Date());
const yesterdayKey=()=>{const d=new Date();d.setDate(d.getDate()-1);return dayKey(d)};
const fmtPct=n=>String(Math.round(n*10)/10).replace('.',',');
function randInt(a,b){
  try{const r=new Uint32Array(1);crypto.getRandomValues(r);return a+r[0]%(b-a+1)}
  catch(e){return a+Math.floor(Math.random()*(b-a+1))}
}
const wheelCfg=()=>db.settings.wheel;
function rewardItem(x){
  const p=db.products.find(y=>y.id===x.pid);
  return {id:x.pid,name:p?p.name:x.name,emoji:p?p.emoji:x.emoji};
}
function wheelBg(n){
  const pal=['var(--sun)','var(--grass-t)','var(--tile)','var(--barn-t)'];
  const cols=Array.from({length:n},(_,i)=>pal[i%pal.length]);
  if(n>1&&cols[n-1]===cols[0])cols[n-1]=pal.find(c=>c!==cols[0]&&c!==cols[n-2]);
  const S=360/n;
  return 'conic-gradient('+cols.map((c,i)=>c+' '+(i*S)+'deg '+((i+1)*S)+'deg').join(',')+')';
}
/* Lượt quay nhận theo mốc tiền, không có lượt quay miễn phí mỗi ngày */
const metricLabel=()=>db.settings.milestoneBy==='spent'?'mua hàng':'nạp';
const mileText=()=>db.settings.milestones.map(fmt).join(', ');
function wheelState(u){
  if(!u.wheel){
    const hs=(u.checkin&&u.checkin.history)||[];
    u.wheel={spins:0,claimed:[],used:hs.length,history:hs};
  }
  const w=u.wheel;
  if(!Array.isArray(w.claimed))w.claimed=[];
  if(!Array.isArray(w.history))w.history=[];
  w.spins=w.spins||0;w.used=w.used||0;
  return w;
}
function milestoneValue(u){
  return db.settings.milestoneBy==='spent'
    ? db.orders.filter(o=>o.userId===u.id&&o.status!=='cancelled').reduce((a,o)=>a+o.total,0)
    : db.topups.filter(t=>t.userId===u.id&&t.status==='approved').reduce((a,t)=>a+t.amount,0);
}
function vSpin(){
  const u=me(),w=wheelState(u);
  const cfg=wheelCfg(),N=cfg.length,S=360/N,tot=cfg.reduce((t,x)=>t+x.pct,0);
  const val=milestoneValue(u),ms=[...db.settings.milestones].sort((x,y)=>x-y),next=ms.find(m=>val<m);
  const h=w.history,last=h[0];
  const fs=N>8?24:32;
  const prev=ms.filter(m=>m<=val).pop()||0;
  const pctBar=next?Math.max(0,Math.min(100,(val-prev)/(next-prev)*100)):100;
  return `
  <div class="hero"><div><h1>Vòng quay may mắn</h1>
  <p>Mỗi khi tổng tiền ${metricLabel()} của bạn đạt một mốc, bạn nhận thêm 1 lượt quay. Quà vào thẳng kho của bạn.</p></div></div>
  <div class="stats">
    <div class="stat"><b>${w.spins}</b><small>Lượt quay còn lại</small></div>
    <div class="stat"><b>${fmt(val)}</b><small>Tổng tiền đã ${metricLabel()}</small></div>
    <div class="stat"><b>${w.used}</b><small>Lượt đã quay</small></div>
  </div>
  <section class="panel"><h2>Mốc nhận lượt quay</h2>
    <div class="acts" style="margin-bottom:8px">${ms.map(m=>val>=m?`<span class="pill">✔ ${fmt(m)}</span>`:`<span class="pill warn">${fmt(m)}</span>`).join('')}</div>
    ${next?`<div class="bar" role="progressbar" aria-valuenow="${Math.round(pctBar)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pctBar}%"></span></div>
    <p class="stock" style="margin:0">Còn <b>${fmt(next-val)}</b> nữa để đạt mốc ${fmt(next)} và nhận thêm 1 lượt quay.</p>`
    :`<p class="stock" style="margin:0">Bạn đã đạt tất cả các mốc hiện có.</p>`}
  </section>
  <section class="panel spinbox">
    <div class="wheelwrap"><div class="pointer" aria-hidden="true">▼</div>
      <div class="wheel" id="wheel" style="background:${wheelBg(N)};transform:rotate(${ui.wheelAngle||0}deg)" role="img" aria-label="Vòng quay gồm ${cfg.map(x=>esc(rewardItem(x).name)).join(', ')}">
        ${cfg.map((x,i)=>`<span class="wl" style="font-size:${fs}px;transform:rotate(${i*S+S/2}deg) translateY(-90px)">${esc(rewardItem(x).emoji)}</span>`).join('')}
      </div></div>
    <button class="btn sun big" data-act="spin" ${w.spins<1||ui.spinning?'disabled':''}>${ui.spinning?'Đang quay…':w.spins>0?'Quay ngay (còn '+w.spins+' lượt)':'Chưa có lượt quay'}</button>
    ${last&&!ui.spinning?`<div class="gotit">Lần quay gần nhất: ${last.qty} × ${esc(last.name)} ${esc(last.emoji)}</div>`:''}
  </section>
  <section class="panel"><h2>Tỉ lệ trúng thưởng</h2>
  <div class="scroll"><table class="tbl"><tr><th>Phần thưởng</th><th>Tỉ lệ</th><th>Số lượng</th></tr>
  ${cfg.map(x=>{const it=rewardItem(x);return `<tr><td>${esc(it.emoji)} ${esc(it.name)}</td><td>${fmtPct(x.pct/tot*100)}%</td><td>${x.qty}</td></tr>`}).join('')}</table></div></section>
  <section class="panel"><h2>Quà đã nhận</h2>
  ${h.length?`<div class="scroll"><table class="tbl"><tr><th>Thời gian</th><th>Vật phẩm</th><th>Số lượng</th></tr>
  ${h.slice(0,10).map(x=>`<tr><td>${fdate(x.time)}</td><td>${esc(x.emoji)} ${esc(x.name)}</td><td>${x.qty}</td></tr>`).join('')}</table></div>`
  :`<div class="empty"><b>🎁</b>Bạn chưa nhận quà nào. Đạt mốc ${fmt(ms[0]||0)} để có lượt quay đầu tiên.</div>`}</section>`;
}
async function doSpin(){
  const u=me();if(!u||ui.spinning)return;
  const w=wheelState(u);
  if(w.spins<1){toast('Bạn chưa có lượt quay. Đạt mốc '+metricLabel()+' '+mileText()+' để nhận thêm.');return}
  ui.spinning=true;
  const btn=document.querySelector('[data-act="spin"]');if(btn){btn.disabled=true;btn.textContent='Đang quay…'}
  const {data,error}=await sb.rpc('spin_wheel');          // server chọn phần thưởng và cộng quà vào kho
  if(error){ui.spinning=false;toast(friendly(error));render();return}
  if(data.n!==wheelCfg().length){await loadAll();render()}   // admin vừa đổi vòng quay: tải lại cho khớp
  const cfg=wheelCfg(),N=cfg.length,S=360/N;
  const k=Math.min(Math.max(data.index,0),N-1);
  const jit=randInt(-100,100)/100*(S/2-3);
  const cur0=((ui.wheelAngle||0)%360+360)%360;
  const want=(((360-(k*S+S/2+jit))%360)+360)%360;
  const newA=(ui.wheelAngle||0)+360*5+((want-cur0+360)%360);
  ui.wheelAngle=newA;
  const reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el=$('#wheel');
  if(el){el.style.transition=reduce?'none':'transform 4.2s cubic-bezier(.12,.6,.1,1)';el.style.transform='rotate('+newA+'deg)'}
  const b2=document.querySelector('[data-act="spin"]');if(b2){b2.disabled=true;b2.textContent='Đang quay…'}
  setTimeout(async()=>{
    ui.spinning=false;
    try{await loadAll()}catch(e){}
    render();toast('🎉 Bạn nhận được '+data.qty+' × '+data.name);
  },reduce?50:4400);
}

/* ----- Admin: quản lý vòng quay ----- */
function adminWheel(){return adminPrizes()+adminMilestones()}
function adminMilestones(){
  const by=db.settings.milestoneBy;
  return `<section class="panel"><h2>Mốc nhận lượt quay</h2>
  <p class="stock">Khi tổng tiền của khách đạt mỗi mốc, khách nhận thêm 1 lượt quay (mỗi mốc một lần). Không có lượt quay miễn phí hằng ngày. Lượt đã tặng không bị thu hồi nếu đơn hàng bị hủy sau đó.</p>
  <div class="two"><div class="f"><label for="mby">Tính mốc theo</label><select id="mby"><option value="topup" ${by==='topup'?'selected':''}>Tổng tiền đã nạp</option><option value="spent" ${by==='spent'?'selected':''}>Tổng tiền đã mua</option></select></div>
  <div class="f"><label for="mls">Các mốc (đ), cách nhau bằng dấu phẩy</label><input id="mls" value="${esc(db.settings.milestones.join(', '))}"></div></div>
  <button class="btn" data-act="msave">Lưu mốc</button></section>`;
}
async function saveMilestones(){
  const by=$('#mby').value==='spent'?'spent':'topup';
  const nums=$('#mls').value.split(/[,;]+/).map(x=>x.replace(/[.\s]/g,'')).filter(Boolean).map(Number);
  if(!nums.length||nums.some(n=>!Number.isInteger(n)||n<1||n>1000000000)){toast('Các mốc phải là số nguyên dương, cách nhau bằng dấu phẩy.');return}
  const uniq=[...new Set(nums)].sort((x,y)=>x-y);
  if(uniq.length>20){toast('Tối đa 20 mốc.');return}
  const e=await saveSettings([{key:'milestones',value:uniq},{key:'milestone_by',value:by}]);
  if(e){toast(e);return}
  const r=await sb.rpc('admin_regrant_milestones');
  await refresh();
  const g=r.data||0;
  toast('Đã lưu mốc.'+(g?' Đã tặng '+g+' lượt quay cho khách đã đạt mốc.':''));
}

function adminPrizes(){
  const w=wheelCfg(),tot=w.reduce((a,x)=>a+x.pct,0),ok=Math.abs(tot-100)<0.05;
  return `<section class="panel"><div class="row wrap-r"><h2>Vòng quay điểm danh</h2>
    <div class="acts"><button class="btn sm ghost" data-act="weven">Chia đều tỉ lệ</button><button class="btn" data-act="wadd">+ Thêm phần thưởng</button></div></div>
  <p class="stock">Mỗi phần thưởng là một ô trên vòng quay (tối đa ${MAX_PRIZES} ô). Mỗi lượt quay trúng ngẫu nhiên một phần thưởng theo tỉ lệ bạn đặt.</p>
  <div class="scroll"><table class="tbl"><tr><th></th><th>Phần thưởng</th><th>Tỉ lệ</th><th>Số lượng</th><th></th></tr>
  ${w.map(x=>{const it=rewardItem(x);return `<tr><td style="font-size:26px">${esc(it.emoji)}</td><td>${esc(it.name)}${db.products.some(p=>p.id===x.pid)?'':' <span class="pill bad">Đã xóa khỏi shop</span>'}</td>
    <td>${fmtPct(x.pct)}%</td><td>${x.qty}</td>
    <td><div class="acts"><button class="btn sm sun" data-act="wedit" data-id="${x.id}">Sửa</button><button class="btn sm danger" data-act="wdel" data-id="${x.id}">Xóa</button></div></td></tr>`}).join('')}</table></div>
  <div class="${ok?'note':'err'}" style="margin:12px 0 0">Tổng tỉ lệ: <b>${fmtPct(tot)}%</b> ${ok?'(đủ 100%)':'. Chưa bằng 100%, hệ thống sẽ tự quy đổi theo tỉ lệ giữa các phần thưởng. Khách xem được tỉ lệ đã quy đổi.'}</div></section>`;
}
function wheelForm(x){
  x=x||{pid:db.products[0]?db.products[0].id:'',pct:10,qty:DEF_QTY};
  return `<div class="f"><label for="wp">Vật phẩm thưởng</label><select id="wp" name="pid">${db.products.map(p=>`<option value="${p.id}" ${p.id===x.pid?'selected':''}>${esc(p.emoji)} ${esc(p.name)}</option>`).join('')}</select><small>Chọn từ danh sách vật phẩm của shop. Quà vào kho của khách.</small></div>
  <div class="f"><label for="wr">Tỉ lệ trúng (%)</label><input id="wr" name="pct" type="number" min="0.1" max="100" step="0.1" value="${x.pct}" required></div>
  <div class="f"><label for="wq">Số lượng thưởng</label><input id="wq" name="qty" type="number" min="1" max="100000" step="1" value="${x.qty}" required><small>Mỗi lần trúng, khách nhận đúng số lượng này.</small></div>`;
}
function readWheel(fd){
  const pid=fd.get('pid'),pct=parseFloat(fd.get('pct')),qty=parseInt(fd.get('qty'),10);
  const p=db.products.find(x=>x.id===pid);
  if(!p)return 'Hãy chọn vật phẩm thưởng.';
  if(!(pct>0&&pct<=100))return 'Tỉ lệ phải lớn hơn 0 và không quá 100%.';
  if(!(qty>=1&&qty<=100000))return 'Số lượng thưởng phải từ 1 đến 100.000.';
  return {pid,name:p.name,emoji:p.emoji,pct:Math.round(pct*10)/10,qty};
}
function wadd(){
  if(wheelCfg().length>=MAX_PRIZES){toast('Vòng quay tối đa '+MAX_PRIZES+' phần thưởng.');return}
  if(!db.products.length){toast('Hãy thêm vật phẩm vào shop trước.');return}
  modal('Thêm phần thưởng',wheelForm(),async fd=>{
    const r=readWheel(fd);if(typeof r==='string')return r;
    const e=await saveSettings([{key:'wheel',value:[...wheelCfg(),{id:uid('w'),...r}]}]);
    if(e)return e;
    closeModal();await refresh();toast('Đã thêm phần thưởng.');
  },'Thêm phần thưởng');
}

function wedit(id){
  const x=wheelCfg().find(y=>y.id===id);if(!x)return;
  modal('Sửa phần thưởng',wheelForm(x),async fd=>{
    const r=readWheel(fd);if(typeof r==='string')return r;
    const e=await saveSettings([{key:'wheel',value:wheelCfg().map(y=>y.id===id?{...y,...r}:y)}]);
    if(e)return e;
    closeModal();await refresh();toast('Đã lưu phần thưởng.');
  });
}

function wdel(id){
  const x=wheelCfg().find(y=>y.id===id);if(!x)return;
  if(wheelCfg().length<=2){toast('Vòng quay cần ít nhất 2 phần thưởng.');return}
  modal('Xóa phần thưởng',`<p>Xóa <b>${esc(rewardItem(x).name)}</b> khỏi vòng quay? Quà khách đã nhận vẫn giữ nguyên trong kho.</p>`,async()=>{
    const e=await saveSettings([{key:'wheel',value:wheelCfg().filter(y=>y.id!==id)}]);
    if(e)return e;
    closeModal();await refresh();toast('Đã xóa phần thưởng.');
  },'Xóa');
}

async function weven(){
  const w=wheelCfg().map(x=>({...x})),n=w.length,each=Math.round(1000/n)/10;
  w.forEach(x=>{x.pct=each});
  w[0].pct=Math.round((100-each*(n-1))*10)/10;
  const e=await saveSettings([{key:'wheel',value:w}]);
  if(e){toast(e);return}
  await refresh();toast('Đã chia đều tỉ lệ giữa '+n+' phần thưởng.');
}

/* ===== Thông tin nhận hàng ===== */
const FB_RE=/^https?:\/\/((www|m|web|mbasic)\.)?(facebook\.com|fb\.com|fb\.me|m\.me)\/\S+$/i;
function normContact(ch,v){return ch==='Zalo'?v.replace(/[\s.\-]/g,''):v.trim()}
function checkContact(ch,v){
  if(ch==='Zalo')return /^(0|\+84)\d{9,10}$/.test(v)?'':'Số Zalo chưa đúng. Nhập số điện thoại, ví dụ 0912345678.';
  if(v.length>200)return 'Link Facebook quá dài.';
  return FB_RE.test(v)?'':'Link Facebook chưa đúng. Dán link trang cá nhân, ví dụ https://facebook.com/ten-ban.';
}
const notesHtml=()=>'<ul>'+String(db.settings.notes||DEFAULT_NOTES).split('\n').map(x=>x.trim()).filter(Boolean).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>';
const isOpen=o=>o.status!=='done'&&o.status!=='cancelled';
function statusHtml(o){
  if(o&&o.status==='done')return '<span class="pill">Thành công</span>';
  if(o&&o.status==='cancelled')return '<span class="pill bad">Đã hủy</span><br><small>Hủy bởi '+(o.cancelBy==='admin'?'shop':'khách')+(o.cancelReason?': '+esc(o.cancelReason):'')+'</small>';
  return '<span class="pill warn">Đang xử lý</span>';
}
function contactHtml(c){
  if(!c||!c.value)return '—';
  if(c.channel==='Facebook'&&FB_RE.test(c.value))return `Facebook: <a href="${esc(c.value)}" target="_blank" rel="noopener noreferrer">${esc(c.value.replace(/^https?:\/\/(www\.)?/i,'').slice(0,34))}</a>`;
  return esc(c.channel)+': '+esc(c.value);
}

/* ===== Chat với admin ===== */
const msgsOf=cid=>db.messages.filter(m=>m.cid===cid).sort((a,b)=>a.time-b.time);
function unreadFor(role,cid){
  return db.messages.filter(m=>!m.read&&(role==='user'?(m.cid===cid&&m.from==='admin'):(m.from==='user'&&(cid==null||m.cid===cid)))).length;
}
function markRead(role,cid){
  const other=role==='user'?'admin':'user';
  const list=db.messages.filter(m=>!m.read&&m.cid===cid&&m.from===other);
  if(!list.length||!sb)return;
  list.forEach(m=>{m.read=true});            // cập nhật ngay trên màn hình
  sb.rpc('mark_read',{p_cid:cid}).then(()=>{});
}

function navDot(k,u){
  if(!u)return '';
  let n=0;
  if(k==='spin'){const sp=wheelState(u).spins;return sp>0?'<span class="dot">'+sp+'</span>':''}
  if(k==='chat')n=unreadFor('user',u.id);
  if(k==='admin'&&u.role==='admin')n=unreadFor('admin');
  return n?`<span class="dot">${n}</span>`:'';
}
function chatBox(cid,role){
  const list=msgsOf(cid);
  return `<div class="chat" id="chatlog" tabindex="0" aria-label="Nội dung chat">${list.length?list.map(m=>`<div class="msg ${m.from===role?'me':'other'}"><div class="bub">${esc(m.text).replace(/\n/g,'<br>')}</div><small>${fdate(m.time)}</small></div>`).join(''):'<div class="empty">Chưa có tin nhắn. Gửi tin đầu tiên để bắt đầu trò chuyện.</div>'}</div>
  <div class="chatin"><input id="chatin" maxlength="500" placeholder="Nhập tin nhắn…" aria-label="Tin nhắn" autocomplete="off"><button class="btn" data-act="send" data-id="${cid}">Gửi</button></div>`;
}
function vChat(){
  const u=me();
  return `<div class="hero"><div><h1>Chat với shop</h1><p>Nhắn trực tiếp cho quản trị viên về đơn hàng, nạp tiền hoặc giao vật phẩm.</p></div></div>
  <section class="panel">${chatBox(u.id,'user')}</section>`;
}
function chatCusts(){
  const last=u=>{const l=msgsOf(u.id);return l.length?l[l.length-1].time:0};
  return db.users.filter(u=>u.role!=='admin').sort((a,b)=>last(b)-last(a));
}
function ensureChatUid(){
  const c=chatCusts();
  if(!c.find(u=>u.id===ui.chatUid))ui.chatUid=c[0]?c[0].id:null;
}
function adminChat(){
  ensureChatUid();
  const c=chatCusts();
  if(!c.length)return `<section class="panel"><div class="empty"><b>💬</b>Chưa có khách hàng nào. Khi khách đăng ký và nhắn tin, cuộc trò chuyện sẽ hiện ở đây.</div></section>`;
  const cur=c.find(u=>u.id===ui.chatUid);
  return `<section class="panel"><h2>Tin nhắn khách hàng</h2><div class="chatwrap">
    <div class="clist">${c.map(u=>{const n=unreadFor('admin',u.id),l=msgsOf(u.id),lm=l[l.length-1];
      return `<button class="${u.id===ui.chatUid?'on':''}" data-act="chatsel" data-id="${u.id}"><span><b>${esc(u.username)}</b><br><small>${lm?esc(lm.text.replace(/\n/g,' ').slice(0,28)):'Chưa có tin nhắn'}</small></span>${n?`<span class="dot">${n}</span>`:''}</button>`}).join('')}</div>
    <div><div class="stock" style="margin-bottom:6px">Đang chat với <b>${esc(cur.username)}</b></div>${chatBox(cur.id,'admin')}</div></div></section>`;
}

/* ===== Giỏ hàng & mua hàng ===== */
const totalHtml=o=>fmt(o.total)+(o.disc?`<br><small>Đã giảm ${DISCOUNT_PCT}% (-${fmt(o.disc)})</small>`:'');
function cartCount(){return Object.values(ui.cart).reduce((t,q)=>t+q,0)}
function cleanCart(){Object.keys(ui.cart).forEach(id=>{if(!db.products.find(p=>p.id===id)||!(ui.cart[id]>0))delete ui.cart[id]})}
function syncCartFromForm(){document.querySelectorAll('#mf input[name^="c_"]').forEach(i=>{const q=parseInt(i.value,10);if(q>0)ui.cart[i.name.slice(2)]=q})}

function openBuy(id){ // thêm món vào giỏ
  const u=me();if(!u){openLogin();return}
  const p=db.products.find(x=>x.id===id);if(!p)return;
  const maxQ=Math.floor(p.stock/STEP_QTY)*STEP_QTY;
  const start=Math.min(Math.max(Math.round((ui.cart[p.id]||MIN_ITEM)/STEP_QTY)*STEP_QTY,MIN_ITEM),maxQ);
  modal('Thêm vào giỏ: '+p.name,`
    <div class="row" style="margin-bottom:12px"><span class="pv2">${pic(p)}</span><div style="flex:1"><b>${esc(p.name)}</b><br><span class="price">${fmt(p.price)}</span> <span class="stock">Còn ${p.stock}</span></div></div>
    <div class="f"><label for="qty">Số lượng</label><input id="qty" name="qty" type="number" min="${MIN_ITEM}" max="${maxQ}" step="${STEP_QTY}" value="${start}" required><small>Mua theo bội số của ${STEP_QTY}: 10, 20, 30, 40… Tối thiểu ${MIN_ITEM} cái mỗi món.</small></div>
    <div class="row"><span>Thành tiền</span><b id="tot" class="price">${fmt(start*p.price)}</b></div>`,
  fd=>{
    const q=parseInt(fd.get('qty'),10);
    if(!(q>=MIN_ITEM))return 'Mỗi món mua tối thiểu '+MIN_ITEM+' cái.';
    if(q%STEP_QTY!==0)return 'Số lượng phải là bội số của '+STEP_QTY+' (10, 20, 30, 40…), không mua số lẻ.';
    if(q>p.stock)return 'Kho chỉ còn '+p.stock+' món.';
    ui.cart[p.id]=q;closeModal();render();toast('Đã thêm '+q+' × '+p.name+' vào giỏ.');
  },'Thêm vào giỏ');
  const qi=$('#qty');qi.addEventListener('input',()=>{const q=Math.max(0,parseInt(qi.value,10)||0);$('#tot').textContent=fmt(q*p.price)});
}

function openCart(){
  const u=me();if(!u){openLogin();return}
  cleanCart();
  const ids=Object.keys(ui.cart);
  if(!ids.length){
    modal('Giỏ hàng',`<div class="empty"><b>🛒</b>Giỏ hàng đang trống. Mỗi món mua tối thiểu ${MIN_ITEM} cái, mỗi đơn tối thiểu ${MIN_ORDER} cái.</div>`,()=>{},'');
    return;
  }
  const rows=ids.map(id=>{const p=db.products.find(x=>x.id===id);return `
    <div class="invrow"><span class="pv2" style="width:44px;height:44px;font-size:28px">${pic(p)}</span>
    <span class="nm"><b>${esc(p.name)}</b><br><small>${fmt(p.price)} · còn ${p.stock}</small></span>
    <input type="number" min="${MIN_ITEM}" max="${Math.floor(p.stock/STEP_QTY)*STEP_QTY}" step="${STEP_QTY}" name="c_${p.id}" value="${ui.cart[id]}" data-price="${p.price}" aria-label="Số lượng ${esc(p.name)}">
    <button type="button" class="btn sm danger" data-act="cdel" data-id="${p.id}" aria-label="Xóa ${esc(p.name)} khỏi giỏ">Xóa</button></div>`}).join('');
  modal('Giỏ hàng',`${rows}<div class="note" id="csum" style="margin-top:12px"></div>
    <div class="row"><span>Số dư của bạn</span><b>${fmt(u.balance)}</b></div>
    <h3 class="ctitle">Thông tin nhận hàng</h3>
    <div class="two"><div class="f"><label for="ch">Kênh liên hệ</label><select id="ch" name="channel"><option value="Zalo">Zalo</option><option value="Facebook" ${(u.contact||{}).channel==='Facebook'?'selected':''}>Facebook</option></select></div>
    <div class="f"><label for="ct">Số Zalo hoặc link Facebook</label><input id="ct" name="contact" required maxlength="200" value="${esc((u.contact||{}).value||'')}"></div></div>
    <div class="f"><label for="nt">Ghi chú giao hàng (tùy chọn)</label><input id="nt" name="note" maxlength="200" placeholder="VD: tên nông trại Hay Day, ID người chơi"><small>Shop sẽ liên hệ bạn qua kênh này để giao vật phẩm.</small></div>
    <div class="notebox"><b>Lưu ý khi mua</b>${notesHtml()}</div>
    <div class="f"><label><input type="checkbox" name="agree" required style="width:auto"> Tôi đã đọc và đồng ý với các lưu ý trên</label></div>`,
  async fd=>{
    const items=[];let qty=0;
    for(const id of ids){
      const p=db.products.find(x=>x.id===id);if(!p)continue;
      const q=parseInt(fd.get('c_'+id),10);
      if(!(q>=MIN_ITEM))return p.name+': mua tối thiểu '+MIN_ITEM+' cái.';
      if(q%STEP_QTY!==0)return p.name+': số lượng phải là bội số của '+STEP_QTY+' (10, 20, 30…).';
      if(q>p.stock)return p.name+': kho chỉ còn '+p.stock+' món.';
      items.push({pid:id,qty:q});qty+=q;
    }
    if(qty<MIN_ORDER)return 'Mỗi đơn cần tối thiểu '+MIN_ORDER+' cái. Bạn mới chọn '+qty+', cần thêm '+(MIN_ORDER-qty)+' cái.';
    const channel=fd.get('channel')==='Facebook'?'Facebook':'Zalo';
    const value=normContact(channel,fd.get('contact'));
    const cerr=checkContact(channel,value);if(cerr)return cerr;
    if(fd.get('agree')!=='on')return 'Hãy tích vào ô xác nhận đã đọc các lưu ý khi mua.';
    const {data,error}=await sb.rpc('place_order',{p_items:items,p_channel:channel,p_contact:value,p_note:fd.get('note').trim()});
    if(error)return friendly(error);
    ui.cart={};closeModal();await refresh();
    toast('Đặt hàng thành công. Shop sẽ liên hệ bạn qua '+channel+'.'+(data&&data.spins_granted?' Bạn nhận thêm '+data.spins_granted+' lượt quay!':''));
  },'Đặt hàng');
  const upd=()=>{
    syncCartFromForm();
    let qty=0,sum=0;
    document.querySelectorAll('#mf input[name^="c_"]').forEach(i=>{const q=parseInt(i.value,10)||0;qty+=q;sum+=q*Number(i.dataset.price)});
    const ok=qty>=MIN_ORDER;
    $('#csum').innerHTML='Tổng <b>'+qty+'</b> cái. '+(ok?'Đủ mức tối thiểu '+MIN_ORDER+' cái mỗi đơn.':'Mỗi đơn cần tối thiểu '+MIN_ORDER+' cái, còn thiếu <b>'+(MIN_ORDER-qty)+'</b>.')+(qty>DISCOUNT_QTY
      ?'<br>Tạm tính: '+fmt(sum)+'<br>Giảm '+DISCOUNT_PCT+'% (mua trên '+DISCOUNT_QTY+' cái): <b>-'+fmt(Math.round(sum*DISCOUNT_PCT/100))+'</b><br>Thành tiền: <b>'+fmt(sum-Math.round(sum*DISCOUNT_PCT/100))+'</b>'
      :(qty>0?'<br>Mua thêm <b>'+(DISCOUNT_QTY+STEP_QTY-qty)+'</b> cái để vượt '+DISCOUNT_QTY+' và được giảm '+DISCOUNT_PCT+'%.<br>Thành tiền: <b>'+fmt(sum)+'</b>':''));
    renderHeader();
  };
  $('#mf').addEventListener('input',upd);upd();
  const chs=$('#ch'),setPh=()=>{$('#ct').placeholder=chs.value==='Zalo'?'0912345678':'https://facebook.com/ten-ban'};
  chs.addEventListener('change',setPh);setPh();
}

/* ===== Nạp tiền qua MoMo ===== */
function genCode(){
  const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do{
    let r;
    try{r=[...crypto.getRandomValues(new Uint8Array(6))]}catch(e){r=Array.from({length:6},()=>Math.floor(Math.random()*256))}
    c=r.map(x=>A[x%A.length]).join('');
  }while(db.topups.some(t=>t.code===c));
  return c;
}
async function copyText(t){
  try{await navigator.clipboard.writeText(t);toast('Đã sao chép: '+t)}
  catch(e){toast('Không tự sao chép được. Hãy bôi đen và chép thủ công.')}
}
function openTopup(){
  const u=me();
  const code=genCode();
  const content=u.username+' '+code;
  const momo=db.settings.momo||'';
  modal('Nạp tiền qua MoMo',`
    <div class="note"><b>Bước 1.</b> Mở MoMo và chuyển tiền đến số:
      <div class="row" style="margin:8px 0"><span class="price" style="font-size:26px">${esc(momo)}</span><button type="button" class="btn sm sun" data-act="copy" data-text="${esc(momo)}">Sao chép</button></div>
      ${db.settings.momoName?`<small>Chủ tài khoản: ${esc(db.settings.momoName)}</small>`:''}</div>
    <div class="note"><b>Bước 2.</b> Ghi đúng nội dung chuyển tiền:
      <div class="row" style="margin:8px 0"><span class="price" style="font-size:24px;word-break:break-all">${esc(content)}</span><button type="button" class="btn sm sun" data-act="copy" data-text="${esc(content)}">Sao chép</button></div>
      <small>Gồm tên tài khoản và mã ngẫu nhiên của lần nạp này. Ghi sai nội dung thì quản trị viên không đối chiếu được.</small></div>
    <div class="f"><label for="amt">Bước 3. Số tiền đã chuyển (đ)</label><input id="amt" name="amt" type="number" min="1000" step="1000" required placeholder="50000"><small>Bấm “Tôi đã chuyển tiền”, quản trị viên sẽ đối chiếu và cộng vào ví của bạn.</small></div>`,
  async fd=>{
    const a=parseInt(fd.get('amt'),10);
    if(!(a>=1000))return 'Số tiền tối thiểu là 1.000đ.';
    const {error}=await sb.rpc('request_topup',{p_amount:a,p_code:code});
    if(error)return friendly(error);
    closeModal();await refresh();toast('Đã gửi yêu cầu nạp tiền. Chờ quản trị viên duyệt.');
  },'Tôi đã chuyển tiền');
}

/* ===== Admin: vật phẩm ===== */
function productForm(p){
  p=p||{emoji:'📦',name:'',cat:CATS[0],price:'',stock:'',desc:''};
  curImg=p.img||'';
  return `
  <div class="f"><label>Hình ảnh</label><div class="imgpick"><div class="pv" id="pv">${p.img?`<img src="${esc(p.img)}" alt="">`:esc(p.emoji)}</div><div><input type="file" id="imgf" accept="image/*" style="display:none"><div class="acts"><button type="button" class="btn sm sun" data-act="pickimg">Tải ảnh lên</button><button type="button" class="btn sm ghost" data-act="rmimg">Bỏ ảnh</button></div><small>JPG, PNG, WebP. Ảnh tự thu nhỏ còn tối đa 480px. Không có ảnh thì dùng emoji.</small></div></div></div>
  <div class="two"><div class="f"><label for="em">Biểu tượng (emoji)</label><input id="em" name="emoji" value="${esc(p.emoji)}" maxlength="4" required></div>
  <div class="f"><label for="ct">Loại</label><select id="ct" name="cat">${CATS.map(c=>`<option ${c===p.cat?'selected':''}>${c}</option>`).join('')}</select></div></div>
  <div class="f"><label for="nm">Tên vật phẩm</label><input id="nm" name="name" value="${esc(p.name)}" required maxlength="60"></div>
  <div class="two"><div class="f"><label for="pr">Giá (đ)</label><input id="pr" name="price" type="number" min="1" step="1" value="${esc(p.price)}" required></div>
  <div class="f"><label for="sk">Tồn kho</label><input id="sk" name="stock" type="number" min="0" value="${esc(p.stock)}" required></div></div>
  <div class="f"><label for="ds">Mô tả</label><textarea id="ds" name="desc" rows="2" maxlength="160">${esc(p.desc)}</textarea></div>`;
}
function readProduct(fd){
  const price=parseInt(fd.get('price'),10),stock=parseInt(fd.get('stock'),10),name=fd.get('name').trim();
  if(!name)return 'Hãy nhập tên vật phẩm.';
  if(!(price>=1))return 'Giá tối thiểu là 1đ.';
  if(!(stock>=0))return 'Tồn kho không hợp lệ.';
  return {emoji:fd.get('emoji').trim()||'📦',img:curImg,name,cat:fd.get('cat'),price,stock,desc:fd.get('desc').trim()};
}
function padd(){
  modal('Thêm vật phẩm',productForm(),async fd=>{
    const r=readProduct(fd);if(typeof r==='string')return r;
    const e=await saveProduct(null,r);if(e)return e;
    closeModal();await refresh();toast('Đã thêm vật phẩm.');
  },'Thêm vật phẩm');
}

function pedit(id){
  const p=db.products.find(x=>x.id===id);if(!p)return;
  modal('Sửa vật phẩm',productForm(p),async fd=>{
    const r=readProduct(fd);if(typeof r==='string')return r;
    const e=await saveProduct(id,r);if(e)return e;
    closeModal();await refresh();toast('Đã lưu thay đổi.');
  });
}

function pdel(id){
  const p=db.products.find(x=>x.id===id);if(!p)return;
  modal('Xóa vật phẩm',`<p>Xóa <b>${esc(p.name)}</b> khỏi cửa hàng? Vật phẩm đã nằm trong kho khách vẫn được giữ lại.</p>`,async()=>{
    const {error}=await sb.from('products').delete().eq('id',id);
    if(error)return friendly(error);
    closeModal();await refresh();toast('Đã xóa vật phẩm.');
  },'Xóa');
}

/* ===== Admin: tài khoản & kho ===== */
function uedit(id){
  const u=db.users.find(x=>x.id===id);if(!u)return;
  const owned=Object.entries(u.inv);
  const addable=db.products.filter(p=>!u.inv[p.id]);
  modal('Sửa tài khoản: '+u.username,`
    <div class="two"><div class="f"><label for="bal">Số dư (đ)</label><input id="bal" name="balance" type="number" min="0" value="${u.balance}" required></div>
    <div class="f"><label for="rl">Vai trò</label><select id="rl" name="role" ${u.id===sess?'disabled':''}><option value="user" ${u.role==='user'?'selected':''}>Khách</option><option value="admin" ${u.role==='admin'?'selected':''}>Quản trị</option></select></div></div>
    <div class="f"><label for="npw">Mật khẩu mới</label><input id="npw" name="npw" type="password" autocomplete="new-password" placeholder="Để trống nếu không đổi"></div>
    ${u.id!==sess?`<div class="f"><label><input type="checkbox" name="locked" style="width:auto" ${u.locked?'checked':''}> Khóa tài khoản này</label></div>`:''}
    <div class="f"><label for="asp">Cộng thêm lượt quay (hiện có ${wheelState(u).spins})</label><input id="asp" name="addspins" type="number" min="0" max="1000" value="0"></div>
    <h3 style="margin:8px 0">Số dư vật phẩm</h3>
    ${owned.length?owned.map(([pid,v])=>`<div class="invrow"><span class="nm">${esc(v.emoji)} ${esc(v.name)}</span><input type="number" min="0" name="inv_${esc(pid)}" value="${v.qty}" aria-label="Số lượng ${esc(v.name)}"></div>`).join(''):'<p class="stock">Chưa có vật phẩm nào.</p>'}
    ${addable.length?`<div class="invrow"><select name="addp" class="nm" style="flex:1;background:var(--bg);border:2px solid var(--line);border-radius:10px;padding:8px"><option value="">+ Thêm vật phẩm…</option>${addable.map(p=>`<option value="${p.id}">${esc(p.emoji)} ${esc(p.name)}</option>`).join('')}</select><input type="number" min="1" name="addq" value="1" aria-label="Số lượng thêm"></div>`:''}`,
  async fd=>{
    const bal=parseInt(fd.get('balance'),10);
    if(!(bal>=0))return 'Số dư không hợp lệ.';
    const self=u.id===sess;
    const role=self?u.role:fd.get('role'),locked=self?false:fd.get('locked')==='on';
    const npw=fd.get('npw');
    if(npw&&npw.length<6)return 'Mật khẩu mới cần ít nhất 6 ký tự.';
    const asp=parseInt(fd.get('addspins'),10)||0;
    let r=await sb.rpc('admin_update_user',{p_user:id,p_balance:bal,p_role:role,p_locked:locked,p_add_spins:asp>0&&asp<=1000?asp:0});
    if(r.error)return friendly(r.error);
    if(npw){
      r=await sb.rpc('admin_set_password',{p_user:id,p_password:npw});
      if(r.error)return 'Đã lưu thông tin nhưng chưa đổi được mật khẩu: '+friendly(r.error);
    }
    const items=[];
    for(const [pid,v] of owned){const q=parseInt(fd.get('inv_'+pid),10);if(q>=0&&q!==v.qty)items.push({product_id:pid,name:v.name,emoji:v.emoji,qty:q})}
    const ap=fd.get('addp'),aq=parseInt(fd.get('addq'),10);
    if(ap&&aq>=1){const p=db.products.find(x=>x.id===ap);if(p)items.push({product_id:p.id,name:p.name,emoji:p.emoji,qty:aq})}
    if(items.length){r=await sb.rpc('admin_set_inventory',{p_user:id,p_items:items});if(r.error)return friendly(r.error)}
    closeModal();await refresh();toast('Đã cập nhật tài khoản.');
  });
}

function uadd(){
  modal('Tạo tài khoản mới',`
    <div class="f"><label for="un">Tên đăng nhập</label><input id="un" name="un" autocomplete="off" required><small>3–20 ký tự: chữ không dấu, số, dấu gạch dưới.</small></div>
    <div class="f"><label for="pw">Mật khẩu</label><input id="pw" name="pw" type="text" autocomplete="off" required><small>Tối thiểu 6 ký tự. Gửi mật khẩu này cho khách, khách nên tự đổi sau.</small></div>
    <div class="two"><div class="f"><label for="bal">Số dư ban đầu (đ)</label><input id="bal" name="balance" type="number" min="0" step="1" value="0" required></div>
    <div class="f"><label for="rl">Vai trò</label><select id="rl" name="role"><option value="user">Khách</option><option value="admin">Quản trị</option></select></div></div>`,
  async fd=>{
    const un=fd.get('un').trim(),pw=fd.get('pw'),bal=parseInt(fd.get('balance'),10);
    if(!/^[A-Za-z0-9_]{3,20}$/.test(un))return 'Tên đăng nhập phải 3–20 ký tự, chỉ gồm chữ không dấu, số và dấu gạch dưới.';
    if(pw.length<6)return 'Mật khẩu cần ít nhất 6 ký tự.';
    if(!(bal>=0))return 'Số dư ban đầu không hợp lệ.';
    const av=await sb.rpc('username_available',{p_username:un});
    if(av.error)return friendly(av.error);
    if(!av.data)return 'Tên đăng nhập này đã tồn tại. Hãy chọn tên khác.';
    /* Dùng một kết nối riêng để đăng ký, nên phiên của admin không bị thay thế */
    const tmp=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'sb-tmp-signup'}});
    const {data,error}=await tmp.auth.signUp({email:emailOf(un),password:pw,options:{data:{username:un}}});
    if(error)return mapAuthError(error);
    const nid=data&&data.user&&data.user.id;
    if(!nid)return 'Không tạo được tài khoản.';
    const r=await sb.rpc('admin_update_user',{p_user:nid,p_balance:bal,p_role:fd.get('role')==='admin'?'admin':'user',p_locked:false,p_add_spins:0});
    if(r.error)return 'Đã tạo tài khoản nhưng chưa đặt được số dư hoặc vai trò: '+friendly(r.error);
    closeModal();await refresh();toast('Đã tạo tài khoản '+un+'.');
  },'Tạo tài khoản');
}

function udel(id){
  const u=db.users.find(x=>x.id===id);if(!u)return;
  modal('Xóa tài khoản',`<p>Xóa vĩnh viễn tài khoản <b>${esc(u.username)}</b>, kèm số dư và kho vật phẩm của họ?</p>`,async()=>{
    const {error}=await sb.rpc('admin_delete_user',{p_user:id});
    if(error)return friendly(error);
    closeModal();await refresh();toast('Đã xóa tài khoản.');
  },'Xóa tài khoản');
}

/* ===== Ảnh vật phẩm ===== */
let curImg='';
function setPv(){const pv=$('#pv');if(!pv)return;pv.innerHTML=curImg?`<img src="${esc(curImg)}" alt="">`:esc(($('#em')&&$('#em').value)||'📦')}
function fileToImg(file){
  return new Promise((res,rej)=>{
    if(!file||!file.type.startsWith('image/'))return rej(new Error('type'));
    if(file.size>10*1024*1024)return rej(new Error('size'));
    const fr=new FileReader();
    fr.onerror=()=>rej(new Error('read'));
    fr.onload=()=>{
      const im=new Image();
      im.onerror=()=>rej(new Error('load'));
      im.onload=()=>{
        const M=480,s=Math.min(1,M/Math.max(im.width,im.height));
        const c=document.createElement('canvas');c.width=Math.max(1,Math.round(im.width*s));c.height=Math.max(1,Math.round(im.height*s));
        c.getContext('2d').drawImage(im,0,0,c.width,c.height);
        let d=c.toDataURL('image/webp',0.82);
        if(!d.startsWith('data:image/webp'))d=c.toDataURL('image/jpeg',0.85);
        res(d);
      };
      im.src=fr.result;
    };
    fr.readAsDataURL(file);
  });
}
document.addEventListener('change',async e=>{
  if(e.target.id!=='imgf')return;
  const f=e.target.files&&e.target.files[0];if(!f)return;
  try{curImg=await fileToImg(f);setPv();const m=$('#merr');if(m)m.innerHTML=''}
  catch(err){const m=$('#merr');if(m)m.innerHTML='<div class="err">'+(err.message==='size'?'Ảnh quá lớn. Chọn ảnh dưới 10 MB.':'Không đọc được tệp này. Hãy chọn ảnh JPG, PNG hoặc WebP.')+'</div>'}
  e.target.value='';
});
document.addEventListener('input',e=>{if(e.target.id==='em'&&!curImg)setPv()});

/* ===== Các thao tác gọi server ===== */
async function saveSettings(rows){
  const {error}=await sb.from('settings').upsert(rows,{onConflict:'key'});
  return error?friendly(error):'';
}
async function saveProduct(id,r){
  let img=r.img;
  if(img&&img.startsWith('data:')){
    const blob=await (await fetch(img)).blob();
    const path=uid('p-')+'.'+(blob.type==='image/webp'?'webp':'jpg');
    const up=await sb.storage.from('product-images').upload(path,blob,{contentType:blob.type,cacheControl:'31536000'});
    if(up.error)return 'Không tải được ảnh lên: '+friendly(up.error);
    img=sb.storage.from('product-images').getPublicUrl(path).data.publicUrl;
  }
  const row={emoji:r.emoji,name:r.name,cat:r.cat,price:r.price,stock:r.stock,descr:r.desc,img:img||null};
  const {error}=id?await sb.from('products').update(row).eq('id',id):await sb.from('products').insert(row);
  return error?friendly(error):'';
}
async function doLogout(){
  await sb.auth.signOut();
  ui.cart={};ui.view='shop';
  await loadAll();render();toast('Đã đăng xuất.');
}
async function doSend(cid){
  const inp=$('#chatin');const text=inp?inp.value.trim():'';if(!text)return;
  const adminMode=isAdmin()&&ui.view==='admin';
  const target=adminMode?cid:sess;if(!target)return;
  inp.disabled=true;
  const {error}=await sb.rpc('send_message',{p_cid:target,p_body:text.slice(0,500)});
  if(error){inp.disabled=false;toast(friendly(error));return}
  await refresh();
  const n=$('#chatin');if(n)n.focus();
}
async function doOrderStatus(id){
  const o=db.orders.find(x=>x.id===id);if(!o||o.status==='cancelled')return;
  const done=o.status!=='done';
  const {error}=await sb.rpc('set_order_status',{p_order:id,p_done:done});
  if(error){toast(friendly(error));return}
  await refresh();toast(done?'Đã đánh dấu đơn thành công.':'Đã chuyển đơn về đang xử lý.');
}
async function doReview(id,approve){
  const t=db.topups.find(x=>x.id===id);if(!t||t.status!=='pending')return;
  const {data,error}=await sb.rpc('review_topup',{p_topup:id,p_approve:approve});
  if(error){toast(friendly(error));return}
  await refresh();
  toast(approve?'Đã cộng '+fmt(t.amount)+' cho '+t.username+(data&&data.spins_granted?'. Khách nhận thêm '+data.spins_granted+' lượt quay.':''):'Đã từ chối yêu cầu.');
}
async function saveBank(){
  const n=$('#mno').value.trim();
  if(!/^0\d{9}$/.test(n)){toast('Số MoMo cần 10 chữ số, bắt đầu bằng 0.');return}
  const e=await saveSettings([{key:'momo',value:n},{key:'momo_name',value:$('#mnm').value.trim()}]);
  if(e){toast(e);return}
  await refresh();toast('Đã lưu thông tin MoMo.');
}
async function saveNotes(){
  const v=$('#notes').value.trim();
  if(!v){toast('Cần có ít nhất một lưu ý.');return}
  const e=await saveSettings([{key:'notes',value:v.slice(0,1500)}]);
  if(e){toast(e);return}
  await refresh();toast('Đã lưu lưu ý khi mua.');
}

/* ===== Điều khiển sự kiện ===== */
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b)return;
  const a=b.dataset.act,id=b.dataset.id;
  if(a==='ovclose'){if(e.target===b)closeModal();return}
  switch(a){
    case 'close':closeModal();break;
    case 'nav':ui.view=id;render();window.scrollTo(0,0);break;
    case 'cat':ui.cat=id;render();break;
    case 'tab':ui.tab=id;render();break;
    case 'login':openLogin();break;
    case 'register':openRegister();break;
    case 'logout':doLogout();break;
    case 'buy':openBuy(id);break;
    case 'cart':openCart();break;
    case 'cdel':syncCartFromForm();delete ui.cart[id];render();openCart();break;
    case 'ocancel':openCancel(id);break;
    case 'chatsel':ui.chatUid=id;render();break;
    case 'chatwith':ui.view='admin';ui.tab='chat';ui.chatUid=id;render();window.scrollTo(0,0);break;
    case 'send':doSend(id);break;
    case 'ostat':doOrderStatus(id);break;
    case 'spin':doSpin();break;
    case 'topup':openTopup();break;
    case 'padd':padd();break;
    case 'pedit':pedit(id);break;
    case 'pdel':pdel(id);break;
    case 'uedit':uedit(id);break;
    case 'udel':udel(id);break;
    case 'uadd':uadd();break;
    case 'tok':doReview(id,true);break;
    case 'tno':doReview(id,false);break;
    case 'bank':saveBank();break;
    case 'notes':saveNotes();break;
    case 'copy':copyText(b.dataset.text);break;
    case 'wadd':wadd();break;
    case 'wedit':wedit(id);break;
    case 'wdel':wdel(id);break;
    case 'weven':weven();break;
    case 'msave':saveMilestones();break;
    case 'pickimg':{const f=$('#imgf');if(f)f.click();break}
    case 'rmimg':curImg='';setPv();break;
  }
});
document.addEventListener('input',e=>{
  if(e.target.id==='q'){ui.q=e.target.value;const pos=e.target.selectionStart;render();const q=$('#q');if(q){q.focus();q.setSelectionRange(pos,pos)}}
});
document.addEventListener('change',e=>{if(e.target.id==='sort'){ui.sort=e.target.value;render()}});

document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&e.target.id==='chatin'){e.preventDefault();const b=document.querySelector('[data-act="send"]');if(b)b.click()}
});
init();
