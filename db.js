// Cloud note sync (Phase 2/3). Supabase is the source of truth on login;
// localStorage stays the fast/offline cache for everything in between.
// Every function here fails soft — if there's no session, or the network
// call itself fails, the caller (see index.html: saveActiveNote, createNote,
// deleteNote) already treats this as a fire-and-forget background op and
// never blocks the drawing/typing/localStorage path on its outcome.

// Cached user, not re-fetched with getUser() on every call. getUser() always
// makes its own network round trip, and calling it fresh from every upsert
// was the actual cause of "second device to sign in" upserts silently
// no-op'ing under real mobile network latency. index.html's checkSession()
// and onAuthStateChange() keep this in sync with the live session — by the
// time any of these functions can be called, it's already set.
let currentUser = null;

// safeGetLocal() is defined in index.html's inline <script> (loaded after
// this file), not here — getPendingDeletes() below calls it, which works
// because that call only ever happens well after the whole page has loaded
// and safeGetLocal is a global by then, not at this file's own load time.
async function fetchNotesFromCloud() {
  if (!currentUser) return null; // not logged in — caller falls back to localStorage
  const { data, error } = await supabaseClient
    .from('notes')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) { console.error('Fetch failed:', error); return null; }
  return data;
}

async function upsertNoteToCloud(note) {
  if (!currentUser) {
    console.warn('No user session — skipping cloud save');
    return;
  }

  if (note.inkData && note.inkData.length > 800 * 1024) {
    console.warn('Large ink note, consider reducing canvas size');
  }

  const { error } = await supabaseClient
    .from('notes')
    .upsert({
      id: note.id,
      user_id: currentUser.id,
      title: note.title || '',
      type: note.type || 'ink',
      text_data: note.textData || '',
      ink_data: note.inkData || null,
      zoom: note.zoom || 1,
      pan_x: note.panX || 0,
      pan_y: note.panY || 0,
      folder_id: note.folderId || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

  if (error) {
    console.error('Upsert failed:', error);
    // The note is already safe in localStorage (written before this call
    // ever runs) — this just lets the user know the cloud copy is behind
    setSaveStatus('⚠ sync failed — saved locally');
    setTimeout(() => setSaveStatus('saved'), 4000);
  }
}

// Returns true once the row is actually gone from Supabase, false otherwise
// (including a thrown network error) — callers use this to decide whether
// the delete needs to be queued and retried later (see addToPendingDeletes).
async function deleteNoteFromCloud(noteId) {
  if (!currentUser) return true; // not logged in — nothing to delete server-side, trust local
  try {
    const { error } = await supabaseClient
      .from('notes')
      .delete()
      .eq('id', noteId)
      .eq('user_id', currentUser.id); // extra safety: never delete a row this user doesn't own
    if (error) { console.error('Delete failed:', error); return false; }
    return true;
  } catch (err) {
    console.error('Delete failed:', err);
    return false;
  }
}

function mapCloudNoteToLocal(cloudNote) {
  return {
    id: cloudNote.id,
    title: cloudNote.title,
    type: cloudNote.type,
    textData: cloudNote.text_data,
    inkData: cloudNote.ink_data,
    zoom: cloudNote.zoom,
    panX: cloudNote.pan_x,
    panY: cloudNote.pan_y,
    folderId: cloudNote.folder_id || null,
    created: new Date(cloudNote.created_at).getTime(),
    updated: new Date(cloudNote.updated_at).getTime()
  };
}

// ── Cloud folder sync — same fail-soft, fire-and-forget contract as above ──

async function fetchFoldersFromCloud() {
  if (!currentUser) return null;
  const { data, error } = await supabaseClient
    .from('folders')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) { console.error('Fetch folders failed:', error); return null; }
  return data;
}

async function upsertFolderToCloud(folder) {
  if (!currentUser) {
    console.warn('No user session — skipping cloud save');
    return;
  }
  const { error } = await supabaseClient
    .from('folders')
    .upsert({
      id: folder.id,
      user_id: currentUser.id,
      name: folder.name,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
  if (error) console.error('Folder upsert failed:', error);
}

// Same true/false contract as deleteNoteFromCloud above
async function deleteFolderFromCloud(folderId) {
  if (!currentUser) return true;
  try {
    const { error } = await supabaseClient
      .from('folders')
      .delete()
      .eq('id', folderId)
      .eq('user_id', currentUser.id);
    if (error) { console.error('Folder delete failed:', error); return false; }
    return true;
  } catch (err) {
    console.error('Folder delete failed:', err);
    return false;
  }
}

function mapCloudFolder(f) {
  return {
    id: f.id,
    name: f.name,
    created: new Date(f.created_at).getTime(),
    updated: new Date(f.updated_at).getTime()
  };
}

// ── Pending deletes queue ──
// A delete that fails to reach Supabase (offline, transient error) must not
// be silently forgotten — the row is still gone locally, but still exists in
// the cloud, so the very next fetch (initApp/syncNow) would resurrect it as
// a "ghost". Queuing it here means initApp()/syncNow() can filter ghosts out
// of whatever the cloud returns, and flushPendingDeletes() gets another shot
// at the actual delete on every subsequent sync until it succeeds.
const PENDING_DELETES_KEY = 'welovenote_pending_deletes';

function getPendingDeletes() {
  return safeGetLocal(PENDING_DELETES_KEY, []);
}

function addToPendingDeletes(type, id) {
  const pending = getPendingDeletes();
  if (!pending.find(p => p.id === id)) {
    pending.push({ type, id, timestamp: Date.now() });
    localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(pending));
  }
}

function removePendingDelete(id) {
  const updated = getPendingDeletes().filter(p => p.id !== id);
  localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(updated));
}

async function flushPendingDeletes() {
  if (!currentUser) return;
  const pending = getPendingDeletes();
  if (pending.length === 0) return;

  console.log(`Flushing ${pending.length} pending delete(s)`);
  for (const item of pending) {
    const success = item.type === 'note'
      ? await deleteNoteFromCloud(item.id)
      : await deleteFolderFromCloud(item.id);
    if (success) {
      removePendingDelete(item.id);
      console.log(`Flushed pending delete: ${item.type} ${item.id}`);
    }
  }
}
