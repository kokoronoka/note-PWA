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

async function deleteNoteFromCloud(noteId) {
  if (!currentUser) return; // not logged in — nothing to delete server-side
  const { error } = await supabaseClient
    .from('notes')
    .delete()
    .eq('id', noteId);
  if (error) console.error('Delete failed:', error);
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
    created: new Date(cloudNote.created_at).getTime(),
    updated: new Date(cloudNote.updated_at).getTime()
  };
}
