"use strict";

/* ============================================================
   UTIL
   ============================================================ */
function rnd(min,max){ return Math.random()*(max-min)+min; }
function rndInt(min,max){ return Math.floor(rnd(min,max+1)); }
function clamp(v,lo,hi){ return Math.max(lo, Math.min(hi, v)); }
function pick(arr){ return arr[rndInt(0, arr.length-1)]; }
function uid(){ return 'x'+Math.random().toString(36).slice(2,10)+Date.now().toString(36); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtNum(n){ return Math.round(n).toLocaleString('en-US'); }
function fmtMs(ms){
  if(ms<=0) return '0:00';
  const s = Math.ceil(ms/1000);
  const m = Math.floor(s/60), r = s%60;
  return m+':'+String(r).padStart(2,'0');
}

/* ============================================================
   CHARACTER MODEL
   ============================================================ */
function newCharacter(id, username, classId){
  const cls = CLASSES[classId];
  const now = Date.now();
  const c = {
    id, username, class: classId, level:1, xp:0,
    gold:150,
    hpCur: cls.base.hp, energyCur:100, resourceCur:0, manaCur:20,
    generalSkills:{health:0,damage:0,defense:0,stamina:0,storage:0},
    classSkills:{}, skillPoints:0,
    equipment:{weapon:null,armor:null,helmet:null,boots:null,gloves:null,accessory:null},
    inventory:[],
    resourceBag:{wood:0,stone:0,food:0,coal:0,iron:0,ore:0,herbs:0,leather:0,frost:0,voidessence:0},
    pvp:{rating:1000, wins:0, losses:0, protectedUntil:0},
    bossCooldowns:{},
    kingdomId:null, kingdomRole:null, kingdomJoinedAt:0, kingdomCooldownUntil:0,
    lastEnergyAt: now, lastHpAt: now, lastManaAt: now,
    createdAt: now, updatedAt: now,
  };
  cls.skills.forEach(s=> c.classSkills[s.id]=0);
  // starting equipment (crude, weak, non-tiered "starter" gear)
  const w = makeEquipment('weapon', 'common', 1); w.name = cls.startEq.weapon; w.starter=true;
  const a = makeEquipment('armor', 'common', 1); a.name = cls.startEq.armor; a.starter=true;
  c.equipment.weapon = w; c.equipment.armor = a;
  return c;
}

function makeEquipment(slot, tierId, level){
  const tier = TIERS.find(t=>t.id===tierId) || TIERS[0];
  const base = 3 + level*1.4;
  const stats = {};
  if(slot==='weapon'){ stats.atk = Math.round(base*1.3*tier.mult); }
  else if(slot==='armor'){ stats.def = Math.round(base*0.85*tier.mult); stats.hp = Math.round(base*3*tier.mult); }
  else if(slot==='helmet'){ stats.def = Math.round(base*0.55*tier.mult); stats.hp = Math.round(base*1.4*tier.mult); }
  else if(slot==='boots'){ stats.spd = Math.round(base*0.5*tier.mult); stats.eva = Math.round(base*0.3*tier.mult); }
  else if(slot==='gloves'){ stats.atk = Math.round(base*0.45*tier.mult); stats.crit = Math.round(base*0.22*tier.mult); }
  else if(slot==='accessory'){ stats.crit = Math.round(base*0.35*tier.mult); stats.eva = Math.round(base*0.35*tier.mult); }
  return {
    uid: uid(), kind:'equipment', slot, tier: tier.id,
    name: tier.name + ' ' + SLOT_NOUN[slot],
    level, stats,
  };
}

function xpNeeded(level){ return XP_FOR_LEVEL(level); }

function effectiveStats(c){
  const cls = CLASSES[c.class];
  const lvl = c.level;
  let hp = cls.base.hp + cls.growth.hp*(lvl-1) + c.generalSkills.health*8;
  let atk = cls.base.atk + cls.growth.atk*(lvl-1) + c.generalSkills.damage*2;
  let def = cls.base.def + cls.growth.def*(lvl-1) + c.generalSkills.defense*2;
  let spd = cls.base.spd + cls.growth.spd*(lvl-1);
  let crit = cls.base.crit + cls.growth.crit*(lvl-1);
  let eva = cls.base.eva + cls.growth.eva*(lvl-1);
  EQUIP_SLOTS.forEach(slot=>{
    const it = c.equipment[slot];
    if(it && it.stats){
      hp += it.stats.hp||0; atk += it.stats.atk||0; def += it.stats.def||0;
      spd += it.stats.spd||0; crit += it.stats.crit||0; eva += it.stats.eva||0;
    }
  });
  const maxEnergy = 100 + c.generalSkills.stamina*6;
  const maxMana = c.class==='mage' ? (20 + lvl*4) : (20 + Math.floor(lvl*0.5));
  const resourceMax = c.class==='mage' ? maxMana : 100;
  const storageCap = 500 + c.generalSkills.storage*40;
  return {
    maxHp: Math.round(hp), atk: Math.round(atk), def: Math.round(def),
    spd: Math.round(spd*10)/10, crit: Math.round(crit*10)/10, eva: Math.round(eva*10)/10,
    maxEnergy: Math.round(maxEnergy), maxMana: Math.round(maxMana),
    resourceMax: Math.round(resourceMax), storageCap: Math.round(storageCap),
  };
}

function bagCount(c){ return c.inventory.length; }
function resourceTotal(c){ return Object.values(c.resourceBag).reduce((a,b)=>a+b,0); }

function applyRegen(c){
  const now = Date.now();
  const eff = effectiveStats(c);
  const eTicks = Math.floor((now - c.lastEnergyAt) / ENERGY_REGEN_MS);
  if(eTicks>0){ c.energyCur = clamp(c.energyCur + eTicks*ENERGY_REGEN_AMT, 0, eff.maxEnergy); c.lastEnergyAt += eTicks*ENERGY_REGEN_MS; }
  const hTicks = Math.floor((now - c.lastHpAt) / HP_REGEN_MS);
  if(hTicks>0){ c.hpCur = clamp(c.hpCur + hTicks*Math.max(1,Math.round(eff.maxHp*HP_REGEN_PCT)), 0, eff.maxHp); c.lastHpAt += hTicks*HP_REGEN_MS; }
  const mTicks = Math.floor((now - c.lastManaAt) / MANA_REGEN_MS);
  if(mTicks>0){ c.manaCur = clamp(c.manaCur + mTicks*MANA_REGEN_AMT, 0, eff.maxMana); c.lastManaAt += mTicks*MANA_REGEN_MS; }
  c.hpCur = clamp(c.hpCur, 0, eff.maxHp);
  c.energyCur = clamp(c.energyCur, 0, eff.maxEnergy);
  if(c.class!=='mage') c.manaCur = clamp(c.manaCur, 0, eff.maxMana);
}

/* ============================================================
   COMBAT ENGINE
   (Written as a self-contained "trusted" module: in a full
   Firebase build this logic runs server-side in a Cloud
   Function; the client would only ever send an action name
   and receive the resolved outcome. In this in-browser
   prototype it runs locally so the loop is instantly playable.)
   ============================================================ */
function buildCombatant(character, isPlayerSide, label){
  const eff = effectiveStats(character);
  const cls = CLASSES[character.class];
  return {
    label: label || character.username,
    isPlayerSide,
    charRef: character,
    class: character.class,
    level: character.level,
    resourceName: cls.resource,
    maxHp: eff.maxHp, hp: isPlayerSide ? clamp(character.hpCur,1,eff.maxHp) : eff.maxHp,
    atk: eff.atk, def: eff.def, spd: eff.spd, crit: eff.crit, eva: eff.eva,
    resourceMax: eff.resourceMax,
    resource: isPlayerSide ? (character.class==='mage' ? clamp(character.manaCur,0,eff.resourceMax) : clamp(character.resourceCur,0,eff.resourceMax)) : Math.round(eff.resourceMax*0.6),
    buffs: [],
    skills: cls.skills,
    skillLevels: character.classSkills || {},
  };
}
function buildMonster(zone, level, name, kind){
  const isBoss = kind==='boss', isElite = kind==='elite';
  const em = isElite ? 1.7 : 1;
  const hpMult = isBoss ? BOSS_MULT.hp : em;
  const atkMult = isBoss ? BOSS_MULT.atk : em;
  const defMult = isBoss ? BOSS_MULT.def : em;
  const hp = Math.round((38 + level*11 + rnd(-4,4)) * hpMult);
  const atk = Math.round((6 + level*2.1 + rnd(-1,1)) * atkMult);
  const def = Math.round((3 + level*1.25 + rnd(-1,1)) * defMult);
  const spdMult = isBoss ? 1.15 : isElite ? 1.15 : 1;
  const spd = Math.round((5 + level*0.75)*10)/10 * spdMult;
  const critVal = isBoss ? 11 : isElite ? 9 : 5;
  const evaVal = isBoss ? 8 : isElite ? 7 : 4;
  const label = isBoss ? name : (isElite ? 'Elite ' : '') + name;
  return {
    label, isPlayerSide:false, class:null, level,
    resourceName:null, maxHp:hp, hp, atk, def, spd, crit:critVal, eva:evaVal,
    resourceMax:0, resource:0, buffs:[], skills:[], isMonster:true, isElite, isBoss,
  };
}
function buildBotOpponent(level, rating){
  const classId = pick(Object.keys(CLASSES));
  const bot = newCharacter('bot_'+uid(), pick(BOT_NAMES), classId);
  bot.level = clamp(level, 1, 200);
  bot.pvp.rating = rating;
  const skillLevel = clamp(Math.floor(bot.level/3), 0, MAX_SKILL_LEVEL);
  CLASSES[classId].skills.forEach(s=> bot.classSkills[s.id] = skillLevel);
  Object.keys(bot.generalSkills).forEach(k=> bot.generalSkills[k] = clamp(Math.floor(bot.level/4),0,GENERAL_SKILL_MAX));
  const gearTier = bot.level>=55?'rare':bot.level>=25?'uncommon':'common';
  EQUIP_SLOTS.forEach(slot=>{ bot.equipment[slot] = makeEquipment(slot, gearTier, bot.level); });
  const eff = effectiveStats(bot);
  bot.hpCur = eff.maxHp; bot.energyCur = eff.maxEnergy; bot.resourceCur = eff.resourceMax; bot.manaCur = eff.maxMana;
  bot.isBot = true;
  return bot;
}

function tickBuffs(fighter){
  fighter.buffs = fighter.buffs.filter(b=>{ b.rounds -= 1; return b.rounds > 0; });
}
function buffTotal(fighter, stat){
  return fighter.buffs.filter(b=>b.stat===stat).reduce((a,b)=>a+b.amount,0);
}
function liveStat(fighter, stat){
  return fighter[stat] + buffTotal(fighter, stat);
}
function rollDamage(att, def, mult, ignoreDefPct, forceCrit, critBonus){
  const atkStat = liveStat(att,'atk') * (mult||1);
  const defStat = liveStat(def,'def') * (1-(ignoreDefPct||0));
  let dmg = Math.max(2, atkStat - defStat*0.5);
  dmg *= rnd(0.87, 1.13);
  const critChance = clamp((liveStat(att,'crit') + (critBonus||0)) , 0, 90);
  const isCrit = forceCrit || (Math.random()*100 < critChance);
  if(isCrit) dmg *= 1.6;
  const evaChance = clamp(liveStat(def,'eva') - liveStat(att,'crit')*0.15, 0, 55);
  const evaded = Math.random()*100 < evaChance;
  if(evaded) dmg = 0;
  return { dmg: Math.round(dmg), crit:isCrit, evaded };
}
function resourceGainOnAttack(fighter){
  if(fighter.resourceMax<=0) return;
  fighter.resource = clamp(fighter.resource + Math.round(fighter.resourceMax*0.15), 0, fighter.resourceMax);
}

// Executes one actor's action against target. Returns log lines (array of {text,cls}).
function performAction(actor, target, action, skillLevel){
  const logs = [];
  const name = actor.label;
  if(action.kind==='attack'){
    const r = rollDamage(actor, target, action.boosted ? 1.5 : 1);
    if(r.evaded){ logs.push({text:`${name}'s attack is evaded by ${target.label}.`, cls:''}); }
    else { target.hp = clamp(target.hp - r.dmg, 0, target.maxHp); logs.push({text: action.boosted ? `${name} unleashes a savage blow for ${r.dmg}${r.crit?' (critical!)':''}!` : `${name} attacks for ${r.dmg}${r.crit?' (critical!)':''}.`, cls:'hit'}); }
    resourceGainOnAttack(actor);
  } else if(action.kind==='defend'){
    actor.buffs.push({stat:'def', amount: Math.round(liveStat(actor,'def')*0.6), rounds:2, tag:'Defend'});
    resourceGainOnAttack(actor);
    logs.push({text:`${name} braces to defend, sharply raising Defense.`, cls:'good'});
  } else if(action.kind==='item'){
    const item = action.item;
    if(item.effect.heal){ const amt = Math.round(actor.maxHp*item.effect.heal); actor.hp = clamp(actor.hp+amt, 0, actor.maxHp); logs.push({text:`${name} drinks a ${item.name}, recovering ${amt} HP.`, cls:'good'}); }
    if(item.effect.energy){ logs.push({text:`${name} drinks a ${item.name}, recovering Energy.`, cls:'good'}); }
  } else if(action.kind==='skill'){
    const s = action.skill;
    const lvl = skillLevel||0;
    actor.resource = clamp(actor.resource - s.cost, 0, actor.resourceMax);
    switch(s.type){
      case 'damage': {
        const mult = s.mult + s.multPerLvl*lvl;
        const r = rollDamage(actor, target, mult);
        if(r.evaded) logs.push({text:`${name} uses ${s.name}, but it's evaded!`, cls:''});
        else { target.hp = clamp(target.hp-r.dmg,0,target.maxHp); logs.push({text:`${name} uses ${s.name} for ${r.dmg}${r.crit?' (critical!)':''}.`, cls:'hit'}); }
        break;
      }
      case 'damage_crit_boost': {
        const mult = s.mult + s.multPerLvl*lvl;
        const r = rollDamage(actor, target, mult, 0, false, s.critBonus);
        if(r.evaded) logs.push({text:`${name} uses ${s.name}, but it's evaded!`, cls:''});
        else { target.hp = clamp(target.hp-r.dmg,0,target.maxHp); logs.push({text:`${name} uses ${s.name} for ${r.dmg}${r.crit?' (critical!)':''}.`, cls:'hit'}); }
        break;
      }
      case 'damage_ignore_def': {
        const mult = s.mult + s.multPerLvl*lvl;
        const r = rollDamage(actor, target, mult, s.ignorePct);
        if(r.evaded) logs.push({text:`${name} uses ${s.name}, but it's evaded!`, cls:''});
        else { target.hp = clamp(target.hp-r.dmg,0,target.maxHp); logs.push({text:`${name} uses ${s.name} for ${r.dmg}, piercing defenses.`, cls:'hit'}); }
        break;
      }
      case 'damage_resource_refund': {
        const mult = s.mult + s.multPerLvl*lvl;
        const r = rollDamage(actor, target, mult);
        actor.resource = clamp(actor.resource + s.refund, 0, actor.resourceMax);
        if(r.evaded) logs.push({text:`${name} uses ${s.name}, but it's evaded!`, cls:''});
        else { target.hp = clamp(target.hp-r.dmg,0,target.maxHp); logs.push({text:`${name} uses ${s.name} for ${r.dmg}, and feels a surge of ${actor.resourceName}.`, cls:'hit'}); }
        break;
      }
      case 'damage_debuff_atk': {
        const mult = s.mult + s.multPerLvl*lvl;
        const r = rollDamage(actor, target, mult);
        target.buffs.push({stat:'atk', amount:-Math.round(liveStat(target,'atk')*s.debuff), rounds:s.duration, tag:s.name});
        if(r.evaded) logs.push({text:`${name} uses ${s.name}, but it's evaded!`, cls:''});
        else { target.hp = clamp(target.hp-r.dmg,0,target.maxHp); logs.push({text:`${name} uses ${s.name} for ${r.dmg}, weakening ${target.label}'s Attack.`, cls:'hit'}); }
        break;
      }
      case 'damage_gold_bonus': {
        const mult = s.mult + s.multPerLvl*lvl;
        const r = rollDamage(actor, target, mult);
        actor._goldBonusPct = s.goldBonusPct;
        if(r.evaded) logs.push({text:`${name} uses ${s.name}, but it's evaded!`, cls:''});
        else { target.hp = clamp(target.hp-r.dmg,0,target.maxHp); logs.push({text:`${name} uses ${s.name} for ${r.dmg}.`, cls:'hit'}); }
        break;
      }
      case 'buff_def': {
        const amt = Math.round(s.amount + s.amountPerLvl*lvl);
        actor.buffs.push({stat:'def', amount:amt, rounds:s.duration, tag:s.name});
        logs.push({text:`${name} uses ${s.name}, raising Defense.`, cls:'good'});
        break;
      }
      case 'buff_atk': {
        const amt = Math.round(s.amount + s.amountPerLvl*lvl);
        actor.buffs.push({stat:'atk', amount:amt, rounds:s.duration, tag:s.name});
        logs.push({text:`${name} uses ${s.name}, raising Attack.`, cls:'good'});
        break;
      }
      case 'buff_spd_eva': {
        const amt = Math.round(s.amount + s.amountPerLvl*lvl);
        actor.buffs.push({stat:'spd', amount:amt, rounds:s.duration, tag:s.name});
        actor.buffs.push({stat:'eva', amount:amt, rounds:s.duration, tag:s.name});
        logs.push({text:`${name} uses ${s.name}, becoming faster and harder to hit.`, cls:'good'});
        break;
      }
      case 'buff_def_resource': {
        const amt = Math.round(s.amount + s.amountPerLvl*lvl);
        actor.buffs.push({stat:'def', amount:amt, rounds:s.duration, tag:s.name});
        actor.resource = clamp(actor.resource + s.refund, 0, actor.resourceMax);
        logs.push({text:`${name} uses ${s.name}, raising Defense and recovering ${actor.resourceName}.`, cls:'good'});
        break;
      }
      case 'heal': {
        const pct = s.pct + s.pctPerLvl*lvl;
        const amt = Math.round(actor.maxHp*pct);
        actor.hp = clamp(actor.hp+amt, 0, actor.maxHp);
        logs.push({text:`${name} uses ${s.name}, recovering ${amt} HP.`, cls:'good'});
        break;
      }
      case 'heal_and_def': {
        const pct = s.pct + s.pctPerLvl*lvl;
        const amt = Math.round(actor.maxHp*pct);
        actor.hp = clamp(actor.hp+amt, 0, actor.maxHp);
        actor.buffs.push({stat:'def', amount:s.defAmount, rounds:s.duration, tag:s.name});
        logs.push({text:`${name} uses ${s.name}, recovering ${amt} HP and raising Defense.`, cls:'good'});
        break;
      }
    }
  } else if(action.kind==='flee'){
    logs.push({text:`${name} attempts to flee...`, cls:''});
  }
  return logs;
}

function chooseAiAction(actor, target){
  const hpPct = actor.hp/actor.maxHp;
  const affordable = actor.skills.filter(s=> actor.resource >= s.cost);
  if(hpPct < 0.3 && affordable.some(s=>/heal/.test(s.type))){
    const s = affordable.find(x=>/heal/.test(x.type));
    return {kind:'skill', skill:s};
  }
  if(actor.isMonster){
    if(Math.random() < (actor.isBoss ? 0.3 : 0.22)) return {kind:'attack', boosted:true};
    return {kind:'attack'};
  }
  if(affordable.length && Math.random()<0.6){
    return {kind:'skill', skill: pick(affordable)};
  }
  if(hpPct < 0.35 && Math.random()<0.3){
    return {kind:'defend'};
  }
  return {kind:'attack'};
}

