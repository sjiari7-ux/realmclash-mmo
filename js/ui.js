"use strict";

/* ============================================================
   APP STATE + RENDER
   ============================================================ */
const S = {
  screen: 'loading',
  char: null,
  combat: null, // transient combat session
  pvpCandidates: null,
  road: null, // {zoneId, log:[], gained:{xp,gold,resources:{}}}
  kingdomView: null,
  marketListings: null,
  marketTab: 'browse',
  marketFilter: 'all',
  marketSellKind: 'resource',
  craftQty: {},
  zoneDetailId: null,
  toast: null,
  toastTimer: null,
  craftFilter: null,
  tutorialIdx: 0,
};

function showToast(msg){
  S.toast = msg;
  render();
  clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(()=>{ S.toast=null; render(); }, 2600);
}

function setScreen(scr){
  S.screen = scr;
  render();
  window.scrollTo(0,0);
}

async function persist(){ render(); if(S.char) saveCharacter(S.char); } // update the screen first; save runs in the background

// Hover text for the Energy bar's regen label — the countdown is display-only,
// the authoritative value always comes from applyRegen()'s timestamp math.
function energyRegenTooltip(c, eff){
  if(c.energyCur >= eff.maxEnergy) return 'Energy is full.';
  const info = energyRegenInfo(c, eff);
  return `+${info.perHour} Energy per hour (20% of Max Energy) · next point in ${fmtMs(info.msToNext)} · full in ${fmtMs(info.msToFull)}`;
}

/* ---------------- First-time tutorial ---------------- */
const TUTORIAL_STEPS = [
  { title:'Welcome to RealmClash', body:'Energy is your action currency — it fuels Adventure, PvP, Gathering and Crafting. It regenerates on its own over time, even while you\'re offline, so you never have to grind it out.' },
  { title:'Spend it wisely', body:'Fighting, gathering and crafting all cost Energy. Inventory, Market, Chat, Kingdom and your Character screen never do — you can always check in even at 0 Energy.' },
  { title:'Start with Adventure', body:'Head into a zone and fight a monster for XP, Gold and Resources. Beating it is the fastest way to get your first gear.' },
  { title:'Craft what you find', body:'Bring resources back to the Crafting screen to turn them into materials, potions and better equipment.' },
  { title:'Trade in the Market', body:'Buy and sell with other players any time — it never costs Energy. From here on, the path is yours to choose.' },
];
function renderTutorialOverlay(){
  const step = S.tutorialIdx||0;
  const s = TUTORIAL_STEPS[step];
  const last = step >= TUTORIAL_STEPS.length-1;
  return `
  <div class="modal-backdrop">
    <div class="panel modal-card">
      <div class="panel-title">${s.title} <span class="faint" style="float:right;">${step+1}/${TUTORIAL_STEPS.length}</span></div>
      <p style="line-height:1.7; margin-bottom:18px;">${s.body}</p>
      <div class="row">
        <button class="btn btn-sm" data-action="tutorial-dismiss">Skip</button>
        ${last
          ? `<button class="btn btn-primary" data-action="tutorial-dismiss">Let's go</button>`
          : `<button class="btn btn-primary" data-action="tutorial-next">Next</button>`}
      </div>
    </div>
  </div>`;
}

/* ---------------- Login gate ---------------- */
function renderLogin(){
  return `
  <div class="loader-wrap" style="min-height:100vh; padding:20px;">
    <div style="max-width:420px; width:100%; text-align:center;">
      <div class="brand-mark" style="margin:0 auto 14px; width:48px; height:48px;">${icon('crown','style="width:100%;height:100%;stroke:var(--brass-bright)"')}</div>
      <h1 style="font-size:28px; margin-bottom:8px;">REALMCLASH MMO</h1>
      <p class="muted" style="margin-bottom:24px;">Sign in with Google to create your character. Your progress is saved to your account.</p>
      <button class="btn btn-primary btn-block" data-action="google-signin" style="padding:14px;">Sign in with Google</button>
    </div>
  </div>`;
}

/* ---------------- Character creation ---------------- */
function renderCreate(){
  const state = S._create || (S._create = {username:'', classId:null});
  const cards = Object.values(CLASSES).map(cls=>{
    const sel = state.classId===cls.id;
    return `<div class="class-card ${sel?'selected':''}" data-action="pick-class" data-class="${cls.id}">
      <h3>${cls.name}</h3>
      <div class="res">Resource: ${cls.resource}</div>
      <div class="faint">${cls.tagline}</div>
      <ul>${cls.skills.map(s=>`<li>${s.name}</li>`).join('')}</ul>
    </div>`;
  }).join('');
  return `
  <div class="loader-wrap" style="min-height:100vh; padding:20px;">
    <div style="max-width:760px; width:100%;">
      <div style="text-align:center; margin-bottom:26px;">
        <div class="brand-mark" style="margin:0 auto 10px; width:42px; height:42px;">${icon('crown','style="width:100%;height:100%;stroke:var(--brass-bright)"')}</div>
        <h1 style="font-size:30px;">REALMCLASH MMO</h1>
        <p class="muted" style="margin-top:6px;">Create your character and enter the fight.</p>
      </div>
      <div class="panel" style="margin-bottom:16px;">
        <label class="field">Username</label>
        <input type="text" id="username-input" maxlength="18" placeholder="Choose a name (min. 3 characters)" value="${esc(state.username)}">
        <p class="faint" style="margin-top:6px;">At least 3 characters, and must be unique — no two players can share a name.</p>
      </div>
      <div class="panel-title" style="margin-bottom:10px;">Choose your class</div>
      <div class="grid grid-3" style="margin-bottom:20px;">${cards}</div>
      <button class="btn btn-primary btn-block" data-action="create-character" ${(!state.classId)?'disabled':''} style="padding:14px;">Begin your journey</button>
    </div>
  </div>`;
}

/* ---------------- Shell / nav ---------------- */
const NAV = [
  {id:'home', label:'Home', icon:'home'},
  {id:'adventure', label:'Adventure', icon:'sword'},
  {id:'pvp', label:'PvP', icon:'target'},
  {id:'kingdom', label:'Kingdom', icon:'crown'},
  {id:'market', label:'Market', icon:'scroll'},
  {id:'craft', label:'Craft', icon:'flask'},
  {id:'inventory', label:'Inventory', icon:'bag'},
  {id:'profile', label:'Profile', icon:'user'},
  {id:'settings', label:'Settings', icon:'gear'},
];

function renderStatusBar(){
  const c = S.char, eff = effectiveStats(c);
  const initials = c.username.slice(0,2).toUpperCase();
  const hpRegen = Math.max(1, Math.round(eff.maxHp*HP_REGEN_PCT));
  return `
  <div class="statusbar">
    <div class="sb-id">
      <div class="sb-avatar">${initials}<span class="sb-lvl-badge">${c.level}</span></div>
    </div>
    <div class="sb-bars">
      <div class="sb-bar">
        <div class="sb-bar-label"><span>${icon('heart','style="width:10px;height:10px;vertical-align:-1px"')} ${Math.round(c.hpCur)}/${eff.maxHp}</span><span class="sb-regen">&#9650;${hpRegen}</span></div>
        <div class="bar-track"><div class="bar-fill bar-hp" style="width:${clamp(c.hpCur/eff.maxHp*100,0,100)}%"></div></div>
      </div>
      <div class="sb-bar">
        <div class="sb-bar-label"><span>${icon('bolt','style="width:10px;height:10px;vertical-align:-1px"')} ${Math.floor(c.energyCur)}/${eff.maxEnergy}</span><span class="sb-regen" title="${energyRegenTooltip(c, eff)}">${c.energyCur>=eff.maxEnergy?'Full':'+'+energyRegenPerHour(eff.maxEnergy)+'/hr'}</span></div>
        <div class="bar-track"><div class="bar-fill bar-energy" style="width:${clamp(c.energyCur/eff.maxEnergy*100,0,100)}%"></div></div>
      </div>
      <div class="sb-bar">
        <div class="sb-bar-label"><span>${icon('drop','style="width:10px;height:10px;vertical-align:-1px"')} ${Math.round(c.manaCur)}/${eff.maxMana}</span><span class="sb-regen">&#9650;${MANA_REGEN_AMT}</span></div>
        <div class="bar-track"><div class="bar-fill bar-mana" style="width:${clamp(c.manaCur/eff.maxMana*100,0,100)}%"></div></div>
      </div>
    </div>
    <div class="sb-stat">${icon('crown','style="width:12px;height:12px;vertical-align:-1px; stroke:var(--brass-bright)"')} <b>${fmtNum(c.gold)}</b></div>
    <div class="sb-rating">${icon('shield','style="width:13px;height:13px"')} ${Math.round(c.pvp.rating)}</div>
  </div>`;
}

function renderNav(activeId){
  return NAV.map(n=>`<button class="navbtn ${activeId===n.id?'active':''}" data-action="nav" data-screen="${n.id}">${icon(n.icon)}<span>${n.label}</span></button>`).join('');
}
function renderTabbar(activeId){
  return NAV.map(n=>`<button class="tabbtn ${activeId===n.id?'active':''}" data-action="nav" data-screen="${n.id}">${icon(n.icon)}<span>${n.label}</span></button>`).join('');
}

/* ---------------- Home ---------------- */
function renderHome(){
  const c = S.char, eff = effectiveStats(c);
  const need = xpNeeded(c.level);
  return `
  <div class="view-header"><h2>Welcome back, ${esc(c.username)}</h2><p>${CLASSES[c.class].name} &middot; Level ${c.level} &middot; ${resourceTotal(c)} resources carried</p></div>
  <div class="grid grid-2" style="margin-bottom:16px;">
    <div class="panel">
      <div class="panel-title">Character</div>
      <div class="stat-list">
        <div><span>Level</span><b>${c.level}</b></div>
        <div><span>XP</span><b>${fmtNum(c.xp)} / ${fmtNum(need)}</b></div>
        <div><span>Gold</span><b>${fmtNum(c.gold)}</b></div>
        <div><span>Attack</span><b>${eff.atk}</b></div>
        <div><span>Defense</span><b>${eff.def}</b></div>
        <div><span>Speed</span><b>${eff.spd}</b></div>
      </div>
      <div class="divider"></div>
      <div class="row"><span class="muted">PvP Rating</span><b>${Math.round(c.pvp.rating)}</b></div>
      <div class="row" style="margin-top:6px;"><span class="muted">Record</span><b>${c.pvp.wins}W &ndash; ${c.pvp.losses}L</b></div>
    </div>
    <div class="panel">
      <div class="panel-title">Ready to act</div>
      <p class="faint" style="margin-bottom:14px;">Fight monsters to gain XP and gear, then take your build into the Arena.</p>
      <button class="btn btn-primary btn-block" data-action="nav" data-screen="adventure" style="margin-bottom:10px;">${icon('sword','style="width:16px;height:16px"')} Enter Adventure</button>
      <button class="btn btn-accent btn-block" data-action="nav" data-screen="pvp">${icon('target','style="width:16px;height:16px"')} Enter PvP Arena</button>
    </div>
  </div>
  <div class="panel">
    <div class="panel-title">The core loop</div>
    <p class="faint" style="line-height:1.7;">Build your character &rarr; prepare your build &rarr; fight &rarr; improve &rarr; enter PvP &rarr; raise your rating &rarr; face stronger opponents.</p>
  </div>`;
}

/* ---------------- Adventure ---------------- */
const ZONE_BANNERS = {
  plains: 'linear-gradient(160deg, #4a7c3f, #2e5230)',
  forest: 'linear-gradient(160deg, #1f4d2e, #16321f)',
  mountain: 'linear-gradient(160deg, #5b6b78, #33404a)',
  cave: 'linear-gradient(160deg, #4a2e6b, #241536)',
  swamp: 'linear-gradient(160deg, #3d4a2e, #232b1a)',
  darkzone: 'linear-gradient(160deg, #5a1f24, #250d0f)',
  frozen: 'linear-gradient(160deg, #3e6b8a, #1d3446)',
  abyss: 'linear-gradient(160deg, #2a1240, #0d0616)',
};
function renderAdventure(){
  const c = S.char;
  const now = Date.now();
  const tiles = ZONES.map(z=>{
    const locked = c.level < z.min - 5;
    return `<div class="zone-tile ${locked?'locked':''}">
      <div class="zone-banner" style="background:${ZONE_BANNERS[z.id]||'var(--panel-2)'};"></div>
      <div class="zone-tile-body">
        <h4>${z.name}</h4>
        <div class="zone-tile-meta">
          <span class="tag">Lv.${z.min}&ndash;${z.uncapped?z.min+'+':z.max}</span>
          <span class="tag">${icon('sword','style="width:10px;height:10px;vertical-align:-1px"')} ${z.monsters.length}</span>
        </div>
        ${locked
          ? `<button class="btn btn-sm btn-block" disabled>${icon('lock','style="width:12px;height:12px"')} Requires Lv.${z.min-5}</button>`
          : `<button class="btn btn-primary btn-sm btn-block" data-action="view-zone" data-zone="${z.id}">View</button>`}
      </div>
    </div>`;
  }).join('');
  return `
  <div class="view-header"><h2>Realm Explorer</h2><p>Select a zone to enter.</p></div>
  <div class="zone-grid">${tiles}</div>`;
}

function renderZoneDetail(){
  const c = S.char;
  const now = Date.now();
  const z = ZONES.find(x=>x.id===S.zoneDetailId);
  if(!z) return renderAdventure();
  const locked = c.level < z.min - 5;
  const eliteLocked = locked || c.level < z.min;
  const bossCd = (c.bossCooldowns[z.id]||0) - now;
  const bossLocked = eliteLocked || bossCd > 0;
  return `
  <button class="btn btn-sm" data-action="nav" data-screen="adventure" style="margin-bottom:14px;">&larr; Realm Explorer</button>
  <div class="zone-banner" style="background:${ZONE_BANNERS[z.id]||'var(--panel-2)'}; height:140px; border-radius:12px; margin-bottom:16px;"></div>
  <div class="view-header"><h2>${z.name}</h2><p>Level ${z.min}&ndash;${z.uncapped?z.min+'+':z.max} &middot; Resources: ${z.resources.map(r=>RESOURCE_NAMES[r]).join(', ')}</p></div>
  <div class="panel" style="margin-bottom:16px;">
    <div class="panel-title">Zone Boss</div>
    <div class="row"><span>${z.boss}</span><span class="faint">${bossCd>0?`Ready in ${fmtMs(bossCd)}`:'Ready'}</span></div>
  </div>
  <div class="grid grid-2">
    <button class="btn btn-accent btn-block" style="padding:14px;" data-action="zone-road" data-zone="${z.id}" ${locked?'disabled':''} title="Wander the road: cheap, mostly small finds, occasional monster">Take a Step</button>
    <button class="btn btn-primary btn-block" style="padding:14px;" data-action="enter-zone" data-zone="${z.id}" ${locked?'disabled':''}>Explore</button>
    <button class="btn btn-danger btn-block" style="padding:14px;" data-action="enter-zone-elite" data-zone="${z.id}" ${eliteLocked?'disabled':''} title="Tougher monster, 20 Energy, better drops">Elite Hunt</button>
    <button class="btn btn-block" style="padding:14px; ${bossLocked?'':'border-color:var(--brass); color:var(--brass-bright);'}" data-action="enter-zone-boss" data-zone="${z.id}" ${bossLocked?'disabled':''} title="Unique boss, 30 Energy, guaranteed high-tier drop, 30 min cooldown">Zone Boss</button>
  </div>`;
}

function renderRoad(){
  const c = S.char, eff = effectiveStats(c);
  const road = S.road;
  const zone = ZONES.find(z=>z.id===road.zoneId);
  const g = road.gained;
  const resSummary = Object.entries(g.resources).map(([k,v])=>`+${v} ${RESOURCE_NAMES[k]}`).join(', ');
  return `
  <div class="view-header"><h2>The Road &mdash; ${zone.name}</h2><p>Take a step at a time. Each step costs ${STEP_ENERGY_COST} Energy. Most steps are quiet, some pay off, and every so often something finds you.</p></div>
  <div class="panel" style="margin-bottom:14px;">
    <div class="panel-title">This walk so far</div>
    <div class="stat-list">
      <div><span>XP</span><b>+${g.xp}</b></div>
      <div><span>Gold</span><b>+${g.gold}</b></div>
      <div style="grid-column:1/-1;"><span>Resources</span><b>${resSummary||'&mdash;'}</b></div>
    </div>
  </div>
  <div class="log" style="height:220px;">${road.log.slice().reverse().map(l=>`<div class="log-line ${l.cls||''}">${l.text}</div>`).join('')}</div>
  <div style="display:flex; gap:10px; margin-top:14px;">
    <button class="btn btn-primary btn-block" data-action="take-step" ${c.energyCur<STEP_ENERGY_COST?'disabled':''} style="padding:14px;">${c.energyCur<STEP_ENERGY_COST?'Out of Energy':'Take a Step'}</button>
    <button class="btn" data-action="road-leave">Leave the Road</button>
  </div>`;
}

/* ---------------- Craft ---------------- */
function renderCraft(){
  const c = S.char;
  const eff = effectiveStats(c);
  const cards = RECIPES.map(r=>{
    const max = maxCraftable(c, r);
    const qty = clamp((S.craftQty&&S.craftQty[r.id])||1, 1, Math.max(1,max));
    const reqChips = Object.entries(r.inputs).map(([k,v])=>{
      const have = c.resourceBag[k]||0;
      const need = v*qty;
      const short = have < need;
      return `<span class="req-chip ${short?'short':''}">${(RESOURCE_NAMES[k]||k)[0]} ${have}/${need}</span>`;
    }).join('');
    const energyShort = r.energy && c.energyCur < r.energy*qty;
    const energyChip = r.energy ? `<span class="req-chip ${energyShort?'short':''}">&#9889; ${Math.round(c.energyCur)}/${r.energy*qty}</span>` : '';
    const iconColor = r.out.kind==='consumable' ? 'var(--emerald)' : 'var(--brass)';
    return `<div class="craft-card">
      <div class="row" style="align-items:flex-start;">
        <div class="craft-icon" style="background:${iconColor}22; color:${iconColor}; border-color:${iconColor}55;">${esc(r.name[0])}</div>
        ${r.xp?`<span class="tag" style="border-color:var(--emerald); color:var(--emerald-bright);">+${r.xp*qty}XP</span>`:''}
      </div>
      <div style="margin-top:8px; font-weight:700; color:var(--parchment); font-size:14px;">${esc(r.name)}</div>
      <div class="faint" style="margin-bottom:10px;">Produces ${qty}</div>
      <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px;">${energyChip}${reqChips}</div>
      <div style="display:flex; align-items:center; gap:8px;">
        <div class="qty-stepper">
          <button class="btn btn-sm" data-action="craft-qty-dec" data-recipe="${r.id}" ${qty<=1?'disabled':''}>&minus;</button>
          <span>${qty}</span>
          <button class="btn btn-sm" data-action="craft-qty-inc" data-recipe="${r.id}" ${qty>=max?'disabled':''}>+</button>
        </div>
        <button class="btn btn-sm btn-accent btn-block" data-action="craft" data-recipe="${r.id}" ${max<=0?'disabled':''}>Craft x${qty}</button>
      </div>
    </div>`;
  }).join('');
  const resChips = Object.entries(c.resourceBag).filter(([,v])=>v>0).map(([k,v])=>`<span class="tag" style="margin:0 6px 6px 0;">${RESOURCE_NAMES[k]}: <b style="color:var(--parchment)">${v}</b></span>`).join('') || '<span class="faint">No resources yet &mdash; fight in Adventure zones to gather some.</span>';
  return `
  <div class="view-header row" style="align-items:flex-end;">
    <div><h2>Crafting</h2><p>Turn raw resources and Energy into materials and potions.</p></div>
    <span class="tag">Backpack ${bagCount(c)}/${BAG_CAPACITY}</span>
  </div>
  <div style="margin-bottom:16px;">${resChips}</div>
  <div class="craft-grid">${cards}</div>`;
}

/* ---------------- Inventory ---------------- */
function renderInventory(){
  const c = S.char;
  const slots = EQUIP_SLOTS.map(slot=>{
    const it = c.equipment[slot];
    return `<div class="eq-slot">
      <div class="slot-name">${slot}</div>
      ${it ? `<div style="font-weight:700; color:var(--parchment);">${esc(it.name)} <span class="tag tag-${it.tier}">${it.tier}</span></div>
        <div class="faint">${statsSummary(it.stats)}</div>
        <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn btn-sm" data-action="unequip" data-slot="${slot}">Unequip</button>
          ${upgradeButtonHtml(it, c)}
        </div>`
        : `<div class="faint">Empty</div>`}
    </div>`;
  }).join('');
  const gear = c.inventory.filter(i=>i.kind==='equipment');
  const consumables = c.inventory.filter(i=>i.kind==='consumable');
  const materials = c.inventory.filter(i=>i.kind==='material');
  function statsSummary(st){ if(!st) return ''; return Object.entries(st).map(([k,v])=>`+${v} ${k.toUpperCase()}`).join(', '); }
  function itemCard(it, actions){
    const tierTag = it.tier ? `<span class="tag tag-${it.tier}">${it.tier}</span>` : '';
    return `<div class="item-card">
      <h5>${esc(it.name)} ${tierTag}</h5>
      ${it.stats ? `<div class="faint">${statsSummary(it.stats)}</div>` : ''}
      ${it.qty>1?`<div class="faint">x${it.qty}</div>`:''}
      <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">${actions}</div>
    </div>`;
  }
  const gearCards = gear.map(it=>itemCard(it, `<button class="btn btn-sm btn-accent" data-action="equip" data-uid="${it.uid}">Equip</button><button class="btn btn-sm" data-action="sell" data-uid="${it.uid}">Sell (${sellPrice(it)}g)</button>${upgradeButtonHtml(it, c)}`)).join('') || '<p class="faint">No gear in your bag.</p>';
  const consCards = consumables.map(it=>itemCard(it, `<button class="btn btn-sm btn-accent" data-action="use-item" data-uid="${it.uid}">Use</button>`)).join('') || '<p class="faint">No consumables.</p>';
  const matCards = materials.map(it=>itemCard(it, `<button class="btn btn-sm" data-action="sell" data-uid="${it.uid}">Sell (${sellPrice(it)}g)</button>`)).join('') || '<p class="faint">No materials.</p>';
  return `
  <div class="view-header"><h2>Inventory</h2><p>Bag: ${bagCount(c)}/${BAG_CAPACITY}</p></div>
  <div class="panel-title" style="margin-bottom:10px;">Equipped</div>
  <div class="eq-slots">${slots}</div>
  <div class="panel-title" style="margin-bottom:10px;">Gear</div>
  <div class="inv-grid" style="margin-bottom:18px;">${gearCards}</div>
  <div class="panel-title" style="margin-bottom:10px;">Consumables</div>
  <div class="inv-grid" style="margin-bottom:18px;">${consCards}</div>
  <div class="panel-title" style="margin-bottom:10px;">Materials</div>
  <div class="inv-grid">${matCards}</div>`;
}
function upgradeButtonHtml(it, c){
  const cost = UPGRADE_COSTS[it.tier];
  if(!cost) return ''; // already legendary, or unknown tier
  const nextTier = TIERS[TIER_ORDER.indexOf(it.tier)+1];
  const parts = [];
  let affordable = c.gold >= cost.gold;
  parts.push(cost.gold+'g');
  if(cost.resources){
    Object.entries(cost.resources).forEach(([k,v])=>{
      if((c.resourceBag[k]||0) < v) affordable = false;
      parts.push(`${v} ${RESOURCE_NAMES[k]}`);
    });
  }
  if(cost.materials){
    Object.entries(cost.materials).forEach(([k,v])=>{
      const have = c.inventory.filter(i=>i.kind==='material' && i.id===k).reduce((a,i)=>a+(i.qty||1),0);
      if(have < v) affordable = false;
      parts.push(`${v}x ${k.replace(/_/g,' ')}`);
    });
  }
  return `<button class="btn btn-sm ${affordable?'btn-primary':''}" data-action="upgrade-item" data-uid="${it.uid}" ${affordable?'':'disabled'} title="${parts.join(', ')}">Upgrade &rarr; ${nextTier.name}</button>`;
}
function sellPrice(it){
  if(it.kind==='equipment'){ const tm={common:1,uncommon:1.8,rare:3,epic:5,legendary:8}[it.tier]||1; return Math.round(8*(it.level||1)*tm); }
  if(it.kind==='consumable') return 6;
  return 3;
}

/* ---------------- Profile ---------------- */
function renderProfile(){
  const c = S.char, eff = effectiveStats(c);
  const cls = CLASSES[c.class];
  const genRows = GENERAL_SKILLS.map(gs=>{
    const lvl = c.generalSkills[gs.id];
    const cost = generalSkillCost(lvl);
    const maxed = lvl>=GENERAL_SKILL_MAX;
    return `<div class="skill-row">
      <div>
        <div style="font-weight:700; color:var(--parchment); font-size:13.5px;">${gs.name} <span class="faint">Lv.${lvl}</span></div>
        <div class="faint">${gs.desc}</div>
      </div>
      <button class="btn btn-sm ${maxed?'':'btn-primary'}" data-action="buy-general" data-skill="${gs.id}" ${maxed || c.skillPoints<cost ? 'disabled':''}>${maxed?'Max':cost+' pt'}</button>
    </div>`;
  }).join('');
  const classRows = cls.skills.map(s=>{
    const lvl = c.classSkills[s.id];
    const maxed = lvl>=MAX_SKILL_LEVEL;
    const cost = maxed?0:SKILL_UPGRADE_COST[lvl];
    const pips = Array.from({length:MAX_SKILL_LEVEL},(_,i)=>`<div class="pip ${i<lvl?'on':''}"></div>`).join('');
    return `<div class="skill-row">
      <div style="flex:1;">
        <div style="font-weight:700; color:var(--parchment); font-size:13.5px;">${s.name} <span class="faint">Lv.${lvl}/${MAX_SKILL_LEVEL}</span></div>
        <div class="faint">${s.desc}</div>
        <div class="pip-row">${pips}</div>
      </div>
      <button class="btn btn-sm ${maxed?'':'btn-primary'}" data-action="buy-class-skill" data-skill="${s.id}" ${maxed || c.skillPoints<cost ? 'disabled':''}>${maxed?'Max':cost+' pt'}</button>
    </div>`;
  }).join('');
  return `
  <div class="view-header"><h2>Profile</h2><p>${esc(c.username)} &middot; ${cls.name} &middot; Level ${c.level}</p></div>
  <div class="grid grid-2" style="margin-bottom:16px;">
    <div class="panel">
      <div class="panel-title">Combat stats</div>
      <div class="stat-list">
        <div><span>Max HP</span><b>${eff.maxHp}</b></div>
        <div><span>Attack</span><b>${eff.atk}</b></div>
        <div><span>Defense</span><b>${eff.def}</b></div>
        <div><span>Speed</span><b>${eff.spd}</b></div>
        <div><span>Crit %</span><b>${eff.crit}%</b></div>
        <div><span>Evasion %</span><b>${eff.eva}%</b></div>
        <div><span>Max Energy</span><b>${eff.maxEnergy}</b></div>
        <div><span>Max Mana</span><b>${eff.maxMana}</b></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">PvP record</div>
      <div class="stat-list">
        <div><span>Rating</span><b>${Math.round(c.pvp.rating)}</b></div>
        <div><span>Wins</span><b>${c.pvp.wins}</b></div>
        <div><span>Losses</span><b>${c.pvp.losses}</b></div>
        <div><span>Skill Points</span><b>${c.skillPoints}</b></div>
      </div>
    </div>
  </div>
  <div class="panel" style="margin-bottom:16px;">
    <div class="row" style="margin-bottom:8px;">
      <div class="panel-title" style="margin:0;">Class skills &mdash; ${cls.resource}</div>
      <button class="btn btn-sm btn-danger" data-action="reset-skills">Reset</button>
    </div>
    ${classRows}
  </div>
  <div class="panel">
    <div class="panel-title">General skills</div>
    ${genRows}
  </div>`;
}

/* ---------------- Settings ---------------- */
function renderSettings(){
  const c = S.char;
  return `
  <div class="view-header"><h2>Settings</h2></div>
  <div class="panel" style="margin-bottom:16px;">
    <div class="panel-title">Account</div>
    <div class="stat-list">
      <div><span>Player ID</span><b style="font-size:11px;">${esc(MY_ID.slice(0,14))}&hellip;</b></div>
      <div><span>Storage</span><b>${HAS_DB?'Shared (cross-viewer)':'Local to this browser'}</b></div>
      ${HAS_DB ? `<div><span>Google Account</span><b>${FB_USER_EMAIL ? esc(FB_USER_EMAIL) : 'Not linked'}</b></div>` : ''}
    </div>
    ${HAS_DB && !FB_USER_EMAIL ? `<button class="btn btn-sm" data-action="google-signin" style="margin-top:10px;">Sign in with Google</button>
    <p class="faint" style="margin-top:8px; line-height:1.6;">Link a Google account so your progress follows you to other devices and browsers instead of staying tied to this one.</p>` : ''}
    <p class="faint" style="margin-top:10px; line-height:1.6;">
      This is an in-browser prototype of REALMCLASH MMO's core loop. ${HAS_DB
        ? 'Your character is saved to shared storage, so other people who open this page can be matched against you in the PvP Arena.'
        : 'Real-player matchmaking is unavailable in this view, so PvP opponents are simulated.'}
      Combat is resolved locally rather than by a trusted server, so treat this as a feel-the-loop demo, not a cheat-proof build.
    </p>
  </div>
  <div class="panel">
    <div class="panel-title">Danger zone</div>
    <p class="faint" style="margin-bottom:10px;">Delete this character and start over.</p>
    <button class="btn btn-danger" data-action="reset-character">Delete character</button>
  </div>`;
}

/* ---------------- PvP ---------------- */
let _kingdomFetchInFlight = false;
function renderKingdom(){
  const c = S.char;
  const kv = S.kingdomView;
  if(!kv){
    if(!_kingdomFetchInFlight){ _kingdomFetchInFlight = true; loadKingdomView().finally(()=>{ _kingdomFetchInFlight = false; }); }
    return `<div class="empty"><h3>Loading kingdoms...</h3></div>`;
  }
  if(kv.unavailable){
    return `
    <div class="view-header"><h2>Kingdom</h2></div>
    <div class="panel empty">
      <h3>Shared storage unavailable</h3>
      <p class="faint">Kingdoms need real cross-player storage, which this view doesn't have access to. No fake kingdom data is shown here — try opening this game through its normal Artifact link.</p>
    </div>`;
  }
  if(kv.loading){ return `<div class="empty"><h3>Loading kingdoms...</h3></div>`; }
  if(kv.error){ return `<div class="panel empty"><h3>Couldn't load kingdom data</h3><p class="faint">Please try again.</p><button class="btn btn-primary" style="margin-top:10px;" data-action="nav" data-screen="kingdom">Retry</button></div>`; }

  if(kv.mode==='browse'){
    const cd = (c.kingdomCooldownUntil||0) - Date.now();
    if(cd > 0){
      return `
      <div class="view-header"><h2>Kingdom</h2></div>
      <div class="panel empty">
        <h3>On cooldown</h3>
        <p class="faint">You may join a new kingdom in ${fmtMs(cd)}.</p>
      </div>`;
    }
    const cards = kv.kingdoms.map(k=>`
      <div class="zone-card">
        <div>
          <h4>${k.name}</h4>
          <div class="lvl">Resources: ${k.resources.map(r=>RESOURCE_NAMES[r]||titleCase(r)).join(', ')} &middot; Tax ${k.tax}%</div>
          <div class="faint" style="margin-top:2px;">${k.memberCount} member${k.memberCount===1?'':'s'} &middot; Treasury: ${fmtNum(k.treasury.gold||0)}g</div>
        </div>
        <button class="btn btn-primary btn-sm" data-action="join-kingdom" data-kingdom="${k.id}">Join</button>
      </div>`).join('');
    function titleCase(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
    return `
    <div class="view-header"><h2>Kingdom</h2><p>Join one of six kingdoms. Membership is shared and visible to every player in this game.</p></div>
    ${cards}`;
  }

  // mode === 'mine'
  const k = kv.kingdom;
  const kdef = KINGDOMS.find(x=>x.id===k.id);
  const treasury = k.treasury || {};
  const myRank = kingdomRank(c.kingdomRole);
  const canManageRoles = myRank >= 3;
  const canKick = myRank >= 2;
  const leaderMissing = !k.leaderId;
  const memberRows = kv.members.map(m=>{
    const rank = kingdomRank(m.kingdomRole);
    const isMe = m.id===MY_ID;
    let actions = '';
    if(!isMe && myRank > rank){
      if(canManageRoles){
        actions += `<button class="btn btn-sm" data-action="kingdom-member" data-id="${m.id}" data-op="promote" ${rank>=myRank-1?'disabled':''}>Promote</button>`;
        actions += `<button class="btn btn-sm" data-action="kingdom-member" data-id="${m.id}" data-op="demote" ${rank<=0?'disabled':''}>Demote</button>`;
      }
      if(canKick){
        actions += `<button class="btn btn-sm btn-danger" data-action="kingdom-member" data-id="${m.id}" data-op="kick">Kick</button>`;
      }
    }
    return `<div class="skill-row">
      <div>
        <div style="font-weight:700; color:var(--parchment); font-size:13.5px;">${esc(m.username)} ${isMe?'<span class="faint">(you)</span>':''}</div>
        <div class="faint">Lv.${m.level||1} &middot; ${m.kingdomRole||'Recruit'}</div>
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">${actions}</div>
    </div>`;
  }).join('');
  const treasuryRows = KINGDOM_TREASURY_RESOURCES.map(r=>`<div><span>${r==='gold'?'Gold':RESOURCE_NAMES[r]||r}</span><b>${fmtNum(treasury[r]||0)}</b></div>`).join('');
  const chat = Array.isArray(k.chat) ? k.chat : [];
  const chatLines = chat.slice().reverse().map(m=>`<div class="log-line"><b>${esc(m.senderName)}:</b> ${esc(m.text)}</div>`).join('') || '<div class="faint" style="padding:8px;">No messages yet. Say hello.</div>';

  return `
  <div class="view-header"><h2>${kdef.name}</h2><p>You are a ${c.kingdomRole} &middot; Tax ${kdef.tax}% &middot; Resources: ${kdef.resources.map(r=>RESOURCE_NAMES[r]||r).join(', ')}</p></div>
  ${leaderMissing ? `<div class="panel" style="margin-bottom:14px; border-color:var(--brass);">
    <div class="panel-title">This kingdom has no Leader</div>
    ${myRank>=2 ? `<button class="btn btn-primary btn-sm" data-action="claim-leadership">Claim Leadership</button>` : `<p class="faint">An Officer or above can claim leadership.</p>`}
  </div>` : ''}
  <div class="grid grid-2" style="margin-bottom:16px;">
    <div class="panel">
      <div class="panel-title">Treasury</div>
      <div class="stat-list">${treasuryRows}</div>
      <div class="divider"></div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <button class="btn btn-sm btn-accent" data-action="donate-kingdom" data-resource="gold" data-amount="50">Donate 50 Gold</button>
        <button class="btn btn-sm btn-accent" data-action="donate-kingdom" data-resource="gold" data-amount="200">Donate 200 Gold</button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">Members (${kv.members.length})</div>
      <div style="max-height:220px; overflow-y:auto;">${memberRows}</div>
    </div>
  </div>
  <div class="panel" style="margin-bottom:16px;">
    <div class="panel-title">Kingdom Chat</div>
    <div class="log" id="kingdom-chat-log">${chatLines}</div>
    <div style="display:flex; gap:8px; margin-top:10px;">
      <input type="text" id="kingdom-chat-input" maxlength="200" placeholder="Say something to your kingdom...">
      <button class="btn btn-primary" data-action="kingdom-chat-send">Send</button>
    </div>
  </div>
  <button class="btn btn-danger" data-action="leave-kingdom">Leave Kingdom</button>`;
}

let _marketFetchInFlight = false;
function renderMarket(){
  const c = S.char;
  if(S.marketListings===null){
    if(!_marketFetchInFlight){ _marketFetchInFlight = true; loadMarketListings().finally(()=>{ _marketFetchInFlight = false; }); }
    return `<div class="view-header"><h2>Market</h2></div><div class="empty"><h3>Loading market...</h3></div>`;
  }
  if(S.marketUnavailable){
    return `
    <div class="view-header"><h2>Market</h2></div>
    <div class="panel empty">
      <h3>Shared storage unavailable</h3>
      <p class="faint">The player market needs real cross-player storage, which this view doesn't have access to. No fake listings are shown here.</p>
    </div>`;
  }

  const tabs = `<div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
    <button class="btn btn-sm ${S.marketTab==='browse'?'btn-primary':''}" data-action="market-tab" data-tab="browse">Browse</button>
    <button class="btn btn-sm ${S.marketTab==='sell'?'btn-primary':''}" data-action="market-tab" data-tab="sell">Sell</button>
    <button class="btn btn-sm ${S.marketTab==='mine'?'btn-primary':''}" data-action="market-tab" data-tab="mine">My Listings</button>
  </div>`;

  let body = '';
  if(S.marketTab==='browse'){
    const filters = ['all','resource','material','consumable','equipment'];
    const filterRow = `<div style="display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap;">${filters.map(f=>`<button class="btn btn-sm ${S.marketFilter===f?'btn-accent':''}" data-action="market-filter" data-filter="${f}">${f==='all'?'All':MARKET_KIND_LABELS[f]}</button>`).join('')}</div>`;
    const listings = S.marketListings.filter(l=> S.marketFilter==='all' || l.kind===S.marketFilter);
    const cards = listings.map(l=>{
      const isMine = l.sellerId===MY_ID;
      return `<div class="zone-card">
        <div>
          <h4 style="font-size:14px;">${marketItemLabel(l)}</h4>
          <div class="lvl">Seller: ${esc(l.sellerName)} &middot; ${l.pricePerUnit}g${l.qty>1?' each':''} &middot; Total: ${fmtNum(l.totalPrice)}g</div>
        </div>
        <button class="btn btn-sm ${isMine?'':'btn-primary'}" data-action="buy-listing" data-id="${l.id}" ${isMine?'disabled title="This is your own listing"':''}>${isMine?'Yours':'Buy'}</button>
      </div>`;
    }).join('') || '<div class="panel empty"><h3>No listings</h3><p class="faint">Nothing here yet — check back later or list something yourself.</p></div>';
    body = filterRow + cards;
  } else if(S.marketTab==='sell'){
    const kinds = ['resource','material','consumable','equipment'];
    const kindRow = `<div style="display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap;">${kinds.map(k=>`<button class="btn btn-sm ${S.marketSellKind===k?'btn-accent':''}" data-action="market-sell-kind" data-kind="${k}">${MARKET_KIND_LABELS[k]}</button>`).join('')}</div>`;
    const items = sellableByKind(c, S.marketSellKind);
    const options = items.map(i=>`<option value="${i.id}">${esc(i.name)} (have ${i.have})</option>`).join('') || '<option value="">Nothing available</option>';
    const showQty = S.marketSellKind!=='equipment';
    body = `${kindRow}
    <div class="panel">
      <div class="panel-title">List an item</div>
      ${items.length===0 ? '<p class="faint">You have nothing of this type to sell.</p>' : `
      <label class="field">Item</label>
      <select id="market-sell-item" style="width:100%; background:#171008; border:1px solid var(--border); color:var(--text); padding:11px 13px; border-radius:6px; font-size:14px; margin-bottom:12px;">${options}</select>
      ${showQty ? `<label class="field">Quantity</label><input type="text" id="market-sell-qty" value="1" style="margin-bottom:12px;">` : ''}
      <label class="field">${showQty?'Price per unit (gold)':'Price (gold)'}</label>
      <input type="text" id="market-sell-price" value="10" style="margin-bottom:14px;">
      <button class="btn btn-primary btn-block" data-action="market-create-listing">Create Listing</button>
      `}
    </div>`;
  } else {
    const mine = S.marketListings.filter(l=>l.sellerId===MY_ID);
    body = mine.map(l=>`<div class="zone-card">
      <div>
        <h4 style="font-size:14px;">${marketItemLabel(l)}</h4>
        <div class="lvl">${l.pricePerUnit}g${l.qty>1?' each':''} &middot; Total: ${fmtNum(l.totalPrice)}g</div>
      </div>
      <button class="btn btn-sm btn-danger" data-action="cancel-listing" data-id="${l.id}">Cancel</button>
    </div>`).join('') || '<div class="panel empty"><h3>No active listings</h3><p class="faint">Anything you list will show up here.</p></div>';
  }

  return `
  <div class="view-header"><h2>Market</h2><p>Buy and sell resources, materials, potions and gear with other players. All listings and gold here are real and shared.</p></div>
  ${tabs}
  ${body}`;
}

function renderPvp(){
  const c = S.char;
  const now = Date.now();
  const protectedMs = (c.pvp.protectedUntil||0) - now;
  if(protectedMs > 0){
    return `
    <div class="view-header"><h2>PvP Arena</h2><p>Rating ${Math.round(c.pvp.rating)} &middot; ${c.pvp.wins}W-${c.pvp.losses}L</p></div>
    <div class="panel empty">
      <h3>Under protection</h3>
      <p class="faint">You're shielded from attack after your last loss.</p>
      <p style="margin-top:10px; font-family:var(--font-display); color:var(--brass-bright); font-size:20px;">${fmtMs(protectedMs)}</p>
    </div>`;
  }
  if(c.energyCur < PVP_ENERGY_COST){
    return `
    <div class="view-header"><h2>PvP Arena</h2><p>Rating ${Math.round(c.pvp.rating)} &middot; ${c.pvp.wins}W-${c.pvp.losses}L</p></div>
    <div class="panel empty">
      <h3>Not enough energy</h3>
      <p class="faint">PvP battles cost ${PVP_ENERGY_COST} Energy. Rest or wait for it to regenerate.</p>
    </div>`;
  }
  if(!S.pvpCandidates){
    return `
    <div class="view-header"><h2>PvP Arena</h2><p>Rating ${Math.round(c.pvp.rating)} &middot; ${c.pvp.wins}W-${c.pvp.losses}L</p></div>
    <div class="panel empty">
      <h3>${icon('target','style="width:34px;height:34px;stroke:var(--brass);margin-bottom:10px"')}</h3>
      <h3>Ready to fight?</h3>
      <p class="faint" style="margin-bottom:16px;">Search for an opponent near your level and rating. Costs ${PVP_ENERGY_COST} Energy.</p>
      <button class="btn btn-primary" data-action="find-opponents">Find Opponent</button>
    </div>`;
  }
  const cards = S.pvpCandidates.map((o,i)=>{
    const oc = o.class ? CLASSES[o.class] : null;
    return `<div class="panel" style="margin-bottom:12px;">
      <div class="row">
        <div>
          <h4 style="font-size:15px;">${esc(o.username)} ${o.isBot?'<span class="faint">(unranked bot)</span>':''}</h4>
          <div class="faint">${oc?oc.name:''} &middot; Level ${o.level} &middot; Rating ${Math.round(o.pvp?.rating||1000)}</div>
        </div>
        <button class="btn btn-primary btn-sm" data-action="fight-opponent" data-idx="${i}">Fight</button>
      </div>
    </div>`;
  }).join('');
  return `
  <div class="view-header"><h2>PvP Arena</h2><p>Rating ${Math.round(c.pvp.rating)} &middot; ${c.pvp.wins}W-${c.pvp.losses}L</p></div>
  <div class="panel-title" style="margin-bottom:10px;">Matched opponents</div>
  ${cards}
  <button class="btn" data-action="find-opponents">Search Again</button>`;
}

/* ---------------- Combat screen ---------------- */
function renderCombat(){
  const cb = S.combat;
  if(!cb) return '';
  const me = cb.me, foe = cb.foe;
  const fighterBlock = (f, side)=>{
    const buffs = f.buffs.map(b=>`<span class="buff-chip">${b.tag} ${b.amount>0?'+':''}${b.amount} ${b.stat}</span>`).join('');
    return `<div class="fighter ${side}">
      <h4>${esc(f.label)}</h4>
      <div class="cls">${f.class?CLASSES[f.class].name+' &middot; Lv.'+f.level:'Lv.'+f.level+' Monster'}</div>
      <div class="sb-bar-label"><span>HP</span><span>${Math.max(0,Math.round(f.hp))}/${f.maxHp}</span></div>
      <div class="bar-track" style="margin-bottom:8px;"><div class="bar-fill bar-hp" style="width:${clamp(f.hp/f.maxHp*100,0,100)}%"></div></div>
      ${f.resourceMax>0?`<div class="sb-bar-label"><span>${f.resourceName}</span><span>${Math.round(f.resource)}/${f.resourceMax}</span></div>
      <div class="bar-track"><div class="bar-fill bar-mana" style="width:${clamp(f.resource/f.resourceMax*100,0,100)}%"></div></div>`:''}
      <div class="buff-row">${buffs}</div>
    </div>`;
  };
  let actionsHtml = '';
  if(cb.ended){
    const resultLabel = cb.result==='win' ? '<span class="badge-win">Victory</span>' : cb.result==='lose' ? '<span class="badge-loss">Defeat</span>' : cb.result==='flee' ? '<span class="badge-draw">Fled</span>' : '<span class="badge-draw">Draw</span>';
    actionsHtml = `
    <div class="panel" style="margin-top:14px;">
      <div class="panel-title">${resultLabel}</div>
      <div class="stat-list">
        ${cb.rewardLines.map(l=>`<div style="grid-column:1/-1;"><span>${l.label}</span><b>${l.value}</b></div>`).join('')}
      </div>
      <button class="btn btn-primary btn-block" style="margin-top:14px;" data-action="close-combat">Continue</button>
    </div>`;
  } else {
    const consumables = S.char.inventory.filter(i=>i.kind==='consumable');
    const skillBtns = me.skills.map(s=>{
      const lvl = S.char.classSkills[s.id]||0;
      const afford = me.resource >= s.cost;
      return `<button class="btn act-btn" data-action="combat-skill" data-skill="${s.id}" ${afford?'':'disabled'}>
        <span class="n">${s.name}</span><span class="d">${s.cost} ${me.resourceName} &middot; Lv.${lvl}</span>
      </button>`;
    }).join('');
    const itemBtn = consumables.length ? `<button class="btn act-btn" data-action="combat-item-menu"><span class="n">Use Item</span><span class="d">${consumables.length} available</span></button>` : `<button class="btn act-btn" disabled><span class="n">Use Item</span><span class="d">None in bag</span></button>`;
    actionsHtml = `
    <div class="actions">
      <button class="btn act-btn btn-primary" data-action="combat-attack"><span class="n">Attack</span><span class="d">Basic strike</span></button>
      ${skillBtns}
      <button class="btn act-btn" data-action="combat-defend"><span class="n">Defend</span><span class="d">Reduce incoming damage</span></button>
      ${itemBtn}
      ${cb.mode==='pve' ? `<button class="btn act-btn btn-danger" data-action="combat-flee"><span class="n">Flee</span><span class="d">End the fight</span></button>` : ''}
    </div>
    ${S.showItemMenu ? `<div class="panel" style="margin-top:10px;">
      <div class="panel-title">Choose an item</div>
      ${consumables.map(it=>`<button class="btn btn-sm" style="margin:0 6px 6px 0;" data-action="combat-item" data-uid="${it.uid}">${it.name} (${it.qty})</button>`).join('')}
    </div>`:''}
    `;
  }
  return `
  <div class="view-header"><h2>${cb.mode==='pve'?(cb.boss?'Zone Boss':cb.elite?'Elite Hunt':'Battle'):'PvP Duel'}</h2><p>Round ${cb.round} of ${cb.maxRounds}</p></div>
  <div class="arena">
    ${fighterBlock(me,'me')}
    <div class="vs">VS</div>
    ${fighterBlock(foe,'foe')}
  </div>
  <div class="log" id="combat-log">${cb.log.slice().reverse().map(l=>`<div class="log-line ${l.cls}">${l.text}</div>`).join('')}</div>
  ${actionsHtml}
  `;
}

/* ============================================================
   MAIN RENDER
   ============================================================ */
function render(){
  const app = document.getElementById('app');
  if(S.screen==='loading'){
    app.innerHTML = `<div class="loader-wrap">
      <div class="loader-mark">${icon('crown','style="width:100%;height:100%;stroke:var(--brass)"')}</div>
      <p>ENTERING REALMCLASH MMO</p>
    </div>`;
    return;
  }
  if(S.screen==='login'){
    app.innerHTML = renderLogin();
    return;
  }
  if(S.screen==='create'){
    app.innerHTML = renderCreate();
    bindCreateEvents();
    return;
  }
  let body = '';
  if(S.screen==='home') body = renderHome();
  else if(S.screen==='adventure') body = renderAdventure();
  else if(S.screen==='zone-detail') body = renderZoneDetail();
  else if(S.screen==='road') body = renderRoad();
  else if(S.screen==='combat') body = renderCombat();
  else if(S.screen==='pvp') body = renderPvp();
  else if(S.screen==='kingdom') body = renderKingdom();
  else if(S.screen==='market') body = renderMarket();
  else if(S.screen==='craft') body = renderCraft();
  else if(S.screen==='inventory') body = renderInventory();
  else if(S.screen==='profile') body = renderProfile();
  else if(S.screen==='settings') body = renderSettings();

  const navActive = S.screen==='combat' ? (S.combat && S.combat.mode==='pvp' ? 'pvp':'adventure') : ((S.screen==='road'||S.screen==='zone-detail') ? 'adventure' : S.screen);

  app.innerHTML = `
  <div class="app-shell">
    <div class="sidebar">
      <div class="brand">
        <div class="brand-mark">${icon('crown','style="width:100%;height:100%;stroke:var(--brass-bright)"')}</div>
        <div class="brand-name">REALMCLASH MMO</div>
      </div>
      <div class="navlist">${renderNav(navActive)}</div>
      <div class="nav-foot">PvP-first prototype<br>Core loop demo</div>
    </div>
    <div class="main">
      ${renderStatusBar()}
      <div class="view">${body}</div>
    </div>
  </div>
  <div class="tabbar">${renderTabbar(navActive)}</div>
  ${S.toast ? `<div class="toast">${esc(S.toast)}</div>` : ''}
  ${(S.char && S.char.tutorialSeen===false) ? renderTutorialOverlay() : ''}
  `;
  if(S.screen==='kingdom'){
    const input = document.getElementById('kingdom-chat-input');
    if(input){
      input.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); sendKingdomChat(input.value); } });
    }
  }
}

