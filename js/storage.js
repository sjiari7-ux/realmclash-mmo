"use strict";

/* ============================================================
   STORAGE LAYER (Firebase Firestore + Auth -> falls back to localStorage)
   ============================================================ */
const LS_KEY_PREFIX = 'arcadia_v1_';

// Fill these in from your Firebase project (Project Settings -> General ->
// "Your apps" -> SDK setup and configuration). Leave apiKey as-is to run
// with local-only storage (no cross-player sharing).
const FIREBASE_CONFIG = {
  apiKey: 'YOUR_FIREBASE_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

let DB = null, USER = null, MY_ID = null, HAS_DB = false;
let FB_AUTH = null, FB_USER_EMAIL = null;

function withTimeout(promise, ms){
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_,reject)=> setTimeout(()=>reject(new Error('timeout')), ms)),
  ]);
}

// Firestore's native API already speaks the doc/collection shape the game
// logic expects (doc().get/set/update/delete, collection().where().orderBy()
// .limit().get/add), so DB below is just the Firestore instance itself —
// no translation layer needed like the old Supabase version required.
// The one thing Firestore has no built-in for is the short-lived market
// lock, so that's a small helper (acquireDocLock) instead of a ref method.
async function acquireDocLock(ref, holder, ttlMs){
  const now = Date.now();
  try{
    const acquired = await DB.runTransaction(async (tx)=>{
      const snap = await tx.get(ref);
      if(!snap.exists) return false;
      const d = snap.data() || {};
      const lockUntil = d.__lockUntil || 0;
      const lockHolder = d.__lockHolder || null;
      if(lockUntil > now && lockHolder !== holder) return false;
      tx.update(ref, { __lockHolder: holder, __lockUntil: now + ttlMs });
      return true;
    });
    return { acquired: !!acquired };
  }catch(e){ return { acquired: false }; }
}

// Resolves once Firebase Auth has settled its initial state (signed-in
// already, or definitely signed-out), mirroring Supabase's getSession().
function waitForAuthUser(auth){
  return new Promise(resolve=>{
    const unsub = auth.onAuthStateChanged(u=>{ unsub(); resolve(u); });
  });
}

// Case-insensitive check that no OTHER player already has this username.
// Best-effort: a network hiccup here never blocks character creation.
// Matched against a lowercased `usernameLower` field written alongside the
// character in saveCharacter(), since Firestore has no ILIKE.
async function isUsernameTaken(username){
  if(!HAS_DB) return false;
  try{
    const q = await withTimeout(
      DB.collection('players').where('usernameLower','==', (username||'').toLowerCase()).limit(5).get(),
      6000
    );
    return q.docs.some(d=> d.id !== MY_ID);
  }catch(e){ return false; }
}

async function initCapabilities(){
  try{
    const configured = FIREBASE_CONFIG.apiKey.indexOf('YOUR_FIREBASE')===-1;
    if(configured && window.firebase){
      if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      FB_AUTH = firebase.auth();
      DB = firebase.firestore();
      // If we're bouncing back from a Google redirect sign-in, pick that up
      // first (errors here — e.g. the user closed the popup — are ignored).
      try{ await withTimeout(FB_AUTH.getRedirectResult(), 8000); }catch(e){}
      // Every visitor gets a real Firebase Auth session, starting anonymous.
      // Linking Google later keeps the SAME uid, so existing progress
      // carries over automatically instead of needing a data migration.
      let user = await withTimeout(waitForAuthUser(FB_AUTH), 6000).catch(()=>null);
      if(!user){
        const cred = await withTimeout(FB_AUTH.signInAnonymously(), 8000);
        user = cred.user;
      }
      MY_ID = user.uid;
      FB_USER_EMAIL = user.email || null;
      FB_AUTH.onAuthStateChanged(u=>{
        FB_USER_EMAIL = u ? (u.email || null) : null;
        if(u) MY_ID = u.uid;
        if(S.screen==='settings') render();
      });
    }
  }catch(e){ DB = null; FB_AUTH = null; }
  if(!MY_ID){
    try{
      MY_ID = localStorage.getItem(LS_KEY_PREFIX+'guest_id');
      if(!MY_ID){ MY_ID = 'guest_'+uid(); localStorage.setItem(LS_KEY_PREFIX+'guest_id', MY_ID); }
    }catch(e){ MY_ID = 'guest_'+uid(); }
  }
  HAS_DB = !!DB;
}

// Starts Google sign-in. If the visitor is still on their anonymous session
// this LINKS Google to that same account (uid unchanged, progress kept); if
// they're already signed in (e.g. returning after linking) it just re-auths.
// Uses a full-page redirect (not a popup) so it works the same way the
// Supabase OAuth flow did.
async function linkGoogleAccount(){
  if(!FB_AUTH){ showToast('Google sign-in needs shared storage, unavailable in this view.'); return; }
  showToast('Opening Google sign-in…');
  try{
    const provider = new firebase.auth.GoogleAuthProvider();
    const user = FB_AUTH.currentUser;
    if(user && user.isAnonymous){
      await user.linkWithRedirect(provider);
    } else {
      await FB_AUTH.signInWithRedirect(provider);
    }
    // Browser navigates to Google and back; getRedirectResult() in
    // initCapabilities picks up the result on the next load.
  }catch(e){ showToast('Google sign-in error: ' + (e && e.message ? e.message : String(e))); }
}

async function loadCharacter(){
  if(HAS_DB){
    try{
      const snap = await withTimeout(DB.doc('players/'+MY_ID).get(), 5000);
      if(snap.exists) return snap.data();
    }catch(e){ /* fall through to local */ }
  }
  try{
    const raw = localStorage.getItem(LS_KEY_PREFIX+'char_'+MY_ID);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return null;
}
let _lastSaveJson = null;
async function saveCharacter(c){
  c.updatedAt = Date.now();
  const json = JSON.stringify(c);
  if(json === _lastSaveJson) return;
  _lastSaveJson = json;
  try{ localStorage.setItem(LS_KEY_PREFIX+'char_'+MY_ID, json); }catch(e){}
  if(HAS_DB){
    try{
      // usernameLower rides along in the Firestore doc only, so
      // isUsernameTaken() can query it — it's not part of the saved shape.
      const withLower = Object.assign({}, JSON.parse(json), { usernameLower: (c.username||'').toLowerCase() });
      await withTimeout(DB.doc('players/'+MY_ID).set(withLower), 5000);
    }catch(e){ /* best-effort */ }
  }
}
/* ---------------- Kingdom system ---------------- */
async function loadKingdomView(){
  if(!HAS_DB){ S.kingdomView = {unavailable:true}; render(); return; }
  S.kingdomView = {loading:true};
  render();
  const c = S.char;
  try{
    // Another member may have promoted/demoted/kicked us since our last load —
    // resync our own membership fields from our own doc (the source of truth)
    // before rendering, rather than trusting our possibly-stale in-memory copy.
    try{
      const selfSnap = await withTimeout(DB.doc('players/'+MY_ID).get(), 6000);
      if(selfSnap.exists){
        const sd = selfSnap.data();
        if(sd.kingdomId !== undefined) c.kingdomId = sd.kingdomId;
        if(sd.kingdomRole !== undefined) c.kingdomRole = sd.kingdomRole;
        if(sd.kingdomCooldownUntil !== undefined) c.kingdomCooldownUntil = sd.kingdomCooldownUntil;
      }
    }catch(e){ /* keep local copy if this fails */ }
    if(c.kingdomId){
      const [kdocSnap, memSnap] = await Promise.all([
        withTimeout(DB.doc('kingdoms/'+c.kingdomId).get(), 6000),
        withTimeout(DB.collection('players').where('kingdomId','==',c.kingdomId).limit(80).get(), 6000),
      ]);
      const kdoc = kdocSnap.exists ? kdocSnap.data() : { treasury:{}, leaderId:null, chat:[] };
      const members = memSnap.docs.map(d=>Object.assign({id:d.id}, d.data()))
        .filter(m=>m.username)
        .sort((a,b)=> kingdomRank(b.kingdomRole)-kingdomRank(a.kingdomRole) || (b.level||1)-(a.level||1));
      S.kingdomView = { mode:'mine', kingdom: Object.assign({id:c.kingdomId}, kdoc), members };
    } else {
      const snaps = await Promise.all(KINGDOMS.map(k=> withTimeout(DB.doc('kingdoms/'+k.id).get(), 6000).catch(()=>({exists:false}))));
      const counts = await Promise.all(KINGDOMS.map(k=> withTimeout(DB.collection('players').where('kingdomId','==',k.id).limit(500).get(), 6000).then(s=>s.size).catch(()=>0)));
      S.kingdomView = { mode:'browse', kingdoms: KINGDOMS.map((k,i)=>Object.assign({}, k, {
        treasury: (snaps[i] && snaps[i].exists ? snaps[i].data().treasury : {}) || {},
        memberCount: counts[i],
      })) };
    }
  }catch(e){
    S.kingdomView = { error:true };
  }
  render();
}

async function joinKingdom(kingdomId){
  const c = S.char;
  if(!HAS_DB){ showToast('Kingdoms need shared storage, which is unavailable in this view.'); return; }
  const cd = (c.kingdomCooldownUntil||0) - Date.now();
  if(cd > 0){ showToast(`You must wait ${fmtMs(cd)} before joining a new kingdom.`); return; }
  if(c.kingdomId){ showToast('Leave your current kingdom first.'); return; }
  try{
    const kRef = DB.doc('kingdoms/'+kingdomId);
    const snap = await withTimeout(kRef.get(), 6000);
    const isFirstMember = !snap.exists || !snap.data().leaderId;
    const role = isFirstMember ? 'Leader' : 'Recruit';
    if(!snap.exists){
      await withTimeout(kRef.set({ id:kingdomId, treasury:{}, leaderId: isFirstMember?MY_ID:null, chat:[], createdAt:Date.now() }), 6000);
    } else if(isFirstMember){
      await withTimeout(kRef.update({ leaderId: MY_ID }), 6000);
    }
    c.kingdomId = kingdomId; c.kingdomRole = role; c.kingdomJoinedAt = Date.now();
    await saveCharacter(c);
    showToast(`You joined ${KINGDOMS.find(k=>k.id===kingdomId).name} as ${role}.`);
    await loadKingdomView();
  }catch(e){ showToast('Could not join right now — try again.'); }
}

async function leaveKingdom(){
  const c = S.char;
  if(!c.kingdomId) return;
  if(!confirm('Leave your kingdom? You will need to wait 24 hours before joining another.')) return;
  const kingdomId = c.kingdomId;
  try{
    if(HAS_DB && c.kingdomRole==='Leader'){
      const kRef = DB.doc('kingdoms/'+kingdomId);
      try{ await withTimeout(kRef.update({leaderId:null}), 6000); }catch(e){}
    }
  }catch(e){}
  c.kingdomId = null; c.kingdomRole = null; c.kingdomJoinedAt = 0;
  c.kingdomCooldownUntil = Date.now() + KINGDOM_JOIN_COOLDOWN_MS;
  await saveCharacter(c);
  S.kingdomView = null;
  showToast('You have left the kingdom.');
  await loadKingdomView();
}

async function claimLeadership(){
  const c = S.char;
  if(!HAS_DB || !c.kingdomId) return;
  if(kingdomRank(c.kingdomRole) < 2){ showToast('Only Officers and above may claim leadership.'); return; }
  try{
    const kRef = DB.doc('kingdoms/'+c.kingdomId);
    const snap = await withTimeout(kRef.get(), 6000);
    if(snap.exists && snap.data().leaderId){ showToast('This kingdom already has a Leader.'); await loadKingdomView(); return; }
    await withTimeout(kRef.update({leaderId: MY_ID}), 6000);
    c.kingdomRole = 'Leader';
    await saveCharacter(c);
    showToast('You are now the Leader.');
    await loadKingdomView();
  }catch(e){ showToast('Could not claim leadership right now.'); }
}

async function donateToKingdom(resource, amount){
  const c = S.char;
  if(!HAS_DB || !c.kingdomId) return;
  amount = Math.floor(amount);
  if(!amount || amount<=0) return;
  const have = resource==='gold' ? c.gold : (c.resourceBag[resource]||0);
  if(have < amount){ showToast('Not enough to donate.'); return; }
  try{
    const kRef = DB.doc('kingdoms/'+c.kingdomId);
    const snap = await withTimeout(kRef.get(), 6000);
    const treasury = (snap.exists && snap.data().treasury) || {};
    const newVal = (treasury[resource]||0) + amount;
    await withTimeout(kRef.update({treasury: {[resource]: newVal}}), 6000);
    if(resource==='gold') c.gold -= amount; else c.resourceBag[resource] -= amount;
    await saveCharacter(c);
    showToast(`Donated ${amount} ${resource==='gold'?'Gold':RESOURCE_NAMES[resource]||resource}.`);
    await loadKingdomView();
  }catch(e){ showToast('Donation failed — try again.'); }
}

async function sendKingdomChat(text){
  const c = S.char;
  text = (text||'').trim().slice(0,200);
  if(!text || !HAS_DB || !c.kingdomId) return;
  try{
    const kRef = DB.doc('kingdoms/'+c.kingdomId);
    const snap = await withTimeout(kRef.get(), 6000);
    const chat = (snap.exists && Array.isArray(snap.data().chat)) ? snap.data().chat.slice() : [];
    chat.push({senderId:MY_ID, senderName:c.username, text, ts:Date.now()});
    while(chat.length > KINGDOM_CHAT_MAX) chat.shift();
    await withTimeout(kRef.update({chat}), 6000);
    await loadKingdomView();
  }catch(e){ showToast('Message failed to send.'); }
}

async function kingdomManageMember(targetId, action){
  const c = S.char, kv = S.kingdomView;
  if(!HAS_DB || !kv || kv.mode!=='mine') return;
  const target = kv.members.find(m=>m.id===targetId);
  if(!target) return;
  const myRank = kingdomRank(c.kingdomRole), targetRank = kingdomRank(target.kingdomRole);
  if(myRank < 2 || myRank <= targetRank){ showToast('You do not have permission to do that.'); return; }
  try{
    if(action==='kick'){
      await withTimeout(DB.doc('players/'+targetId).update({kingdomId:null, kingdomRole:null, kingdomCooldownUntil: Date.now()+KINGDOM_JOIN_COOLDOWN_MS}), 6000);
      showToast(`${target.username} was removed from the kingdom.`);
    } else if((action==='promote'||action==='demote') && myRank >= 3){
      const newRank = clamp(targetRank + (action==='promote'?1:-1), 0, myRank-1);
      await withTimeout(DB.doc('players/'+targetId).update({kingdomRole: KINGDOM_ROLES[newRank]}), 6000);
      showToast(`${target.username} is now ${KINGDOM_ROLES[newRank]}.`);
    } else {
      showToast('You do not have permission to do that.'); return;
    }
    await loadKingdomView();
  }catch(e){ showToast('Action failed — try again.'); }
}

/* ---------------- Marketplace ---------------- */
function marketItemLabel(l){
  if(l.kind==='equipment') return `${l.itemName} <span class="tag tag-${l.tier}">${l.tier}</span>`;
  return `${l.itemName} x${l.qty}`;
}
async function loadMarketListings(){
  if(!HAS_DB){ S.marketListings = []; S.marketUnavailable = true; render(); return; }
  S.marketListings = null;
  render();
  try{
    const snap = await withTimeout(DB.collection('marketListings').orderBy('createdAt','desc').limit(MARKET_BROWSE_LIMIT).get(), 6000);
    S.marketListings = snap.docs.map(d=>Object.assign({id:d.id}, d.data()));
  }catch(e){
    S.marketListings = [];
    showToast('Could not load the market — try again.');
  }
  render();
}

function sellableResources(c){ return Object.entries(c.resourceBag).filter(([,v])=>v>0).map(([k,v])=>({id:k, name:RESOURCE_NAMES[k]||k, have:v})); }
function sellableByKind(c, kind){
  if(kind==='resource') return sellableResources(c);
  if(kind==='material') return c.inventory.filter(i=>i.kind==='material').map(i=>({id:i.uid, name:i.name, have:i.qty||1}));
  if(kind==='consumable') return c.inventory.filter(i=>i.kind==='consumable').map(i=>({id:i.uid, name:i.name, have:i.qty||1}));
  if(kind==='equipment') return c.inventory.filter(i=>i.kind==='equipment').map(i=>({id:i.uid, name:i.name+' ('+i.tier+')', have:1}));
  return [];
}

async function createListing(kind, itemKey, qty, pricePerUnit){
  const c = S.char;
  if(!HAS_DB){ showToast('The market needs shared storage, unavailable in this view.'); return; }
  qty = Math.max(1, Math.floor(qty||1));
  pricePerUnit = Math.max(1, Math.floor(pricePerUnit||0));
  if(!pricePerUnit){ showToast('Set a price first.'); return; }
  if(bagCount(c) >= BAG_CAPACITY && kind!=='resource'){ /* listing removes an item so this is fine, no-op guard */ }

  let listing = { sellerId: MY_ID, sellerName: c.username, kind, createdAt: Date.now() };

  if(kind==='resource'){
    const have = c.resourceBag[itemKey]||0;
    if(have < qty){ showToast('Not enough of that resource.'); return; }
    c.resourceBag[itemKey] -= qty;
    listing.itemId = itemKey; listing.itemName = RESOURCE_NAMES[itemKey]||itemKey; listing.qty = qty; listing.pricePerUnit = pricePerUnit; listing.totalPrice = qty*pricePerUnit;
  } else {
    const idx = c.inventory.findIndex(i=>i.uid===itemKey);
    if(idx<0){ showToast('Item not found in your bag.'); return; }
    const item = c.inventory[idx];
    if(kind==='equipment'){
      c.inventory.splice(idx,1);
      listing.itemId = item.id||item.uid; listing.itemName = item.name; listing.qty = 1; listing.pricePerUnit = pricePerUnit; listing.totalPrice = pricePerUnit;
      listing.tier = item.tier; listing.equipmentSnapshot = item;
    } else {
      qty = Math.min(qty, item.qty||1);
      if(qty >= (item.qty||1)) c.inventory.splice(idx,1); else item.qty -= qty;
      listing.itemId = item.id; listing.itemName = item.name; listing.qty = qty; listing.pricePerUnit = pricePerUnit; listing.totalPrice = qty*pricePerUnit;
      if(item.effect) listing.effect = item.effect;
    }
  }

  try{
    await withTimeout(DB.collection('marketListings').add(listing), 6000);
    await saveCharacter(c);
    showToast('Listing created.');
    await loadMarketListings();
  }catch(e){
    showToast('Could not create the listing — try again.');
  }
}

async function buyListing(listingId){
  const c = S.char;
  if(!HAS_DB) return;
  const ref = DB.doc('marketListings/'+listingId);
  try{
    const lease = await withTimeout(acquireDocLock(ref, MY_ID, 6000), 6000);
    if(!lease.acquired){ showToast('Someone else is buying this right now — try again in a moment.'); return; }
    const snap = await withTimeout(ref.get(), 6000);
    if(!snap.exists){ showToast('That listing is already gone.'); await loadMarketListings(); return; }
    const l = snap.data();
    if(l.sellerId === MY_ID){ showToast("You can't buy your own listing."); return; }
    if(c.gold < l.totalPrice){ showToast('Not enough gold.'); return; }
    if(l.kind!=='resource' && bagCount(c) >= BAG_CAPACITY){ showToast('Your bag is full.'); return; }

    c.gold -= l.totalPrice;
    if(l.kind==='resource'){
      c.resourceBag[l.itemId] = (c.resourceBag[l.itemId]||0) + l.qty;
    } else if(l.kind==='equipment'){
      const item = Object.assign({}, l.equipmentSnapshot, {uid: uid()});
      c.inventory.push(item);
    } else {
      const existing = c.inventory.find(i=>i.kind===l.kind && i.id===l.itemId);
      if(existing) existing.qty = (existing.qty||1) + l.qty;
      else c.inventory.push({uid: uid(), kind: l.kind, id: l.itemId, name: l.itemName, qty: l.qty, effect: l.effect});
    }
    await ref.delete();
    await saveCharacter(c);

    // best-effort credit to the seller (last-writer-wins on their own gold field)
    try{
      const sellerRef = DB.doc('players/'+l.sellerId);
      const sellerSnap = await withTimeout(sellerRef.get(), 6000);
      if(sellerSnap.exists){
        const sd = sellerSnap.data();
        await withTimeout(sellerRef.update({gold: (sd.gold||0) + l.totalPrice}), 6000);
      }
    }catch(e){ /* buyer's purchase already succeeded; seller credit is best-effort */ }

    showToast(`Bought ${marketItemLabel(l).replace(/<[^>]+>/g,'')} for ${l.totalPrice}g.`);
    await loadMarketListings();
  }catch(e){
    showToast('Purchase failed — try again.');
  }
}

async function cancelListing(listingId){
  const c = S.char;
  if(!HAS_DB) return;
  const ref = DB.doc('marketListings/'+listingId);
  try{
    const snap = await withTimeout(ref.get(), 6000);
    if(!snap.exists){ await loadMarketListings(); return; }
    const l = snap.data();
    if(l.sellerId !== MY_ID){ showToast('This is not your listing.'); return; }
    if(l.kind!=='resource' && bagCount(c) >= BAG_CAPACITY){ showToast('Your bag is full — make room before cancelling.'); return; }
    if(l.kind==='resource'){
      c.resourceBag[l.itemId] = (c.resourceBag[l.itemId]||0) + l.qty;
    } else if(l.kind==='equipment'){
      c.inventory.push(Object.assign({}, l.equipmentSnapshot, {uid: uid()}));
    } else {
      const existing = c.inventory.find(i=>i.kind===l.kind && i.id===l.itemId);
      if(existing) existing.qty = (existing.qty||1) + l.qty;
      else c.inventory.push({uid: uid(), kind: l.kind, id: l.itemId, name: l.itemName, qty: l.qty, effect: l.effect});
    }
    await ref.delete();
    await saveCharacter(c);
    showToast('Listing cancelled — item returned to your bag.');
    await loadMarketListings();
  }catch(e){ showToast('Could not cancel — try again.'); }
}

async function findOpponents(myChar){
  const myLevel = myChar.level;
  const tolerance = Math.max(4, Math.round(myLevel*0.2));
  let candidates = [];
  if(HAS_DB){
    try{
      const snap = await withTimeout(DB.collection('players').limit(60).get(), 5000);
      const now = Date.now();
      snap.docs.forEach(d=>{
        const data = d.data();
        if(!data || d.id===MY_ID) return;
        if(!data.username || !data.class) return;
        if(Math.abs((data.level||1)-myLevel) > tolerance) return;
        if((data.pvp && data.pvp.protectedUntil||0) > now) return;
        candidates.push(data);
      });
    }catch(e){ /* ignore, fall back to bots */ }
  }
  // top up with bots so there is always something to fight
  while(candidates.length < 3){
    const lvl = clamp(myLevel + rndInt(-Math.min(3,tolerance), Math.min(3,tolerance)), 1, 400);
    const rating = clamp((myChar.pvp.rating||1000) + rndInt(-70,70), RATING_FLOOR, 5000);
    candidates.push(buildBotOpponent(lvl, rating));
  }
  candidates.sort((a,b)=> Math.abs((a.pvp?.rating||1000)-(myChar.pvp.rating||1000)) - Math.abs((b.pvp?.rating||1000)-(myChar.pvp.rating||1000)));
  return candidates.slice(0,3);
}
