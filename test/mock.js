// In-memory stand-in for the artifact runtime (db + user + room), shared by iframes.
window.MOCK = (function(){
  const store = new Map(); const docL = new Map(); const colL = new Map();
  const lat = () => 5 + Math.random()*40;
  const segs = p => p.split('/');
  const colOf = p => segs(p).slice(0,-1).join('/');
  const freeze = o => JSON.parse(JSON.stringify(o));
  function snapDoc(path){ const d = store.get(path); return { id: segs(path).pop(), exists: d!==undefined, data: () => d===undefined?undefined:freeze(d), metadata:{fromCache:false, hasPendingWrites:false} }; }
  function snapCol(cp){ const docs=[]; for (const [p] of store) if (colOf(p)===cp) docs.push(snapDoc(p)); docs.sort((a,b)=>a.id<b.id?-1:1); return {docs, size:docs.length, empty:!docs.length, docChanges:()=>[], metadata:{fromCache:false,hasPendingWrites:false}}; }
  function notify(path){ setTimeout(()=>{ (docL.get(path)||[]).forEach(f=>f(snapDoc(path))); const cp=colOf(path); (colL.get(cp)||[]).forEach(f=>f(snapCol(cp))); }, lat()); }
  let writes = 0;
  const db = {
    doc(path){ return {
      path, id: segs(path).pop(),
      get: async()=>{ await new Promise(r=>setTimeout(r,lat())); return snapDoc(path); },
      set: async(data)=>{ await new Promise(r=>setTimeout(r,lat())); const s = JSON.stringify(data); if (s.length > 256*1024) throw {code:'invalid_argument', message:'too big'}; writes++; store.set(path, JSON.parse(s)); notify(path); },
      update: async(data)=>{ store.set(path, Object.assign({}, store.get(path)||{}, data)); notify(path); },
      delete: async()=>{ store.delete(path); notify(path); },
      acquire: async()=>({acquired:true}),
      onSnapshot(next){ const a = docL.get(path)||[]; a.push(next); docL.set(path,a); setTimeout(()=>next(snapDoc(path)), lat()); return ()=>{ const b=docL.get(path); b.splice(b.indexOf(next),1); }; },
    }; },
    collection(cp){ return { path: cp, onSnapshot(next){ const a=colL.get(cp)||[]; a.push(next); colL.set(cp,a); setTimeout(()=>next(snapCol(cp)), lat()); return ()=>{ const b=colL.get(cp); b.splice(b.indexOf(next),1); }; }, doc: id => db.doc(cp+'/'+id) }; },
  };
  const peers = new Map(); const peerL = []; const topicL = new Map();
  function peersSnap(){ return [...peers.values()].map(p=>Object.freeze({...p})); }
  function firePeers(){ const ps = peersSnap(); setTimeout(()=>peerL.forEach(x=>x.fn({peers: ps.map(p=>({...p, isMe: p.by===x.uid, sameTab: p.peer===x.peer})), joined:[], left:[], updated:[]})), lat()); }
  function make(uid, name){
    const peer = 'p'+Math.random().toString(36).slice(2,8);
    const room = {
      connected: () => true,
      presence: async (patch) => { const cur = peers.get(peer) || {peer, by: uid, kind:'viewer', guest:false, presence:{}, updatedAt:Date.now()}; cur.presence = Object.assign({}, cur.presence, patch); peers.set(peer, cur); firePeers(); },
      onPeers: (fn) => { peerL.push({fn, uid, peer}); firePeers(); return ()=>{}; },
      on: (topic, fn) => { const a = topicL.get(topic)||[]; a.push(fn); topicL.set(topic,a); return ()=>{}; },
      emit: async (topic, data) => { (topicL.get(topic)||[]).forEach(f=>setTimeout(()=>f({topic, data, by: uid, peer, isMe:false, sameTab:false, kind:'viewer', guest:false}), lat())); },
      leave(){ peers.delete(peer); firePeers(); },
    };
    const user = { id: async()=>uid, me: async()=>({id:uid, name, isOwner:false, canEdit:true}), can: async()=>true, isOwner: async()=>false, canEdit: async()=>true, profiles: async()=>({}) };
    return { use: async (n) => (n==='db'?db:n==='user'?user:n==='room'?room:null), _room: room };
  }
  return { make, store, stats: () => ({writes}) };
})();
