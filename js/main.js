"use strict";

/* ============================================================
   EVENT HANDLING
   ============================================================ */
function bindCreateEvents(){
  const input = document.getElementById('username-input');
  if(input){
    input.addEventListener('input', e=>{ S._create.username = e.target.value; });
  }
}

document.addEventListener('click', async (e)=>{
  const el = e.target.closest('[data-action]');
  if(!el) return;
  const action = el.dataset.action;

  if(action==='pick-class'){ S._create.classId = el.dataset.class; render(); return; }
  if(action==='create-character'){
    const st = S._create;
    const uname = (st.username||'').trim().slice(0,18);
    if(!st.classId) return;
    if(uname.length < 3){ showToast('Username must be at least 3 characters.'); return; }
    if(await isUsernameTaken(uname)){ showToast('That username is already taken — pick another.'); return; }
    S.char = newCharacter(MY_ID, uname, st.classId); // no onboarding step — player lands straight on Home
    setScreen('home');
    saveCharacter(S.char); // fire-and-forget: don't hold up entering the game on the network write
    return;
  }
  if(action==='google-signin'){ await linkGoogleAccount(); return; }
  if(action==='nav'){
    setScreen(el.dataset.screen);
    S.pvpCandidates = null;
    if(el.dataset.screen==='kingdom'){ loadKingdomView(); }
    if(el.dataset.screen==='market'){ loadMarketListings(); }
    return;
  }

  if(action==='view-zone'){ S.zoneDetailId = el.dataset.zone; setScreen('zone-detail'); return; }
  if(action==='enter-zone'){ await startAdventureServer(el.dataset.zone, null, {returnScreen:'zone-detail'}); return; }
  if(action==='enter-zone-elite'){ await startAdventureServer(el.dataset.zone, 'elite', {returnScreen:'zone-detail'}); return; }
  if(action==='enter-zone-boss'){ await startAdventureServer(el.dataset.zone, 'boss', {returnScreen:'zone-detail'}); return; }
  if(action==='zone-road'){
    S.road = { zoneId: el.dataset.zone, log:[{text:'You set off down the road.', cls:''}], gained:{xp:0, gold:0, resources:{}} };
    setScreen('road');
    return;
  }
  if(action==='take-step'){ await takeStep(); return; }
  if(action==='road-leave'){ S.road = null; setScreen(S.zoneDetailId ? 'zone-detail' : 'adventure'); return; }
  if(action==='find-opponents'){
    showToast('Searching for an opponent...');
    S.pvpCandidates = await findOpponents(S.char);
    render();
    return;
  }
  if(action==='fight-opponent'){ await startPvp(S.pvpCandidates[Number(el.dataset.idx)]); return; }

  if(action==='join-kingdom'){ await joinKingdom(el.dataset.kingdom); return; }
  if(action==='leave-kingdom'){ await leaveKingdom(); return; }
  if(action==='claim-leadership'){ await claimLeadership(); return; }
  if(action==='donate-kingdom'){ await donateToKingdom(el.dataset.resource, Number(el.dataset.amount)); return; }
  if(action==='kingdom-chat-send'){
    const input = document.getElementById('kingdom-chat-input');
    await sendKingdomChat(input ? input.value : '');
    return;
  }
  if(action==='kingdom-member'){ await kingdomManageMember(el.dataset.id, el.dataset.op); return; }

  if(action==='market-tab'){ S.marketTab = el.dataset.tab; render(); return; }
  if(action==='market-filter'){ S.marketFilter = el.dataset.filter; render(); return; }
  if(action==='market-sell-kind'){ S.marketSellKind = el.dataset.kind; render(); return; }
  if(action==='market-create-listing'){
    const itemSel = document.getElementById('market-sell-item');
    const qtyInput = document.getElementById('market-sell-qty');
    const priceInput = document.getElementById('market-sell-price');
    if(!itemSel || !itemSel.value){ showToast('Nothing to list.'); return; }
    const qty = qtyInput ? parseInt(qtyInput.value,10) : 1;
    const price = priceInput ? parseInt(priceInput.value,10) : 0;
    await createListing(S.marketSellKind, itemSel.value, qty, price);
    return;
  }
  if(action==='buy-listing'){ await buyListing(el.dataset.id); return; }
  if(action==='cancel-listing'){ await cancelListing(el.dataset.id); return; }

  if(action==='combat-attack'){ await (isServerCombat()?resolveCombatRoundServer({kind:'attack'}):resolveRound({kind:'attack'})); return; }
  if(action==='combat-defend'){ await (isServerCombat()?resolveCombatRoundServer({kind:'defend'}):resolveRound({kind:'defend'})); return; }
  if(action==='combat-flee'){ await (isServerCombat()?resolveCombatRoundServer({kind:'flee'}):resolveFlee()); return; }
  if(action==='combat-skill'){
    if(!S.combat) return;
    const s = S.combat.me.skills.find(x=>x.id===el.dataset.skill);
    if(isServerCombat()) await resolveCombatRoundServer({kind:'skill', skillId:s.id});
    else await resolveRound({kind:'skill', skill:s, skillLevel:S.char.classSkills[s.id]||0});
    return;
  }
  if(action==='combat-item-menu'){ S.showItemMenu = !S.showItemMenu; render(); return; }
  if(action==='combat-item'){
    if(isServerCombat()){
      // The server owns the item — it validates ownership, consumes it, and applies
      // its effect (heal or Energy) atomically as part of resolving this round. The
      // client no longer mutates S.char.inventory/energyCur for this directly.
      S.showItemMenu = false;
      await resolveCombatRoundServer({kind:'item', itemUid: el.dataset.uid});
      return;
    }
    const it = S.char.inventory.find(x=>x.uid===el.dataset.uid);
    if(it){
      // Energy isn't part of the in-combat "fighter" model (only HP/class-resource are),
      // so an Energy Potion's effect is applied straight to the character here, capped at
      // Max Energy and without touching lastEnergyAt (so offline regen math stays correct).
      if(it.effect && it.effect.energy){
        const eff = effectiveStats(S.char);
        S.char.energyCur = clamp(S.char.energyCur + it.effect.energy, 0, eff.maxEnergy);
      }
      // Consume exactly one use of the item so potions can't be reused for free.
      it.qty = (it.qty||1) - 1;
      if(it.qty <= 0) S.char.inventory = S.char.inventory.filter(x=>x.uid!==it.uid);
      await resolveRound({kind:'item', item:it});
      S.showItemMenu=false;
    }
    return;
  }
  if(action==='close-combat'){ await finishCombat(); return; }

  if(action==='equip'){ equipItem(el.dataset.uid); await persist(); return; }
  if(action==='unequip'){ unequipSlot(el.dataset.slot); await persist(); return; }
  if(action==='upgrade-item'){ upgradeItem(el.dataset.uid); await persist(); return; }
  if(action==='sell'){ sellItem(el.dataset.uid); await persist(); return; }
  if(action==='use-item'){ useItemOutOfCombat(el.dataset.uid); await persist(); return; }
  if(action==='craft'){ await craftRecipe(el.dataset.recipe, (S.craftQty&&S.craftQty[el.dataset.recipe])||1); await persist(); return; }
  if(action==='craft-qty-inc'){
    S.craftQty = S.craftQty || {};
    const r = RECIPES.find(x=>x.id===el.dataset.recipe);
    const max = Math.max(1, maxCraftable(S.char, r));
    S.craftQty[el.dataset.recipe] = clamp((S.craftQty[el.dataset.recipe]||1)+1, 1, max);
    render(); return;
  }
  if(action==='craft-qty-dec'){
    S.craftQty = S.craftQty || {};
    S.craftQty[el.dataset.recipe] = clamp((S.craftQty[el.dataset.recipe]||1)-1, 1, 999);
    render(); return;
  }

  if(action==='buy-general'){ buyGeneralSkill(el.dataset.skill); await persist(); return; }
  if(action==='buy-class-skill'){ buyClassSkill(el.dataset.skill); await persist(); return; }
  if(action==='reset-skills'){ resetClassSkills(); await persist(); return; }
  if(action==='reset-character'){
    if(confirm('Delete this character permanently?')){
      try{ localStorage.removeItem(LS_KEY_PREFIX+'char_'+MY_ID); }catch(err){}
      if(HAS_DB){ try{ await withTimeout(DB.doc('players/'+MY_ID).delete(), 5000); }catch(err){} }
      S.char = null; S._create=null;
      setScreen('create');
    }
    return;
  }
});

function notEnoughEnergyMsg(c, eff, required){
  return `Not enough Energy. ${required} required, ${Math.floor(c.energyCur)} available (+${energyRegenPerHour(eff.maxEnergy)}/hour).`;
}

/* ---------------- Adventure / PvE flow ---------------- */
async function startPve(zoneId, kind, opts){
  opts = opts || {};
  const c = S.char;
  const eff = effectiveStats(c);
  applyRegen(c);
  const zone = ZONES.find(z=>z.id===zoneId);
  const isBoss = kind==='boss', isElite = kind==='elite';
  const energyCost = opts.skipEnergyCost ? 0 : (isBoss ? BOSS_ENERGY_COST : isElite ? 20 : 10);
  if(c.energyCur < energyCost){ showToast(notEnoughEnergyMsg(c, eff, energyCost)); render(); return; }
  if(isBoss){
    const cd = (c.bossCooldowns[zoneId]||0) - Date.now();
    if(cd > 0){ showToast(`${zone.boss} is still recovering. Try again in ${fmtMs(cd)}.`); render(); return; }
  }
  c.energyCur = clamp(c.energyCur-energyCost, 0, eff.maxEnergy);
  const topLevel = zone.uncapped ? zone.min+80 : zone.max;
  const monsterLevel = isBoss ? clamp(c.level, zone.min, topLevel) : clamp(c.level + rndInt(-2,2) + (isElite?3:0), zone.min, topLevel);
  const monster = isBoss ? buildMonster(zone, monsterLevel, zone.boss, 'boss') : buildMonster(zone, monsterLevel, pick(zone.monsters), isElite?'elite':null);
  const me = buildCombatant(c, true);
  if(isBoss) c.bossCooldowns[zoneId] = Date.now() + BOSS_COOLDOWN_MS;
  S.combat = { mode:'pve', zone, elite:isElite, boss:isBoss, me, foe: monster, round:1, maxRounds:PVE_MAX_ROUNDS, log:[{text: isBoss ? `${monster.label} rises to meet you!` : `A ${monster.label} (Lv.${monster.level}) blocks your path!`, cls:''}], ended:false, result:null, rewardLines:[], returnScreen: opts.returnScreen || 'adventure' };
  setScreen('combat');
}

function isServerCombat(){ return !!(S.combat && S.combat.serverMode); }

// Server-authoritative entry point for the Adventure screen's Explore / Elite Hunt /
// Zone Boss buttons. Energy validation, monster spawning and (once the fight ends)
// all rewards are computed by the startAdventure/resolveCombatRound Cloud Functions —
// this function only displays what the server returns. Road's own monster encounters
// still use the local startPve() above; that path isn't migrated yet.
async function startAdventureServer(zoneId, kind, opts){
  opts = opts || {};
  let res;
  try{
    res = await callFn('startAdventure', {zoneId, kind});
  }catch(e){
    if(e.message==='NOT_ENOUGH_ENERGY'){
      showToast(`Not enough Energy.\nRequired: ${e.details.required}\nAvailable: ${e.details.available}\nRegeneration: +${e.details.perHour} Max Energy/hour`);
    } else if(e.message==='COOLDOWN_ACTIVE'){
      showToast(`Still recovering. Try again in ${fmtMs(e.details.msRemaining)}.`);
    } else {
      showToast('Could not start the fight — please try again.');
    }
    render();
    return;
  }
  S.char.energyCur = res.energyCur;
  S.char.lastEnergyAt = res.lastEnergyAt;
  const zone = ZONES.find(z=>z.id===zoneId);
  S.combat = {
    serverMode: true, sessionId: res.sessionId,
    mode:'pve', zone, elite: kind==='elite', boss: kind==='boss',
    me: res.me, foe: res.foe, round: res.round, maxRounds: res.maxRounds,
    log: res.log, ended:false, result:null, rewardLines:[],
    returnScreen: opts.returnScreen || 'adventure',
  };
  setScreen('combat');
}

// Sends the player's chosen action for the current server-authoritative round and
// renders whatever the server returns. When the fight ends, the local character is
// re-fetched from Firestore rather than trusting any locally-predicted state (spec
// requirement: the client must display authoritative results, not local guesses).
async function resolveCombatRoundServer(action){
  const cb = S.combat;
  if(!cb || cb.ended) return;
  let res;
  try{
    res = await callFn('resolveCombatRound', {sessionId: cb.sessionId, action});
  }catch(e){
    showToast(e.message==='NOT_ENOUGH_RESOURCE' ? 'Not enough resource for that skill.' : 'That action failed — please try again.');
    return;
  }
  cb.log.push(...res.logs);
  cb.me = res.me; cb.foe = res.foe;
  if(res.round) cb.round = res.round;
  if(res.ended){
    cb.ended = true; cb.result = res.result; cb.rewardLines = res.rewardLines;
    const fresh = await loadCharacter();
    if(fresh){ migrateCharacter(fresh); S.char = fresh; }
  }
  render();
  const logEl = document.getElementById('combat-log');
  if(logEl) logEl.scrollTop = 0;
}

function pickStepEvent(){
  const total = STEP_EVENT_WEIGHTS.reduce((a,x)=>a+x.w,0);
  let r = rnd(0,total);
  for(const x of STEP_EVENT_WEIGHTS){ if(r<x.w) return x.t; r-=x.w; }
  return 'flavor';
}
async function takeStep(){
  const c = S.char, road = S.road;
  if(!road) return;
  const eff = effectiveStats(c);
  applyRegen(c);
  if(c.energyCur < STEP_ENERGY_COST){ showToast(notEnoughEnergyMsg(c, eff, STEP_ENERGY_COST)); render(); return; }
  c.energyCur = clamp(c.energyCur - STEP_ENERGY_COST, 0, eff.maxEnergy);
  const zone = ZONES.find(z=>z.id===road.zoneId);
  const ev = pickStepEvent();
  if(ev==='flavor'){
    road.log.push({text: pick(FLAVOR_TEXTS), cls:''});
  } else if(ev==='gold'){
    const amt = rndInt(2,7);
    c.gold += amt; road.gained.gold += amt;
    road.log.push({text:`You spot a few coins in the dirt. +${amt} Gold.`, cls:'good'});
  } else if(ev==='resource'){
    const r = pick(zone.resources);
    const amt = rndInt(1,3);
    c.resourceBag[r] = (c.resourceBag[r]||0) + amt;
    road.gained.resources[r] = (road.gained.resources[r]||0) + amt;
    road.log.push({text:`You gather ${amt} ${RESOURCE_NAMES[r]} along the way.`, cls:'good'});
  } else if(ev==='xp'){
    const amt = rndInt(2,5);
    c.xp += amt; road.gained.xp += amt;
    road.log.push({text:`Something about the walk teaches you a little. +${amt} XP.`, cls:'good'});
    const lvlLines = [];
    await checkLevelUps(c, lvlLines);
    lvlLines.forEach(l=> road.log.push({text: l.value, cls:'good'}));
  } else if(ev==='item'){
    if(bagCount(c) < BAG_CAPACITY){
      const slot = pick(EQUIP_SLOTS);
      const tier = TIERS[0]; // the road only ever turns up common trinkets — save the good stuff for real fights
      const item = makeEquipment(slot, tier.id, c.level);
      c.inventory.push(item);
      road.log.push({text:`You find a discarded ${item.name} by the roadside.`, cls:'good'});
    } else {
      road.log.push({text:`You spot something shiny, but your bag is full.`, cls:''});
    }
  } else if(ev==='monster'){
    road.log.push({text:'Something rustles in the brush ahead...', cls:'hit'});
    saveCharacter(c); // fire-and-forget: don't block entering combat on the network write
    await startPve(road.zoneId, null, {returnScreen:'road', skipEnergyCost:true});
    return;
  }
  render(); // update the screen immediately so the step's result shows without waiting on the network
  saveCharacter(c); // fire-and-forget: persists in the background, doesn't block the UI
}

async function startPvp(opponentData){
  const c = S.char;
  const eff = effectiveStats(c);
  applyRegen(c);
  if(c.energyCur < PVP_ENERGY_COST){ showToast(notEnoughEnergyMsg(c, eff, PVP_ENERGY_COST)); render(); return; }
  c.energyCur = clamp(c.energyCur-PVP_ENERGY_COST, 0, eff.maxEnergy);
  const me = buildCombatant(c, true);
  const foe = buildCombatant(opponentData, false, opponentData.username);
  foe.hp = foe.maxHp;
  S.combat = { mode:'pvp', me, foe, opponentData, round:1, maxRounds:PVP_MAX_ROUNDS, log:[{text:`You enter the Arena against ${esc(opponentData.username)}!`, cls:''}], ended:false, result:null, rewardLines:[], returnScreen:'pvp' };
  setScreen('combat');
}

function addLog(lines){ S.combat.log.push(...lines); }

async function resolveRound(playerAction){
  const cb = S.combat;
  if(!cb || cb.ended) return;
  const me = cb.me, foe = cb.foe;
  // determine order by speed
  const meFirst = liveStat(me,'spd') >= liveStat(foe,'spd');
  const order = meFirst ? [ {who:me, other:foe, act:playerAction, isMe:true}, {who:foe, other:me, act:null, isMe:false} ]
                        : [ {who:foe, other:me, act:null, isMe:false}, {who:me, other:foe, act:playerAction, isMe:true} ];
  for(const turn of order){
    if(me.hp<=0 || foe.hp<=0) break;
    let act = turn.act;
    if(!act){ act = chooseAiAction(turn.who, turn.other); }
    const skillLevel = (act.skill && turn.who.skillLevels) ? (turn.who.skillLevels[act.skill.id]||0) : 0;
    const lines = performAction(turn.who, turn.other, act, skillLevel);
    addLog(lines);
  }
  tickBuffs(me); tickBuffs(foe);
  cb.round += 1;
  if(foe.hp<=0){ await endCombat('win'); return; }
  if(me.hp<=0){ await endCombat('lose'); return; }
  if(cb.round > cb.maxRounds){ await endCombat(me.hp>=foe.hp ? (cb.mode==='pvp'?'win':'flee') : (cb.mode==='pvp'?'lose':'flee')); return; }
  render();
  const logEl = document.getElementById('combat-log');
  if(logEl) logEl.scrollTop = 0;
}

async function resolveFlee(){
  const cb = S.combat;
  if(!cb || cb.ended) return;
  const chance = clamp(50 + (liveStat(cb.me,'spd')-liveStat(cb.foe,'spd'))*2, 15, 90);
  const success = Math.random()*100 < chance;
  addLog([{text: success ? 'You escape the fight.' : 'You failed to escape!', cls: success?'good':'hit'}]);
  if(success){ await endCombat('flee'); }
  else {
    // failed flee costs a round, enemy attacks
    const fleeAct = chooseAiAction(cb.foe, cb.me);
    const fleeSkillLevel = (fleeAct.skill && cb.foe.skillLevels) ? (cb.foe.skillLevels[fleeAct.skill.id]||0) : 0;
    const lines = performAction(cb.foe, cb.me, fleeAct, fleeSkillLevel);
    addLog(lines);
    cb.round += 1;
    if(cb.me.hp<=0){ await endCombat('lose'); return; }
    render();
  }
}

async function endCombat(result){
  const cb = S.combat, c = S.char;
  cb.ended = true; cb.result = result;
  const eff = effectiveStats(c);
  c.hpCur = clamp(cb.me.hp, cb.me.hp<=0?1:0, eff.maxHp) || Math.max(1, Math.round(eff.maxHp*0.2));
  if(c.class==='mage') c.manaCur = clamp(cb.me.resource, 0, eff.maxMana);
  else c.resourceCur = 0;

  if(cb.mode==='pve'){
    if(result==='win'){
      const rewardMult = cb.boss ? 3.2 : cb.elite ? 1.9 : 1;
      const dropChance = cb.boss ? 1 : cb.elite ? 0.55 : 0.35;
      const xpGain = Math.round(rnd(8,14) * cb.foe.level * rewardMult);
      const goldGain = Math.round(rnd(6,12) * cb.foe.level * rewardMult);
      c.xp += xpGain; c.gold += goldGain;
      const resList = cb.zone.resources;
      const resGain = {}; resList.forEach(r=>{ resGain[r] = Math.round(rndInt(2,6)*rewardMult); c.resourceBag[r] = (c.resourceBag[r]||0) + resGain[r]; });
      cb.rewardLines = [ {label:'XP gained', value:'+'+xpGain}, {label:'Gold gained', value:'+'+goldGain}, {label:'Resources', value: resList.map(r=>`+${resGain[r]} ${RESOURCE_NAMES[r]}`).join(', ')} ];
      let dropLine = 'None';
      if(Math.random() < dropChance && bagCount(c) < BAG_CAPACITY){
        const slot = pick(EQUIP_SLOTS);
        const tier = cb.boss ? pickTierForBoss(cb.zone) : pickTierForZone(cb.zone, cb.elite);
        const item = makeEquipment(slot, tier.id, cb.foe.level);
        c.inventory.push(item);
        dropLine = `${item.name} (${tier.name})`;
      } else if(cb.boss && bagCount(c) >= BAG_CAPACITY){
        dropLine = 'Bag full — drop lost!';
      }
      cb.rewardLines.push({label:'Item drop', value: dropLine});
      await checkLevelUps(c, cb.rewardLines);
    } else if(result==='lose'){
      cb.rewardLines = [ {label:'Result', value:'Defeated &mdash; no rewards.'} ];
      c.hpCur = Math.max(1, Math.round(eff.maxHp*0.15));
    } else {
      cb.rewardLines = [ {label:'Result', value:'You retreated safely.'} ];
    }
  } else {
    // PvP
    const myRating = c.pvp.rating;
    const oppRating = cb.opponentData.pvp ? cb.opponentData.pvp.rating : 1000;
    const expected = 1/(1+Math.pow(10, (oppRating-myRating)/400));
    const score = result==='win' ? 1 : result==='lose' ? 0 : 0.5;
    let delta = Math.round(ELO_K * (score-expected));
    if(result==='win' && delta<1) delta = 1;
    if(result==='lose' && delta>-1) delta = -1;
    const newRating = clamp(myRating+delta, RATING_FLOOR, 100000);
    c.pvp.rating = newRating;
    if(result==='win') c.pvp.wins++;
    if(result==='lose'){ c.pvp.losses++; c.pvp.protectedUntil = Date.now() + PVP_PROTECTION_MS; }
    let xpGain = 0, goldChange = 0;
    if(result==='win'){ xpGain = Math.round(rnd(10,18)*cb.opponentData.level); goldChange = Math.round(rnd(8,16)*cb.opponentData.level); c.xp += xpGain; c.gold += goldChange; }
    cb.rewardLines = [
      {label:'Result', value: result==='win'?'Victory':result==='lose'?'Defeat':'Draw'},
      {label:'Rating change', value: (delta>=0?'+':'')+delta+' &rarr; '+Math.round(newRating)},
      {label:'XP gained', value:'+'+xpGain},
      {label:'Gold change', value: (goldChange>=0?'+':'')+goldChange},
      {label:'Rounds', value: String(cb.round-1)},
    ];
    if(result==='lose') cb.rewardLines.push({label:'Protection', value:'5:00 shield granted'});
    if(result==='win') await checkLevelUps(c, cb.rewardLines);

    // best-effort symmetric update to a real opponent's stored doc — fire-and-forget:
    // it doesn't affect what this player sees, so it shouldn't hold up their result screen
    if(HAS_DB && cb.opponentData.id && !cb.opponentData.isBot){
      (async ()=>{
        try{
          const oppExpected = 1-expected;
          const oppScore = 1-score;
          let oppDelta = Math.round(ELO_K*(oppScore-oppExpected));
          const oppRef = DB.doc('players/'+cb.opponentData.id);
          const snap = await withTimeout(oppRef.get(), 5000);
          if(snap.exists){
            const od = snap.data();
            od.pvp = od.pvp || {rating:1000,wins:0,losses:0,protectedUntil:0};
            od.pvp.rating = clamp((od.pvp.rating||1000)+oppDelta, RATING_FLOOR, 100000);
            if(score===1) od.pvp.losses = (od.pvp.losses||0)+1;
            else if(score===0) od.pvp.wins = (od.pvp.wins||0)+1;
            await withTimeout(oppRef.set(od), 5000);
          }
        }catch(err){ /* best effort only */ }
      })();
    }
  }
  render(); // show the result immediately — don't wait on any network write
  saveCharacter(c); // fire-and-forget
}

async function checkLevelUps(c, rewardLines){
  let leveled = 0;
  while(c.xp >= xpNeeded(c.level)){
    c.xp -= xpNeeded(c.level);
    c.level += 1;
    c.skillPoints += 1;
    leveled++;
  }
  if(leveled>0){
    const eff = effectiveStats(c);
    // HP/Mana refill on level-up is intentional (a full-health "fresh start" at the new
    // level). Energy is intentionally NOT refilled here — Energy is the game's core
    // resource economy and must only ever change via combat/regen/potions, never as a
    // level-up side effect (see spec: "Level Up must NOT refill Energy").
    c.hpCur = eff.maxHp; c.manaCur = eff.maxMana;
    c.energyCur = clamp(c.energyCur, 0, eff.maxEnergy);
    rewardLines.push({label:'Level up!', value:`Reached level ${c.level} (+${leveled} skill point${leveled>1?'s':''})`});
  }
}

async function finishCombat(){
  const cb = S.combat;
  const back = (cb && cb.returnScreen) || 'home';
  if(back==='road' && S.road && cb){
    if(cb.result==='win') S.road.log.push({text:`You dealt with the ${cb.foe.label} and continue on.`, cls:'good'});
    else if(cb.result==='lose') S.road.log.push({text:`The ${cb.foe.label} got the better of you. You press on, bruised.`, cls:'hit'});
    else S.road.log.push({text:`You slip away from the ${cb.foe.label} and continue on.`, cls:''});
  }
  S.combat = null; S.showItemMenu = false;
  setScreen(back);
}

/* ---------------- Inventory / equip / craft actions ---------------- */
function equipItem(itemUid){
  const c = S.char;
  const idx = c.inventory.findIndex(i=>i.uid===itemUid);
  if(idx<0) return;
  const item = c.inventory[idx];
  const prev = c.equipment[item.slot];
  c.equipment[item.slot] = item;
  c.inventory.splice(idx,1);
  if(prev) c.inventory.push(prev);
  showToast(`Equipped ${item.name}.`);
}
function unequipSlot(slot){
  const c = S.char;
  const item = c.equipment[slot];
  if(!item) return;
  if(bagCount(c) >= BAG_CAPACITY){ showToast('Bag is full.'); return; }
  c.equipment[slot] = null;
  c.inventory.push(item);
}
function findEquipmentByUid(c, itemUid){
  for(const slot of EQUIP_SLOTS){ if(c.equipment[slot] && c.equipment[slot].uid===itemUid) return c.equipment[slot]; }
  return c.inventory.find(i=>i.uid===itemUid);
}
function upgradeItem(itemUid){
  const c = S.char;
  const item = findEquipmentByUid(c, itemUid);
  if(!item || item.kind!=='equipment') return;
  const cost = UPGRADE_COSTS[item.tier];
  if(!cost){ showToast('This item is already at maximum tier.'); return; }
  let affordable = c.gold >= cost.gold;
  if(cost.resources) Object.entries(cost.resources).forEach(([k,v])=>{ if((c.resourceBag[k]||0) < v) affordable = false; });
  if(cost.materials) Object.entries(cost.materials).forEach(([k,v])=>{
    const have = c.inventory.filter(i=>i.kind==='material' && i.id===k).reduce((a,i)=>a+(i.qty||1),0);
    if(have < v) affordable = false;
  });
  if(!affordable){ showToast('Not enough gold or materials to upgrade this item.'); return; }
  c.gold -= cost.gold;
  if(cost.resources) Object.entries(cost.resources).forEach(([k,v])=>{ c.resourceBag[k] -= v; });
  if(cost.materials) Object.entries(cost.materials).forEach(([k,v])=>{
    let remaining = v;
    c.inventory.forEach(i=>{
      if(remaining<=0 || i.kind!=='material' || i.id!==k) return;
      const take = Math.min(i.qty||1, remaining);
      i.qty = (i.qty||1) - take;
      remaining -= take;
    });
    c.inventory = c.inventory.filter(i=> !(i.kind==='material' && i.id===k && (i.qty||0)<=0));
  });
  const nextTierId = TIER_ORDER[TIER_ORDER.indexOf(item.tier)+1];
  const upgraded = makeEquipment(item.slot, nextTierId, Math.max(item.level||1, c.level));
  item.tier = upgraded.tier; item.name = upgraded.name; item.stats = upgraded.stats; item.level = upgraded.level;
  delete item.starter;
  showToast(`Upgraded to ${TIERS.find(t=>t.id===nextTierId).name}!`);
}
function sellItem(itemUid){
  const c = S.char;
  const idx = c.inventory.findIndex(i=>i.uid===itemUid);
  if(idx<0) return;
  const item = c.inventory[idx];
  c.gold += sellPrice(item);
  c.inventory.splice(idx,1);
  showToast(`Sold ${item.name} for ${sellPrice(item)}g.`);
}
function useItemOutOfCombat(itemUid){
  const c = S.char;
  applyRegen(c); // fresh Energy value before an Energy Potion caps against maxEnergy
  const idx = c.inventory.findIndex(i=>i.uid===itemUid);
  if(idx<0) return;
  const item = c.inventory[idx];
  const eff = effectiveStats(c);
  if(item.effect.heal) c.hpCur = clamp(c.hpCur + Math.round(eff.maxHp*item.effect.heal), 0, eff.maxHp);
  if(item.effect.energy) c.energyCur = clamp(c.energyCur + item.effect.energy, 0, eff.maxEnergy);
  item.qty -= 1;
  if(item.qty<=0) c.inventory.splice(idx,1);
  showToast(`Used ${item.name}.`);
}
function maxCraftable(c, r){
  const eff = effectiveStats(c);
  let max = Infinity;
  Object.entries(r.inputs).forEach(([k,v])=>{ max = Math.min(max, Math.floor((c.resourceBag[k]||0)/v)); });
  if(r.energy) max = Math.min(max, Math.floor(c.energyCur/r.energy));
  return Math.max(0, Number.isFinite(max) ? max : 0);
}
async function craftRecipe(recipeId, qty){
  const c = S.char;
  // Recompute Energy from elapsed time first, so the check below (and the deduction
  // that follows) both use the authoritative, up-to-date value — not a stale one from
  // whenever the crafting screen last rendered.
  applyRegen(c);
  const r = RECIPES.find(x=>x.id===recipeId);
  if(!r) return;
  const eff = effectiveStats(c);
  const max = maxCraftable(c, r);
  qty = clamp(Math.floor(qty||1), 1, Math.max(1,max));
  if(max <= 0){
    if(r.energy && c.energyCur < r.energy){ showToast(notEnoughEnergyMsg(c, eff, r.energy)); return; }
    showToast('Not enough resources.'); return;
  }
  // Bag capacity only actually matters when the output needs a brand-new slot: equipment
  // never stacks, but a material/consumable that already has a stack in the bag (or is
  // being crafted for the first time with room to spare) doesn't need one. Reject the
  // craft only when a new slot is genuinely required and none is free.
  const existing = r.out.kind!=='equipment' ? c.inventory.find(i=>i.kind===r.out.kind && i.id===r.out.id) : null;
  const needsNewSlot = !existing;
  if(needsNewSlot && bagCount(c) >= BAG_CAPACITY){ showToast('Bag is full.'); return; }
  // Atomic from the player's perspective: resources and Energy were both already
  // verified affordable via maxCraftable() above before anything here is deducted,
  // and the total Energy cost (r.energy * qty) is taken exactly once.
  Object.entries(r.inputs).forEach(([k,v])=>{ c.resourceBag[k] -= v*qty; });
  if(r.energy){ c.energyCur = clamp(c.energyCur - r.energy*qty, 0, eff.maxEnergy); }
  if(existing){ existing.qty = (existing.qty||1)+qty; }
  else { c.inventory.push(Object.assign({uid:uid(), qty}, r.out)); }
  if(r.xp){
    c.xp += r.xp*qty;
    const lvlLines = [];
    await checkLevelUps(c, lvlLines);
    lvlLines.forEach(l=> showToast(l.value));
  }
  showToast(`Crafted ${qty}x ${r.out.name}${r.xp?` (+${r.xp*qty} XP)`:''}.`);
}

/* ---------------- Skills ---------------- */
function buyGeneralSkill(skillId){
  const c = S.char;
  const lvl = c.generalSkills[skillId];
  if(lvl>=GENERAL_SKILL_MAX) return;
  const cost = generalSkillCost(lvl);
  if(c.skillPoints < cost) return;
  c.skillPoints -= cost;
  c.generalSkills[skillId] += 1;
  const eff = effectiveStats(c);
  c.hpCur = clamp(c.hpCur, 0, eff.maxHp);
  showToast('Skill improved.');
}
function buyClassSkill(skillId){
  const c = S.char;
  const lvl = c.classSkills[skillId];
  if(lvl>=MAX_SKILL_LEVEL) return;
  const cost = SKILL_UPGRADE_COST[lvl];
  if(c.skillPoints < cost) return;
  c.skillPoints -= cost;
  c.classSkills[skillId] += 1;
  showToast('Skill upgraded.');
}
function resetClassSkills(){
  const c = S.char;
  let refund = 0;
  Object.keys(c.classSkills).forEach(id=>{
    const lvl = c.classSkills[id];
    for(let i=0;i<lvl;i++) refund += SKILL_UPGRADE_COST[i];
    c.classSkills[id] = 0;
  });
  c.skillPoints += refund;
  showToast('Class skills reset.');
}

/* ============================================================
   BOOT
   ============================================================ */
function migrateCharacter(c){
  if(!c.bossCooldowns) c.bossCooldowns = {};
  if(c.kingdomId===undefined) c.kingdomId = null;
  if(c.kingdomRole===undefined) c.kingdomRole = null;
  if(c.kingdomJoinedAt===undefined) c.kingdomJoinedAt = 0;
  if(c.kingdomCooldownUntil===undefined) c.kingdomCooldownUntil = 0;
  if(!c.resourceBag) c.resourceBag = {};
  Object.keys({wood:0,stone:0,food:0,coal:0,iron:0,ore:0,herbs:0,leather:0,frost:0,voidessence:0}).forEach(k=>{
    if(typeof c.resourceBag[k] !== 'number') c.resourceBag[k] = 0;
  });
  return c;
}
async function boot(){
  try{
    await initCapabilities();
    if(HAS_DB && !FB_USER_EMAIL){
      setScreen('login');
      return;
    }
    const existing = await loadCharacter();
    if(existing){
      S.char = migrateCharacter(existing);
      applyRegen(S.char);
      await saveCharacter(S.char);
    }
  }catch(e){
    // Whatever went wrong (capability hiccup, corrupted save, etc.), never leave
    // the player stuck on the loading screen — fall back to a fresh local guest run.
    S.char = null;
  }
  setScreen(S.char ? 'home' : 'create');
  setInterval(()=>{
    if(S.char && S.screen!=='combat' && S.screen!=='kingdom' && S.screen!=='market'){ applyRegen(S.char); render(); }
  }, 20000);
}
render();
boot();
// Absolute last resort: if something outside boot()'s own try/catch still hangs
// (e.g. a capability promise that neither resolves, rejects, nor respects our
// timeout), never leave the player staring at the loading screen forever.
setTimeout(()=>{ if(S.screen==='loading') setScreen(S.char ? 'home' : 'create'); }, 9000);

