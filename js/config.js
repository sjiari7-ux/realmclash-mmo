"use strict";

/* ============================================================
   ICONS
   ============================================================ */
const ICONS = {
  home:'<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  sword:'<path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/>',
  target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.8"/>',
  flask:'<path d="M9 3h6"/><path d="M10 3v6l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3L14 9V3"/>',
  bag:'<path d="M6 8h12l1 12H5L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4.5 5-6 8-6s6.5 1.5 8 6"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  crown:'<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8Z"/>',
  scroll:'<path d="M6 4h13v13a3 3 0 0 1-3 3H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M6 4a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2"/><path d="M9 9h7M9 13h7"/>',
  shield:'<path d="M12 3l7 3v6c0 5-3.5 7.5-7 9-3.5-1.5-7-4-7-9V6l7-3Z"/>',
  lock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  heart:'<path d="M12 21C12 21 4 15.5 4 9.5C4 6.5 6.5 4 9.5 4C11 4 12 5 12 5C12 5 13 4 14.5 4C17.5 4 20 6.5 20 9.5C20 15.5 12 21 12 21Z"/>',
  bolt:'<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
  drop:'<path d="M12 3s6 7 6 11.5A6 6 0 0 1 6 14.5C6 10 12 3 12 3Z"/>',
};
function icon(name, extra){ return '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" '+(extra||'')+'>'+(ICONS[name]||'')+'</svg>'; }

/* ============================================================
   GAME CONFIG
   ============================================================ */
const XP_FOR_LEVEL = (lvl)=> Math.round(35 * Math.pow(lvl, 1.4));
const SKILL_UPGRADE_COST = [1,1,2,2,3,3,4,4,5,5]; // cost to go from lvl i -> i+1, i=0..9
const MAX_SKILL_LEVEL = 10;
const BAG_CAPACITY = 40;
const PVP_ENERGY_COST = 15;
const PVP_MAX_ROUNDS = 25;
const PVE_MAX_ROUNDS = 30;
const PVP_PROTECTION_MS = 5 * 60 * 1000;
const ELO_K = 32;
const RATING_FLOOR = 100;
const ENERGY_REGEN_MS = 5 * 60 * 1000, ENERGY_REGEN_AMT = 10;
const HP_REGEN_MS = 30 * 1000, HP_REGEN_PCT = 0.02;
const MANA_REGEN_MS = 10 * 1000, MANA_REGEN_AMT = 1;

const CLASSES = {
  warrior:{
    id:'warrior', name:'Warrior', tagline:'Balanced frontline fighter.',
    resource:'Rage',
    base:{hp:130, atk:13, def:12, spd:7, crit:4, eva:3},
    growth:{hp:15, atk:2.1, def:2.0, spd:0.35, crit:0.12, eva:0.10},
    startEq:{weapon:'Iron Sword', armor:'Iron Armor'},
    skills:[
      {id:'power_strike', name:'Power Strike', desc:'A heavy blow that hits harder than a normal swing.', cost:20, type:'damage', mult:1.55, multPerLvl:0.05},
      {id:'iron_armor', name:'Iron Armor', desc:'Brace yourself, sharply raising Defense for 3 rounds.', cost:15, type:'buff_def', amount:9, amountPerLvl:3, duration:3},
      {id:'warrior_spirit', name:'Warrior Spirit', desc:'Draw on your resolve to recover lost health.', cost:25, type:'heal', pct:0.09, pctPerLvl:0.012},
    ],
  },
  archer:{
    id:'archer', name:'Archer', tagline:'Fast offensive fighter.',
    resource:'Precision',
    base:{hp:95, atk:15, def:6, spd:13, crit:14, eva:12},
    growth:{hp:9, atk:2.3, def:1.0, spd:0.55, crit:0.35, eva:0.30},
    startEq:{weapon:'Longbow', armor:'Leather Vest'},
    skills:[
      {id:'keen_eye', name:'Keen Eye', desc:'A precise shot with a sharply increased critical chance.', cost:20, type:'damage_crit_boost', mult:1.45, multPerLvl:0.05, critBonus:25},
      {id:'swiftness', name:'Swiftness', desc:'Move like the wind, boosting Speed and Evasion for 3 rounds.', cost:15, type:'buff_spd_eva', amount:6, amountPerLvl:1.4, duration:3},
      {id:'efficient_aim', name:'Efficient Aim', desc:'A calculated shot that ignores part of the target\'s Defense.', cost:20, type:'damage_ignore_def', mult:1.3, multPerLvl:0.04, ignorePct:0.5},
    ],
  },
  mage:{
    id:'mage', name:'Mage', tagline:'High-damage magical fighter.',
    resource:'Mana',
    base:{hp:78, atk:19, def:4, spd:9, crit:8, eva:5},
    growth:{hp:7, atk:2.9, def:0.7, spd:0.30, crit:0.20, eva:0.15},
    startEq:{weapon:'Magic Staff', armor:'Cloth Robe'},
    skills:[
      {id:'arcane_power', name:'Arcane Power', desc:'Unleash a devastating burst of arcane energy.', cost:16, type:'damage', mult:2.0, multPerLvl:0.07},
      {id:'magic_shield', name:'Magic Shield', desc:'Weave a barrier that greatly raises Defense for 2 rounds.', cost:12, type:'buff_def', amount:14, amountPerLvl:3.4, duration:2},
      {id:'mana_force', name:'Mana Force', desc:'Channel mana into an attack while restoring some to yourself.', cost:10, type:'damage_resource_refund', mult:1.35, multPerLvl:0.05, refund:12},
    ],
  },
  commander:{
    id:'commander', name:'Commander', tagline:'Combat and defensive specialist.',
    resource:'Command Points',
    base:{hp:135, atk:12, def:14, spd:7, crit:5, eva:4},
    growth:{hp:16, atk:1.9, def:2.3, spd:0.30, crit:0.15, eva:0.12},
    startEq:{weapon:'Officer Blade', armor:'Banner Plate'},
    skills:[
      {id:'war_banner', name:'War Banner', desc:'Rally yourself, raising Attack for 3 rounds.', cost:20, type:'buff_atk', amount:7, amountPerLvl:1.8, duration:3},
      {id:'iron_will', name:'Iron Will', desc:'Steel your resolve, healing and raising Defense briefly.', cost:20, type:'heal_and_def', pct:0.06, pctPerLvl:0.008, defAmount:8, duration:2},
      {id:'command_aura', name:'Command Aura', desc:'Strike while your presence weakens the enemy\'s Attack for 2 rounds.', cost:20, type:'damage_debuff_atk', mult:1.35, multPerLvl:0.04, debuff:0.2, duration:2},
    ],
  },
  merchant:{
    id:'merchant', name:'Merchant', tagline:'Economic-oriented combat class.',
    resource:'Fortune',
    base:{hp:100, atk:12, def:9, spd:9, crit:8, eva:7},
    growth:{hp:11, atk:2.0, def:1.4, spd:0.35, crit:0.22, eva:0.18},
    startEq:{weapon:'Golden Dagger', armor:'Merchant Vest'},
    skills:[
      {id:'profitable_deal', name:'Profitable Deal', desc:'A shrewd strike; defeating a foe yields extra gold.', cost:15, type:'damage_gold_bonus', mult:1.4, multPerLvl:0.05, goldBonusPct:0.4},
      {id:'deep_pockets', name:'Deep Pockets', desc:'Fortune favors the prepared: raise Defense and recover Fortune.', cost:10, type:'buff_def_resource', amount:7, amountPerLvl:1.6, duration:3, refund:15},
      {id:'lucky', name:'Lucky', desc:'Fortune smiles upon this strike, sharply raising its critical chance.', cost:15, type:'damage_crit_boost', mult:1.3, multPerLvl:0.04, critBonus:30},
    ],
  },
};

const GENERAL_SKILLS = [
  {id:'health', name:'Health', desc:'+8 Max HP per level', stat:'hp', amount:8},
  {id:'damage', name:'Damage', desc:'+2 Attack per level', stat:'atk', amount:2},
  {id:'defense', name:'Defense', desc:'+2 Defense per level', stat:'def', amount:2},
  {id:'stamina', name:'Stamina', desc:'+6 Max Energy per level', stat:'energy', amount:6},
  {id:'storage', name:'Storage', desc:'+40 Storage capacity per level', stat:'storage', amount:40},
];
const GENERAL_SKILL_MAX = 20;
const GENERAL_SKILL_UPGRADE_COST = [1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10]; // cost in skill points to go from lvl i -> i+1, i=0..19
function generalSkillCost(currentLevel){ return GENERAL_SKILL_UPGRADE_COST[currentLevel]; }

const ZONES = [
  {id:'plains', name:'Plains', min:1, max:10, monsters:['Wild Boar','Field Rat','Bandit Scout'], resources:['wood','food'],
    boss:'Grukk the Boarking',
    dropTable:[{t:'common',w:75},{t:'uncommon',w:23},{t:'rare',w:2}]},
  {id:'forest', name:'Forest', min:10, max:25, monsters:['Dire Wolf','Forest Troll','Rogue Archer'], resources:['wood','herbs'],
    boss:'Malrend, Heart of the Wood',
    dropTable:[{t:'common',w:60},{t:'uncommon',w:32},{t:'rare',w:8}]},
  {id:'mountain', name:'Mountain', min:25, max:40, monsters:['Rock Golem','Mountain Harpy','Iron Bandit'], resources:['stone','iron'],
    boss:'Thorrgun, the Cliff Titan',
    dropTable:[{t:'common',w:45},{t:'uncommon',w:35},{t:'rare',w:18},{t:'epic',w:2}]},
  {id:'cave', name:'Cave', min:40, max:55, monsters:['Cave Spider','Bat Swarm','Gloom Wraith'], resources:['coal','iron'],
    boss:'Skarn, Lord of the Deep',
    dropTable:[{t:'common',w:35},{t:'uncommon',w:35},{t:'rare',w:25},{t:'epic',w:5}]},
  {id:'swamp', name:'Swamp', min:55, max:70, monsters:['Bog Serpent','Swamp Witch','Rot Beast'], resources:['herbs','leather'],
    boss:'Vessyr the Rotmother',
    dropTable:[{t:'common',w:20},{t:'uncommon',w:35},{t:'rare',w:32},{t:'epic',w:12},{t:'legendary',w:1}]},
  {id:'darkzone', name:'Dark Zone', min:70, max:100, monsters:['Shadow Knight','Void Reaver','Nightmare Construct'], resources:['iron','ore'],
    boss:'Kaelthorn, the Hollow King',
    dropTable:[{t:'common',w:10},{t:'uncommon',w:25},{t:'rare',w:35},{t:'epic',w:25},{t:'legendary',w:5}]},
  {id:'frozen', name:'Frozen Wastes', min:100, max:150, monsters:['Frost Wraith','Ice Golem','Winter Stalker'], resources:['frost','iron'],
    boss:'Ysmera, the Everfrost Queen',
    dropTable:[{t:'uncommon',w:10},{t:'rare',w:35},{t:'epic',w:40},{t:'legendary',w:15}]},
  {id:'abyss', name:'Abyssal Rift', min:150, max:300, uncapped:true, monsters:['Abyssal Horror','Void Sentinel','Nether Devourer'], resources:['voidessence','ore'],
    boss:'Nyxul, Devourer of Light',
    dropTable:[{t:'rare',w:10},{t:'epic',w:40},{t:'legendary',w:50}]},
];
const RESOURCE_NAMES = {wood:'Wood', stone:'Stone', food:'Food', coal:'Coal', iron:'Iron', ore:'Gold Ore', herbs:'Herbs', leather:'Leather', frost:'Frost Shard', voidessence:'Void Essence'};

const KINGDOMS = [
  {id:'europe', name:'Europe', resources:['cotton','food'], tax:5},
  {id:'asia', name:'Asia', resources:['wood','herbs'], tax:8},
  {id:'africa', name:'Africa', resources:['stone','iron'], tax:10},
  {id:'north_america', name:'North America', resources:['stone','silver'], tax:13},
  {id:'arab_world', name:'Arab World', resources:['herbs','leather'], tax:16},
  {id:'south_america', name:'South America', resources:['voidessence','ore'], tax:20},
];
const KINGDOM_ROLES = ['Recruit','Member','Officer','Co-Leader','Leader'];
const KINGDOM_JOIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const KINGDOM_TREASURY_RESOURCES = ['gold','wood','stone','iron','food','herbs'];
const KINGDOM_CHAT_MAX = 60;
function kingdomRank(role){ return KINGDOM_ROLES.indexOf(role); }
const MARKET_BROWSE_LIMIT = 60;
const MARKET_MY_LISTING_LIMIT = 20;
const MARKET_KIND_LABELS = {resource:'Resource', material:'Material', consumable:'Consumable', equipment:'Equipment'};
const BOSS_ENERGY_COST = 30;
const BOSS_COOLDOWN_MS = 30 * 60 * 1000;
const BOSS_MULT = { hp: 2.3, atk: 1.35, def: 1.2 };
const STEP_ENERGY_COST = 2;
const STEP_EVENT_WEIGHTS = [
  {t:'flavor', w:40}, {t:'gold', w:18}, {t:'resource', w:16}, {t:'xp', w:6}, {t:'item', w:3}, {t:'monster', w:17},
];
const FLAVOR_TEXTS = [
  "You kick a loose pebble down the road and immediately regret it.",
  "A merchant nods at you from a distance. You nod back, unsure why.",
  "The wind carries a strange smell from up ahead. Onward.",
  "You pause to retie your boot. Riveting stuff.",
  "Somewhere in the distance, something screams. You keep walking.",
  "A stray dog follows you for a few steps, then loses interest.",
  "You find nothing of note, but the walk was nice.",
  "An old sign, half-buried, reads: 'Turn back.' You don't.",
  "You hum a tune you don't remember learning.",
  "A crow watches you pass. It seems unimpressed.",
  "The path forks. You pick the one that looks slightly less cursed.",
  "You step over what might have once been a person. Best not to look closely.",
  "Someone, somewhere, is having a much worse day than you.",
  "You practice your battle cry. It needs work.",
  "The road here is oddly well-maintained. Suspicious.",
  "You count your steps for a while, then lose count, then give up.",
  "A distant bell tolls. You have no idea what it means.",
  "You spot fresh tracks in the dirt. Best to stay alert.",
  "The silence here feels earned.",
  "You wonder, not for the first time, why you chose this life.",
  "A gust of wind nearly takes your hood. You win this round.",
  "You overhear two travelers arguing about the price of bread.",
  "Your stomach growls. You ignore it, professionally.",
  "The road narrows. You press on regardless.",
];

const RECIPES = [
  {id:'plank', name:'Wood Planks', inputs:{wood:5}, energy:2, xp:5, out:{kind:'material', id:'plank', name:'Plank'}},
  {id:'brick', name:'Bricks', inputs:{stone:5}, energy:2, xp:5, out:{kind:'material', id:'brick', name:'Brick'}},
  {id:'bread', name:'Bread', inputs:{food:4}, energy:2, xp:5, out:{kind:'material', id:'bread', name:'Bread'}},
  {id:'steel', name:'Steel', inputs:{iron:4, coal:2}, energy:3, xp:10, out:{kind:'material', id:'steel', name:'Steel'}},
  {id:'tanned_leather', name:'Tanned Leather', inputs:{leather:4}, energy:2, xp:6, out:{kind:'material', id:'tanned_leather', name:'Tanned Leather'}},
  {id:'potion', name:'Potion Base', inputs:{herbs:5}, energy:2, xp:5, out:{kind:'material', id:'potion', name:'Potion'}},
  {id:'health_potion', name:'Health Potion', inputs:{herbs:3, potion:1}, energy:3, xp:8, out:{kind:'consumable', id:'health_potion', name:'Health Potion', effect:{heal:0.35}}},
  {id:'energy_potion', name:'Energy Potion', inputs:{food:3, potion:1}, energy:3, xp:8, out:{kind:'consumable', id:'energy_potion', name:'Energy Potion', effect:{energy:30}}},
];

const EQUIP_SLOTS = ['weapon','armor','helmet','boots','gloves','accessory'];
const SLOT_NOUN = {weapon:'Blade', armor:'Plate', helmet:'Helm', boots:'Boots', gloves:'Gauntlets', accessory:'Charm'};
const TIERS = [
  {id:'common', name:'Common', mult:1.0},
  {id:'uncommon', name:'Uncommon', mult:1.35},
  {id:'rare', name:'Rare', mult:1.8},
  {id:'epic', name:'Epic', mult:2.4},
  {id:'legendary', name:'Legendary', mult:3.3},
];
const TIER_ORDER = TIERS.map(t=>t.id);
function pickTierForBoss(zone){
  const pool = zone.dropTable.slice(-2);
  const total = pool.reduce((a,x)=>a+x.w, 0) || 1;
  let r = rnd(0, total);
  for(const x of pool){ if(r<x.w) return TIERS.find(t=>t.id===x.t); r-=x.w; }
  return TIERS.find(t=>t.id===pool[pool.length-1].t);
}
function pickTierForZone(zone, elite){
  let table = zone.dropTable.map(x=>Object.assign({},x));
  if(elite){
    table = table.map(x=>{
      if(x.t==='common') return {t:x.t, w:Math.max(1, Math.round(x.w*0.35))};
      if(x.t==='epic' || x.t==='legendary') return {t:x.t, w:Math.round(x.w*1.8)};
      return x;
    });
  }
  const total = table.reduce((a,x)=>a+x.w, 0);
  let r = rnd(0, total);
  for(const x of table){ if(r<x.w) return TIERS.find(t=>t.id===x.t); r-=x.w; }
  return TIERS.find(t=>t.id===table[0].t) || TIERS[0];
}
const UPGRADE_COSTS = {
  common:    {gold:120,  resources:{iron:5, leather:5} },
  uncommon:  {gold:300,  materials:{steel:3, tanned_leather:3} },
  rare:      {gold:700,  resources:{frost:6, ore:6} },
  epic:      {gold:1600, resources:{voidessence:6, frost:10} },
};

const BOT_NAMES = ['Kestrel','Draven','Mira Ash','Thorne','Sable','Yorick','Wren','Balder','Nyx','Corvin','Isolde','Ragnar','Petra','Faelan','Osric','Vesper'];

