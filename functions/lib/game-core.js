"use strict";
/* ============================================================
   SERVER-SIDE GAME CORE
   This is a Node/CommonJS port of the PURE (no-DOM) formulas from
   js/config.js and js/engine.js. It must be kept in sync with those
   files by hand — there is no build step that shares them between
   the browser bundle and Cloud Functions in this project.
   Only what PvE/Elite/Boss combat + rewards need is included.
   ============================================================ */

function rnd(min, max) { return Math.random() * (max - min) + min; }
function rndInt(min, max) { return Math.floor(rnd(min, max + 1)); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function pick(arr) { return arr[rndInt(0, arr.length - 1)]; }
function uid() { return 'x' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

/* ---- config.js subset ---- */
const XP_FOR_LEVEL = (lvl) => Math.round(35 * Math.pow(lvl, 1.4));
const BAG_CAPACITY = 40;
const PVE_MAX_ROUNDS = 30;
const ELO_K = 32; // unused here (PvP not yet migrated), kept for parity
const RATING_FLOOR = 100;
const ENERGY_REGEN_RATE_PER_HOUR = 0.2;
function energyRegenPerHour(maxEnergy) { return Math.round(maxEnergy * ENERGY_REGEN_RATE_PER_HOUR); }

const CLASSES = {
  warrior: { id: 'warrior', name: 'Warrior', resource: 'Rage',
    base: { hp: 130, atk: 13, def: 12, spd: 7, crit: 4, eva: 3 },
    growth: { hp: 15, atk: 2.1, def: 2.0, spd: 0.35, crit: 0.12, eva: 0.10 },
    skills: [
      { id: 'power_strike', name: 'Power Strike', cost: 20, type: 'damage', mult: 1.55, multPerLvl: 0.05 },
      { id: 'iron_armor', name: 'Iron Armor', cost: 15, type: 'buff_def', amount: 9, amountPerLvl: 3, duration: 3 },
      { id: 'warrior_spirit', name: 'Warrior Spirit', cost: 25, type: 'heal', pct: 0.09, pctPerLvl: 0.012 },
    ] },
  archer: { id: 'archer', name: 'Archer', resource: 'Precision',
    base: { hp: 95, atk: 15, def: 6, spd: 13, crit: 14, eva: 12 },
    growth: { hp: 9, atk: 2.3, def: 1.0, spd: 0.55, crit: 0.35, eva: 0.30 },
    skills: [
      { id: 'keen_eye', name: 'Keen Eye', cost: 20, type: 'damage_crit_boost', mult: 1.45, multPerLvl: 0.05, critBonus: 25 },
      { id: 'swiftness', name: 'Swiftness', cost: 15, type: 'buff_spd_eva', amount: 6, amountPerLvl: 1.4, duration: 3 },
      { id: 'efficient_aim', name: 'Efficient Aim', cost: 20, type: 'damage_ignore_def', mult: 1.3, multPerLvl: 0.04, ignorePct: 0.5 },
    ] },
  mage: { id: 'mage', name: 'Mage', resource: 'Mana',
    base: { hp: 78, atk: 19, def: 4, spd: 9, crit: 8, eva: 5 },
    growth: { hp: 7, atk: 2.9, def: 0.7, spd: 0.30, crit: 0.20, eva: 0.15 },
    skills: [
      { id: 'arcane_power', name: 'Arcane Power', cost: 16, type: 'damage', mult: 2.0, multPerLvl: 0.07 },
      { id: 'magic_shield', name: 'Magic Shield', cost: 12, type: 'buff_def', amount: 14, amountPerLvl: 3.4, duration: 2 },
      { id: 'mana_force', name: 'Mana Force', cost: 10, type: 'damage_resource_refund', mult: 1.35, multPerLvl: 0.05, refund: 12 },
    ] },
  commander: { id: 'commander', name: 'Commander', resource: 'Command Points',
    base: { hp: 135, atk: 12, def: 14, spd: 7, crit: 5, eva: 4 },
    growth: { hp: 16, atk: 1.9, def: 2.3, spd: 0.30, crit: 0.15, eva: 0.12 },
    skills: [
      { id: 'war_banner', name: 'War Banner', cost: 20, type: 'buff_atk', amount: 7, amountPerLvl: 1.8, duration: 3 },
      { id: 'iron_will', name: 'Iron Will', cost: 20, type: 'heal_and_def', pct: 0.06, pctPerLvl: 0.008, defAmount: 8, duration: 2 },
      { id: 'command_aura', name: 'Command Aura', cost: 20, type: 'damage_debuff_atk', mult: 1.35, multPerLvl: 0.04, debuff: 0.2, duration: 2 },
    ] },
  merchant: { id: 'merchant', name: 'Merchant', resource: 'Fortune',
    base: { hp: 100, atk: 12, def: 9, spd: 9, crit: 8, eva: 7 },
    growth: { hp: 11, atk: 2.0, def: 1.4, spd: 0.35, crit: 0.22, eva: 0.18 },
    skills: [
      { id: 'profitable_deal', name: 'Profitable Deal', cost: 15, type: 'damage_gold_bonus', mult: 1.4, multPerLvl: 0.05, goldBonusPct: 0.4 },
      { id: 'deep_pockets', name: 'Deep Pockets', cost: 10, type: 'buff_def_resource', amount: 7, amountPerLvl: 1.6, duration: 3, refund: 15 },
      { id: 'lucky', name: 'Lucky', cost: 15, type: 'damage_crit_boost', mult: 1.3, multPerLvl: 0.04, critBonus: 30 },
    ] },
};

const ZONES = [
  { id: 'plains', name: 'Plains', min: 1, max: 10, monsters: ['Wild Boar', 'Field Rat', 'Bandit Scout'], resources: ['wood', 'food'], boss: 'Grukk the Boarking', dropTable: [{ t: 'common', w: 75 }, { t: 'uncommon', w: 23 }, { t: 'rare', w: 2 }] },
  { id: 'forest', name: 'Forest', min: 10, max: 25, monsters: ['Dire Wolf', 'Forest Troll', 'Rogue Archer'], resources: ['wood', 'herbs'], boss: 'Malrend, Heart of the Wood', dropTable: [{ t: 'common', w: 60 }, { t: 'uncommon', w: 32 }, { t: 'rare', w: 8 }] },
  { id: 'mountain', name: 'Mountain', min: 25, max: 40, monsters: ['Rock Golem', 'Mountain Harpy', 'Iron Bandit'], resources: ['stone', 'iron'], boss: 'Thorrgun, the Cliff Titan', dropTable: [{ t: 'common', w: 45 }, { t: 'uncommon', w: 35 }, { t: 'rare', w: 18 }, { t: 'epic', w: 2 }] },
  { id: 'cave', name: 'Cave', min: 40, max: 55, monsters: ['Cave Spider', 'Bat Swarm', 'Gloom Wraith'], resources: ['coal', 'iron'], boss: 'Skarn, Lord of the Deep', dropTable: [{ t: 'common', w: 35 }, { t: 'uncommon', w: 35 }, { t: 'rare', w: 25 }, { t: 'epic', w: 5 }] },
  { id: 'swamp', name: 'Swamp', min: 55, max: 70, monsters: ['Bog Serpent', 'Swamp Witch', 'Rot Beast'], resources: ['herbs', 'leather'], boss: 'Vessyr the Rotmother', dropTable: [{ t: 'common', w: 20 }, { t: 'uncommon', w: 35 }, { t: 'rare', w: 32 }, { t: 'epic', w: 12 }, { t: 'legendary', w: 1 }] },
  { id: 'darkzone', name: 'Dark Zone', min: 70, max: 100, monsters: ['Shadow Knight', 'Void Reaver', 'Nightmare Construct'], resources: ['iron', 'ore'], boss: 'Kaelthorn, the Hollow King', dropTable: [{ t: 'common', w: 10 }, { t: 'uncommon', w: 25 }, { t: 'rare', w: 35 }, { t: 'epic', w: 25 }, { t: 'legendary', w: 5 }] },
  { id: 'frozen', name: 'Frozen Wastes', min: 100, max: 150, monsters: ['Frost Wraith', 'Ice Golem', 'Winter Stalker'], resources: ['frost', 'iron'], boss: 'Ysmera, the Everfrost Queen', dropTable: [{ t: 'uncommon', w: 10 }, { t: 'rare', w: 35 }, { t: 'epic', w: 40 }, { t: 'legendary', w: 15 }] },
  { id: 'abyss', name: 'Abyssal Rift', min: 150, max: 300, uncapped: true, monsters: ['Abyssal Horror', 'Void Sentinel', 'Nether Devourer'], resources: ['voidessence', 'ore'], boss: 'Nyxul, Devourer of Light', dropTable: [{ t: 'rare', w: 10 }, { t: 'epic', w: 40 }, { t: 'legendary', w: 50 }] },
];

const EQUIP_SLOTS = ['weapon', 'armor', 'helmet', 'boots', 'gloves', 'accessory'];
const SLOT_NOUN = { weapon: 'Blade', armor: 'Plate', helmet: 'Helm', boots: 'Boots', gloves: 'Gauntlets', accessory: 'Charm' };
const TIERS = [
  { id: 'common', name: 'Common', mult: 1.0 },
  { id: 'uncommon', name: 'Uncommon', mult: 1.35 },
  { id: 'rare', name: 'Rare', mult: 1.8 },
  { id: 'epic', name: 'Epic', mult: 2.4 },
  { id: 'legendary', name: 'Legendary', mult: 3.3 },
];
const BOSS_ENERGY_COST = 30;
const BOSS_COOLDOWN_MS = 30 * 60 * 1000;
const BOSS_MULT = { hp: 2.3, atk: 1.35, def: 1.2 };

function pickTierForBoss(zone) {
  const pool = zone.dropTable.slice(-2);
  const total = pool.reduce((a, x) => a + x.w, 0) || 1;
  let r = rnd(0, total);
  for (const x of pool) { if (r < x.w) return TIERS.find(t => t.id === x.t); r -= x.w; }
  return TIERS.find(t => t.id === pool[pool.length - 1].t);
}
function pickTierForZone(zone, elite) {
  let table = zone.dropTable.map(x => Object.assign({}, x));
  if (elite) {
    table = table.map(x => {
      if (x.t === 'common') return { t: x.t, w: Math.max(1, Math.round(x.w * 0.35)) };
      if (x.t === 'epic' || x.t === 'legendary') return { t: x.t, w: Math.round(x.w * 1.8) };
      return x;
    });
  }
  const total = table.reduce((a, x) => a + x.w, 0);
  let r = rnd(0, total);
  for (const x of table) { if (r < x.w) return TIERS.find(t => t.id === x.t); r -= x.w; }
  return TIERS.find(t => t.id === table[0].t) || TIERS[0];
}
function makeEquipment(slot, tierId, level) {
  const tier = TIERS.find(t => t.id === tierId) || TIERS[0];
  const base = 3 + level * 1.4;
  const stats = {};
  if (slot === 'weapon') { stats.atk = Math.round(base * 1.3 * tier.mult); }
  else if (slot === 'armor') { stats.def = Math.round(base * 0.85 * tier.mult); stats.hp = Math.round(base * 3 * tier.mult); }
  else if (slot === 'helmet') { stats.def = Math.round(base * 0.55 * tier.mult); stats.hp = Math.round(base * 1.4 * tier.mult); }
  else if (slot === 'boots') { stats.spd = Math.round(base * 0.5 * tier.mult); stats.eva = Math.round(base * 0.3 * tier.mult); }
  else if (slot === 'gloves') { stats.atk = Math.round(base * 0.45 * tier.mult); stats.crit = Math.round(base * 0.22 * tier.mult); }
  else if (slot === 'accessory') { stats.crit = Math.round(base * 0.35 * tier.mult); stats.eva = Math.round(base * 0.35 * tier.mult); }
  return { uid: uid(), kind: 'equipment', slot, tier: tier.id, name: tier.name + ' ' + SLOT_NOUN[slot], level, stats };
}

/* ---- engine.js subset ---- */
function xpNeeded(level) { return XP_FOR_LEVEL(level); }

function effectiveStats(c) {
  const cls = CLASSES[c.class];
  const lvl = c.level;
  let hp = cls.base.hp + cls.growth.hp * (lvl - 1) + c.generalSkills.health * 8;
  let atk = cls.base.atk + cls.growth.atk * (lvl - 1) + c.generalSkills.damage * 2;
  let def = cls.base.def + cls.growth.def * (lvl - 1) + c.generalSkills.defense * 2;
  let spd = cls.base.spd + cls.growth.spd * (lvl - 1);
  let crit = cls.base.crit + cls.growth.crit * (lvl - 1);
  let eva = cls.base.eva + cls.growth.eva * (lvl - 1);
  EQUIP_SLOTS.forEach(slot => {
    const it = c.equipment[slot];
    if (it && it.stats) {
      hp += it.stats.hp || 0; atk += it.stats.atk || 0; def += it.stats.def || 0;
      spd += it.stats.spd || 0; crit += it.stats.crit || 0; eva += it.stats.eva || 0;
    }
  });
  const maxEnergy = 100 + c.generalSkills.stamina * 6;
  const maxMana = c.class === 'mage' ? (20 + lvl * 4) : (20 + Math.floor(lvl * 0.5));
  const resourceMax = c.class === 'mage' ? maxMana : 100;
  return {
    maxHp: Math.round(hp), atk: Math.round(atk), def: Math.round(def),
    spd: Math.round(spd * 10) / 10, crit: Math.round(crit * 10) / 10, eva: Math.round(eva * 10) / 10,
    maxEnergy: Math.round(maxEnergy), maxMana: Math.round(maxMana), resourceMax: Math.round(resourceMax),
  };
}

function applyEnergyRegen(c) {
  const now = Date.now();
  const eff = effectiveStats(c);
  const elapsedMs = Math.max(0, now - (c.lastEnergyAt || now));
  let energyCur = c.energyCur || 0;
  if (elapsedMs > 0) {
    const gained = elapsedMs * (ENERGY_REGEN_RATE_PER_HOUR * eff.maxEnergy) / (60 * 60 * 1000);
    energyCur = clamp(energyCur + gained, 0, eff.maxEnergy);
  }
  return { energyCur: clamp(energyCur, 0, eff.maxEnergy), maxEnergy: eff.maxEnergy, now };
}

function buildCombatant(character, isPlayerSide, label) {
  const eff = effectiveStats(character);
  const cls = CLASSES[character.class];
  return {
    label: label || character.username, isPlayerSide, class: character.class, level: character.level,
    resourceName: cls.resource, maxHp: eff.maxHp,
    hp: isPlayerSide ? clamp(character.hpCur, 1, eff.maxHp) : eff.maxHp,
    atk: eff.atk, def: eff.def, spd: eff.spd, crit: eff.crit, eva: eff.eva,
    resourceMax: eff.resourceMax,
    resource: isPlayerSide ? (character.class === 'mage' ? clamp(character.manaCur, 0, eff.resourceMax) : clamp(character.resourceCur, 0, eff.resourceMax)) : Math.round(eff.resourceMax * 0.6),
    buffs: [], skills: cls.skills, skillLevels: character.classSkills || {},
  };
}
function buildMonster(zone, level, name, kind) {
  const isBoss = kind === 'boss', isElite = kind === 'elite';
  const em = isElite ? 1.7 : 1;
  const hpMult = isBoss ? BOSS_MULT.hp : em, atkMult = isBoss ? BOSS_MULT.atk : em, defMult = isBoss ? BOSS_MULT.def : em;
  const hp = Math.round((38 + level * 11 + rnd(-4, 4)) * hpMult);
  const atk = Math.round((6 + level * 2.1 + rnd(-1, 1)) * atkMult);
  const def = Math.round((3 + level * 1.25 + rnd(-1, 1)) * defMult);
  const spdMult = isBoss ? 1.15 : isElite ? 1.15 : 1;
  const spd = Math.round((5 + level * 0.75) * 10) / 10 * spdMult;
  const critVal = isBoss ? 11 : isElite ? 9 : 5, evaVal = isBoss ? 8 : isElite ? 7 : 4;
  const label = isBoss ? name : (isElite ? 'Elite ' : '') + name;
  return { label, isPlayerSide: false, class: null, level, resourceName: null, maxHp: hp, hp, atk, def, spd, crit: critVal, eva: evaVal, resourceMax: 0, resource: 0, buffs: [], skills: [], isMonster: true, isElite, isBoss };
}

function tickBuffs(f) { f.buffs = f.buffs.filter(b => { b.rounds -= 1; return b.rounds > 0; }); }
function buffTotal(f, stat) { return f.buffs.filter(b => b.stat === stat).reduce((a, b) => a + b.amount, 0); }
function liveStat(f, stat) { return f[stat] + buffTotal(f, stat); }
function rollDamage(att, def, mult, ignoreDefPct, forceCrit, critBonus) {
  const atkStat = liveStat(att, 'atk') * (mult || 1);
  const defStat = liveStat(def, 'def') * (1 - (ignoreDefPct || 0));
  let dmg = Math.max(2, atkStat - defStat * 0.5);
  dmg *= rnd(0.87, 1.13);
  const critChance = clamp((liveStat(att, 'crit') + (critBonus || 0)), 0, 90);
  const isCrit = forceCrit || (Math.random() * 100 < critChance);
  if (isCrit) dmg *= 1.6;
  const evaChance = clamp(liveStat(def, 'eva') - liveStat(att, 'crit') * 0.15, 0, 55);
  const evaded = Math.random() * 100 < evaChance;
  if (evaded) dmg = 0;
  return { dmg: Math.round(dmg), crit: isCrit, evaded };
}
function resourceGainOnAttack(f) { if (f.resourceMax > 0) f.resource = clamp(f.resource + Math.round(f.resourceMax * 0.15), 0, f.resourceMax); }

function performAction(actor, target, action, skillLevel) {
  const logs = []; const name = actor.label;
  if (action.kind === 'attack') {
    const r = rollDamage(actor, target, action.boosted ? 1.5 : 1);
    if (r.evaded) logs.push({ text: `${name}'s attack is evaded by ${target.label}.`, cls: '' });
    else { target.hp = clamp(target.hp - r.dmg, 0, target.maxHp); logs.push({ text: `${name} attacks for ${r.dmg}${r.crit ? ' (critical!)' : ''}.`, cls: 'hit' }); }
    resourceGainOnAttack(actor);
  } else if (action.kind === 'defend') {
    actor.buffs.push({ stat: 'def', amount: Math.round(liveStat(actor, 'def') * 0.6), rounds: 2, tag: 'Defend' });
    resourceGainOnAttack(actor);
    logs.push({ text: `${name} braces to defend, sharply raising Defense.`, cls: 'good' });
  } else if (action.kind === 'item') {
    const item = action.item;
    if (item.effect.heal) { const amt = Math.round(actor.maxHp * item.effect.heal); actor.hp = clamp(actor.hp + amt, 0, actor.maxHp); logs.push({ text: `${name} drinks a ${item.name}, recovering ${amt} HP.`, cls: 'good' }); }
    if (item.effect.energy) { logs.push({ text: `${name} drinks a ${item.name}, recovering Energy.`, cls: 'good' }); }
  } else if (action.kind === 'skill') {
    const s = action.skill; const lvl = skillLevel || 0;
    actor.resource = clamp(actor.resource - s.cost, 0, actor.resourceMax);
    switch (s.type) {
      case 'damage': { const mult = s.mult + s.multPerLvl * lvl; const r = rollDamage(actor, target, mult); if (r.evaded) logs.push({ text: `${name} uses ${s.name}, but it's evaded!`, cls: '' }); else { target.hp = clamp(target.hp - r.dmg, 0, target.maxHp); logs.push({ text: `${name} uses ${s.name} for ${r.dmg}${r.crit ? ' (critical!)' : ''}.`, cls: 'hit' }); } break; }
      case 'damage_crit_boost': { const mult = s.mult + s.multPerLvl * lvl; const r = rollDamage(actor, target, mult, 0, false, s.critBonus); if (r.evaded) logs.push({ text: `${name} uses ${s.name}, but it's evaded!`, cls: '' }); else { target.hp = clamp(target.hp - r.dmg, 0, target.maxHp); logs.push({ text: `${name} uses ${s.name} for ${r.dmg}${r.crit ? ' (critical!)' : ''}.`, cls: 'hit' }); } break; }
      case 'damage_ignore_def': { const mult = s.mult + s.multPerLvl * lvl; const r = rollDamage(actor, target, mult, s.ignorePct); if (r.evaded) logs.push({ text: `${name} uses ${s.name}, but it's evaded!`, cls: '' }); else { target.hp = clamp(target.hp - r.dmg, 0, target.maxHp); logs.push({ text: `${name} uses ${s.name} for ${r.dmg}, piercing defenses.`, cls: 'hit' }); } break; }
      case 'damage_resource_refund': { const mult = s.mult + s.multPerLvl * lvl; const r = rollDamage(actor, target, mult); actor.resource = clamp(actor.resource + s.refund, 0, actor.resourceMax); if (r.evaded) logs.push({ text: `${name} uses ${s.name}, but it's evaded!`, cls: '' }); else { target.hp = clamp(target.hp - r.dmg, 0, target.maxHp); logs.push({ text: `${name} uses ${s.name} for ${r.dmg}, and feels a surge of ${actor.resourceName}.`, cls: 'hit' }); } break; }
      case 'damage_debuff_atk': { const mult = s.mult + s.multPerLvl * lvl; const r = rollDamage(actor, target, mult); target.buffs.push({ stat: 'atk', amount: -Math.round(liveStat(target, 'atk') * s.debuff), rounds: s.duration, tag: s.name }); if (r.evaded) logs.push({ text: `${name} uses ${s.name}, but it's evaded!`, cls: '' }); else { target.hp = clamp(target.hp - r.dmg, 0, target.maxHp); logs.push({ text: `${name} uses ${s.name} for ${r.dmg}, weakening ${target.label}'s Attack.`, cls: 'hit' }); } break; }
      case 'damage_gold_bonus': { const mult = s.mult + s.multPerLvl * lvl; const r = rollDamage(actor, target, mult); actor._goldBonusPct = s.goldBonusPct; if (r.evaded) logs.push({ text: `${name} uses ${s.name}, but it's evaded!`, cls: '' }); else { target.hp = clamp(target.hp - r.dmg, 0, target.maxHp); logs.push({ text: `${name} uses ${s.name} for ${r.dmg}.`, cls: 'hit' }); } break; }
      case 'buff_def': { const amt = Math.round(s.amount + s.amountPerLvl * lvl); actor.buffs.push({ stat: 'def', amount: amt, rounds: s.duration, tag: s.name }); logs.push({ text: `${name} uses ${s.name}, raising Defense.`, cls: 'good' }); break; }
      case 'buff_atk': { const amt = Math.round(s.amount + s.amountPerLvl * lvl); actor.buffs.push({ stat: 'atk', amount: amt, rounds: s.duration, tag: s.name }); logs.push({ text: `${name} uses ${s.name}, raising Attack.`, cls: 'good' }); break; }
      case 'buff_spd_eva': { const amt = Math.round(s.amount + s.amountPerLvl * lvl); actor.buffs.push({ stat: 'spd', amount: amt, rounds: s.duration, tag: s.name }); actor.buffs.push({ stat: 'eva', amount: amt, rounds: s.duration, tag: s.name }); logs.push({ text: `${name} uses ${s.name}, becoming faster and harder to hit.`, cls: 'good' }); break; }
      case 'buff_def_resource': { const amt = Math.round(s.amount + s.amountPerLvl * lvl); actor.buffs.push({ stat: 'def', amount: amt, rounds: s.duration, tag: s.name }); actor.resource = clamp(actor.resource + s.refund, 0, actor.resourceMax); logs.push({ text: `${name} uses ${s.name}, raising Defense and recovering ${actor.resourceName}.`, cls: 'good' }); break; }
      case 'heal': { const pct = s.pct + s.pctPerLvl * lvl; const amt = Math.round(actor.maxHp * pct); actor.hp = clamp(actor.hp + amt, 0, actor.maxHp); logs.push({ text: `${name} uses ${s.name}, recovering ${amt} HP.`, cls: 'good' }); break; }
      case 'heal_and_def': { const pct = s.pct + s.pctPerLvl * lvl; const amt = Math.round(actor.maxHp * pct); actor.hp = clamp(actor.hp + amt, 0, actor.maxHp); actor.buffs.push({ stat: 'def', amount: s.defAmount, rounds: s.duration, tag: s.name }); logs.push({ text: `${name} uses ${s.name}, recovering ${amt} HP and raising Defense.`, cls: 'good' }); break; }
    }
  } else if (action.kind === 'flee') {
    logs.push({ text: `${name} attempts to flee...`, cls: '' });
  }
  return logs;
}
function chooseAiAction(actor, target) {
  const hpPct = actor.hp / actor.maxHp;
  const affordable = actor.skills.filter(s => actor.resource >= s.cost);
  if (hpPct < 0.3 && affordable.some(s => /heal/.test(s.type))) { const s = affordable.find(x => /heal/.test(x.type)); return { kind: 'skill', skill: s }; }
  if (actor.isMonster) { if (Math.random() < (actor.isBoss ? 0.3 : 0.22)) return { kind: 'attack', boosted: true }; return { kind: 'attack' }; }
  if (affordable.length && Math.random() < 0.6) return { kind: 'skill', skill: pick(affordable) };
  if (hpPct < 0.35 && Math.random() < 0.3) return { kind: 'defend' };
  return { kind: 'attack' };
}

module.exports = {
  rnd, rndInt, clamp, pick, uid,
  XP_FOR_LEVEL, BAG_CAPACITY, PVE_MAX_ROUNDS, ELO_K, RATING_FLOOR,
  ENERGY_REGEN_RATE_PER_HOUR, energyRegenPerHour,
  CLASSES, ZONES, EQUIP_SLOTS, TIERS, BOSS_ENERGY_COST, BOSS_COOLDOWN_MS,
  pickTierForBoss, pickTierForZone, makeEquipment,
  xpNeeded, effectiveStats, applyEnergyRegen, buildCombatant, buildMonster,
  tickBuffs, buffTotal, liveStat, rollDamage, resourceGainOnAttack,
  performAction, chooseAiAction,
};
