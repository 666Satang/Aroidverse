// adapter-fire.js — thin Firestore + Auth adapter (Firebase JS SDK 12.12.0 from the gstatic CDN). No business logic here.
// Usage: const adapter = createAdapter({ config: firebaseConfig });  (options.firebaseConfig is accepted too)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword,
  signOut as fbSignOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED,
  collection, doc, query, where, orderBy, limit, startAfter, onSnapshot,
  getDocs, getDocsFromCache, getDoc, getDocFromCache, writeBatch, deleteField
} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js';

const AUTH_MESSAGES = {
  'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  'auth/wrong-password': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  'auth/user-not-found': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  'auth/invalid-email': 'รูปแบบอีเมลไม่ถูกต้อง',
  'auth/missing-password': 'กรุณากรอกรหัสผ่าน',
  'auth/user-disabled': 'บัญชีนี้ถูกปิดใช้งาน',
  'auth/too-many-requests': 'ลองผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
  'auth/network-request-failed': 'ต่ออินเทอร์เน็ตไม่ได้ — ต้องออนไลน์เพื่อเข้าสู่ระบบ',
  'auth/operation-not-allowed': 'ยังไม่ได้เปิดการเข้าสู่ระบบด้วยอีเมลใน Firebase'
};

export default function createAdapter(options) {
  options = options || {};
  const config = options.config || options.firebaseConfig;
  if (!config) throw new Error('ยังไม่ได้ตั้งค่า Firebase');
  const app = initializeApp(config);
  const auth = getAuth(app);
  let db;
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: CACHE_SIZE_UNLIMITED }),
      ignoreUndefinedProperties: true
    });
  } catch (e) {
    db = initializeFirestore(app, { ignoreUndefinedProperties: true }); // private mode etc.: default (memory) cache
  }

  const errCbs = [];
  const emitError = e => {
    const code = e && e.code ? String(e.code) : '';
    const msg = code === 'permission-denied' ? 'ไม่มีสิทธิ์บันทึกข้อมูล (ตรวจ Firestore rules)'
      : 'ซิงค์ข้อมูลไม่สำเร็จ: ' + ((e && e.message) || code || 'unknown');
    const err = new Error(msg);
    err.code = code;
    errCbs.forEach(cb => { try { cb(err); } catch (x) { /* ignore */ } });
  };
  const toDoc = d => Object.assign({}, d.data(), { id: d.id });

  function buildQuery(q) {
    const c = [];
    if (q.where) {
      for (let i = 1; i + 1 < q.where.length; i += 2) c.push(where(q.where[0], q.where[i], q.where[i + 1]));
    }
    if (q.orderBy) c.push(orderBy(q.orderBy[0], q.orderBy[1] === 'desc' ? 'desc' : 'asc'));
    if (q.startAfter !== undefined && q.startAfter !== null) c.push(startAfter(q.startAfter));
    if (q.limit) c.push(limit(q.limit));
    return query(collection(db, q.col), ...c);
  }

  const onlineCbs = [];
  const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => onlineCbs.forEach(cb => cb(true)));
    window.addEventListener('offline', () => onlineCbs.forEach(cb => cb(false)));
  }

  return {
    DELETE: deleteField(),

    async init() {
      try { await setPersistence(auth, browserLocalPersistence); } catch (e) { /* keep default persistence */ }
    },
    onAuth(cb) { return onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email } : null)); },
    async signIn(email, password) {
      try { await signInWithEmailAndPassword(auth, String(email || '').trim(), String(password || '')); }
      catch (e) { throw new Error(AUTH_MESSAGES[e && e.code] || ('เข้าสู่ระบบไม่สำเร็จ (' + ((e && e.code) || 'error') + ')')); }
    },
    signOut() { return fbSignOut(auth); },

    newId() { return doc(collection(db, '_')).id; },

    watchDoc(path, cb) {
      return onSnapshot(doc(db, path), snap => cb(snap.exists() ? toDoc(snap) : null), emitError);
    },
    watch(q, cb) {
      return onSnapshot(buildQuery(q), { includeMetadataChanges: true }, snap => {
        cb({
          docs: snap.docs.map(toDoc),
          removed: snap.docChanges().filter(c => c.type === 'removed').map(c => c.doc.id),
          pending: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache
        });
      }, emitError);
    },
    async get(q) {
      const qr = buildQuery(q);
      if (q.source === 'cache') {
        try { return (await getDocsFromCache(qr)).docs.map(toDoc); } catch (e) { return []; }
      }
      try { return (await getDocs(qr)).docs.map(toDoc); }
      catch (e) {
        if (e && e.code === 'unavailable') return (await getDocsFromCache(qr)).docs.map(toDoc); // offline: whatever we have
        throw e;
      }
    },
    async getDoc(path, opts) {
      const ref = doc(db, path);
      if (opts && opts.source === 'cache') {
        try { const s = await getDocFromCache(ref); return s.exists() ? toDoc(s) : null; } catch (e) { return null; }
      }
      let snap;
      try { snap = await getDoc(ref); }
      catch (e1) {
        try { snap = await getDocFromCache(ref); } catch (e2) { throw e1; }
      }
      return snap.exists() ? toDoc(snap) : null;
    },

    // FIRE-AND-FORGET: never awaited (offline writes only resolve when the server acknowledges them).
    commit(ops) {
      for (let i = 0; i < ops.length; i += 450) { // Firestore batch limit is 500 writes
        try {
          const batch = writeBatch(db);
          ops.slice(i, i + 450).forEach(o => {
            const ref = doc(db, o.path);
            if (o.op === 'set') batch.set(ref, o.data);
            else if (o.op === 'merge') batch.set(ref, o.data, { merge: true });
            else if (o.op === 'delete') batch.delete(ref);
          });
          batch.commit().catch(emitError);
        } catch (e) { emitError(e); }
      }
    },
    onError(cb) { errCbs.push(cb); },
    isOnline,
    onOnline(cb) { onlineCbs.push(cb); return () => { const i = onlineCbs.indexOf(cb); if (i >= 0) onlineCbs.splice(i, 1); }; }
  };
}
