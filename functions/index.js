"use strict";
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const G = require("./lib/game-core");

admin.initializeApp();
const db = admin.firestore();

function fail(code, message, details) {
  throw new functions.https.HttpsError(code, message, details || {});
}

function requireAuth(context) {
  if (!context.auth) fail("unauthenticated", "UNAUTHORIZED");
  return context.auth.uid;
}

/* ============================================================
   startAdventure — validates + spends Energy, spawns the monster.
   Covers Normal / Elite / Boss (kind: null | 'elite' | 'boss').
   Only ONE active session per player: starting a new one overwrites
   the old one, matching the existing single-fight-at-a-time UX.
   ============================================================ */
exports.startAdventure = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const zoneId = data && data.zoneId;
  const kind = data && data.kind; // null | 'elite' | 'boss'
  const zone = G.ZONES.find((z) => z.id === zoneId);
  if (!zone) fail("invalid-argument", "INVALID_ACTION", { reason: "unknown zone" });
  const isBoss = kind === "boss", isElite = kind === "elite";

  const playerRef = db.doc("players/" + uid);
  const sessionRef = db.doc(`players/${uid}/combat/session`);

  return db.runTransaction(async (tx) => {
    const pSnap = await tx.get(playerRef);
    if (!pSnap.exists) fail("not-found", "ITEM_NOT_FOUND", { reason: "no character" });
    const c = pSnap.data();

    const { energyCur, maxEnergy, now } = G.applyEnergyRegen(c);
    const energyCost = isBoss ? G.BOSS_ENERGY_COST : isElite ? 20 : 10;
    if (energyCur < energyCost) {
      fail("failed-precondition", "NOT_ENOUGH_ENERGY", {
        required: energyCost, available: Math.floor(energyCur), perHour: G.energyRegenPerHour(maxEnergy),
      });
    }
    const bossCooldowns = c.bossCooldowns || {};
    if (isBoss) {
      const cd = (bossCooldowns[zoneId] || 0) - now;
      if (cd > 0) fail("failed-precondition", "COOLDOWN_ACTIVE", { msRemaining: cd });
    }

    const newEnergy = G.clamp(energyCur - energyCost, 0, maxEnergy);
    const update = { energyCur: newEnergy, lastEnergyAt: now };
    if (isBoss) update.bossCooldowns = Object.assign({}, bossCooldowns, { [zoneId]: now + G.BOSS_COOLDOWN_MS });

    const topLevel = zone.uncapped ? zone.min + 80 : zone.max;
    const monsterLevel = isBoss
      ? G.clamp(c.level, zone.min, topLevel)
      : G.clamp(c.level + G.rndInt(-2, 2) + (isElite ? 3 : 0), zone.min, topLevel);
    const monster = isBoss
      ? G.buildMonster(zone, monsterLevel, zone.boss, "boss")
      : G.buildMonster(zone, monsterLevel, G.pick(zone.monsters), isElite ? "elite" : null);
    const me = G.buildCombatant(Object.assign({}, c, { hpCur: c.hpCur }), true, c.username);

    const sessionId = G.uid();
    const session = {
      sessionId, uid, mode: "pve", zoneId, boss: isBoss, elite: isElite,
      me, foe: monster, round: 1, maxRounds: G.PVE_MAX_ROUNDS, ended: false, createdAt: now,
    };

    tx.update(playerRef, update);
    tx.set(sessionRef, session);

    return {
      sessionId, me, foe: monster, round: 1, maxRounds: G.PVE_MAX_ROUNDS,
      log: [{ text: isBoss ? `${monster.label} rises to meet you!` : `A ${monster.label} (Lv.${monster.level}) blocks your path!`, cls: "" }],
      energyCur: newEnergy, maxEnergy, lastEnergyAt: now,
    };
  });
});

/* ============================================================
   resolveCombatRound — the ONLY place PvE/Elite/Boss rewards are
   granted. Player-chosen action is validated (skill known + owned +
   affordable, item owned + correct effect) then resolved with the
   same formulas as the client used to run locally. Ending the
   session (ended:true + rewards applied) happens inside the same
   transaction that reads it, so a retried/duplicated call on an
   already-ended session is rejected before anything is re-granted.
   ============================================================ */
exports.resolveCombatRound = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const { sessionId, action } = data || {};
  if (!action || !action.kind) fail("invalid-argument", "INVALID_ACTION");

  const playerRef = db.doc("players/" + uid);
  const sessionRef = db.doc(`players/${uid}/combat/session`);

  return db.runTransaction(async (tx) => {
    const [pSnap, sSnap] = await Promise.all([tx.get(playerRef), tx.get(sessionRef)]);
    if (!pSnap.exists) fail("not-found", "ITEM_NOT_FOUND");
    if (!sSnap.exists || sSnap.data().sessionId !== sessionId || sSnap.data().ended) {
      fail("failed-precondition", "DUPLICATE_REQUEST", { reason: "no matching active session" });
    }
    const c = pSnap.data();
    const sess = sSnap.data();
    const me = sess.me, foe = sess.foe;
    const cls = G.CLASSES[c.class];

    // ---- validate + resolve the player's chosen action server-side ----
    let playerAction;
    if (action.kind === "attack" || action.kind === "defend" || action.kind === "flee") {
      playerAction = { kind: action.kind };
    } else if (action.kind === "skill") {
      const skill = cls.skills.find((s) => s.id === action.skillId);
      if (!skill) fail("invalid-argument", "INVALID_ACTION", { reason: "unknown skill" });
      const skillLevel = (c.classSkills && c.classSkills[skill.id]) || 0;
      if (me.resource < skill.cost) fail("failed-precondition", "NOT_ENOUGH_RESOURCE");
      playerAction = { kind: "skill", skill, skillLevel };
    } else if (action.kind === "item") {
      const idx = (c.inventory || []).findIndex((i) => i.uid === action.itemUid);
      if (idx < 0) fail("failed-precondition", "ITEM_NOT_FOUND");
      const item = c.inventory[idx];
      if (item.kind !== "consumable") fail("invalid-argument", "INVALID_ACTION");
      playerAction = { kind: "item", item };
      // consume it now — committed even if the fight continues, so abandoning the
      // session afterwards can't un-spend a potion that was already used.
      item.qty = (item.qty || 1) - 1;
      const inventory = item.qty > 0 ? c.inventory : c.inventory.filter((i) => i.uid !== action.itemUid);
      c.inventory = inventory;
      if (item.effect && item.effect.energy) {
        const regen = G.applyEnergyRegen(c);
        c.energyCur = G.clamp(regen.energyCur + item.effect.energy, 0, regen.maxEnergy);
        c.lastEnergyAt = regen.now;
      }
    } else {
      fail("invalid-argument", "INVALID_ACTION");
    }

    if (sess.ended) fail("failed-precondition", "DUPLICATE_REQUEST");

    const logs = [];
    let fleeSucceeded = false;
    if (playerAction.kind === "flee") {
      const chance = G.clamp(50 + (G.liveStat(me, "spd") - G.liveStat(foe, "spd")) * 2, 15, 90);
      fleeSucceeded = Math.random() * 100 < chance;
      logs.push({ text: fleeSucceeded ? "You escape the fight." : "You failed to escape!", cls: fleeSucceeded ? "good" : "hit" });
      if (!fleeSucceeded) {
        const foeAct = G.chooseAiAction(foe, me);
        const foeLvl = (foeAct.skill && foe.skillLevels) ? (foe.skillLevels[foeAct.skill.id] || 0) : 0;
        logs.push(...G.performAction(foe, me, foeAct, foeLvl));
        sess.round += 1;
      }
    } else {
      const meFirst = G.liveStat(me, "spd") >= G.liveStat(foe, "spd");
      const order = meFirst
        ? [{ who: me, other: foe, act: playerAction, sk: (playerAction.skillLevel || 0) },
          { who: foe, other: me, act: null, sk: 0 }]
        : [{ who: foe, other: me, act: null, sk: 0 },
          { who: me, other: foe, act: playerAction, sk: (playerAction.skillLevel || 0) }];
      for (const turn of order) {
        if (me.hp <= 0 || foe.hp <= 0) break;
        const act = turn.act || G.chooseAiAction(turn.who, turn.other);
        const skLvl = turn.act ? turn.sk : ((act.skill && turn.who.skillLevels) ? (turn.who.skillLevels[act.skill.id] || 0) : 0);
        logs.push(...G.performAction(turn.who, turn.other, act, skLvl));
      }
      G.tickBuffs(me); G.tickBuffs(foe);
      sess.round += 1;
    }

    let result = null;
    if (playerAction.kind === "flee" && fleeSucceeded) result = "flee";
    else if (foe.hp <= 0) result = "win";
    else if (me.hp <= 0) result = "lose";
    else if (sess.round > sess.maxRounds) result = "flee";

    if (!result) {
      tx.update(sessionRef, { me, foe, round: sess.round });
      tx.update(playerRef, { inventory: c.inventory, energyCur: c.energyCur, lastEnergyAt: c.lastEnergyAt });
      return { ended: false, logs, me, foe, round: sess.round };
    }
    return finishSession({ tx, playerRef, sessionRef, c, me, foe, sess, result, logs });
  });
});

function finishSession({ tx, playerRef, sessionRef, c, me, foe, sess, result, logs }) {
  const rewardLines = [];
  const eff = G.effectiveStats(c);
  c.hpCur = result === "lose" ? Math.max(1, Math.round(eff.maxHp * 0.15)) : G.clamp(me.hp, 1, eff.maxHp);
  if (c.class === "mage") c.manaCur = G.clamp(me.resource, 0, eff.maxMana);
  else c.resourceCur = 0;

  const zone = G.ZONES.find((z) => z.id === sess.zoneId);
  if (result === "win") {
    const rewardMult = sess.boss ? 3.2 : sess.elite ? 1.9 : 1;
    const dropChance = sess.boss ? 1 : sess.elite ? 0.55 : 0.35;
    const xpGain = Math.round(G.rnd(8, 14) * foe.level * rewardMult);
    const goldGain = Math.round(G.rnd(6, 12) * foe.level * rewardMult);
    c.xp = (c.xp || 0) + xpGain; c.gold = (c.gold || 0) + goldGain;
    const resGain = {};
    zone.resources.forEach((r) => { resGain[r] = Math.round(G.rndInt(2, 6) * rewardMult); c.resourceBag[r] = (c.resourceBag[r] || 0) + resGain[r]; });
    rewardLines.push({ label: "XP gained", value: "+" + xpGain }, { label: "Gold gained", value: "+" + goldGain });
    let dropLine = "None";
    if (Math.random() < dropChance && c.inventory.length < G.BAG_CAPACITY) {
      const slot = G.pick(G.EQUIP_SLOTS);
      const tier = sess.boss ? G.pickTierForBoss(zone) : G.pickTierForZone(zone, sess.elite);
      const item = G.makeEquipment(slot, tier.id, foe.level);
      c.inventory.push(item);
      dropLine = `${item.name} (${tier.name})`;
    } else if (sess.boss && c.inventory.length >= G.BAG_CAPACITY) {
      dropLine = "Bag full — drop lost!";
    }
    rewardLines.push({ label: "Item drop", value: dropLine });
    checkLevelUps(c, rewardLines);
  } else if (result === "lose") {
    rewardLines.push({ label: "Result", value: "Defeated — no rewards." });
  } else {
    rewardLines.push({ label: "Result", value: "You retreated safely." });
  }

  tx.update(playerRef, {
    hpCur: c.hpCur, manaCur: c.manaCur, resourceCur: c.resourceCur,
    xp: c.xp, level: c.level, skillPoints: c.skillPoints, gold: c.gold,
    resourceBag: c.resourceBag, inventory: c.inventory,
    energyCur: c.energyCur, lastEnergyAt: c.lastEnergyAt,
  });
  tx.delete(sessionRef);
  return { ended: true, result, logs, rewardLines, me, foe };
}

function checkLevelUps(c, rewardLines) {
  let leveled = 0;
  while (c.xp >= G.xpNeeded(c.level)) { c.xp -= G.xpNeeded(c.level); c.level += 1; c.skillPoints = (c.skillPoints || 0) + 1; leveled++; }
  if (leveled > 0) {
    const eff = G.effectiveStats(c);
    c.hpCur = eff.maxHp; c.manaCur = eff.maxMana;
    // Energy is deliberately NOT refilled on level-up (spec §7).
    rewardLines.push({ label: "Level up!", value: `Reached level ${c.level} (+${leveled} skill point${leveled > 1 ? "s" : ""})` });
  }
}
