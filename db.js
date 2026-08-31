// Cloud note sync (Phase 2). Supabase is the source of truth on login;
// localStorage stays the fast/offline cache for everything in between.
// Every function here fails soft — if there's no session, or the network
// call itself fails, the caller (see index.html: saveActiveNote, createNote,
// deleteNote) already treats this as a fire-and-forget background op and
// never blocks the drawing/typing/localStorage path on its outcome.

async function getCurrentUser() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  return user;
}

async function fetchNotesFromCloud() {
  const user = await getCurrentUser();
  if (!user) return null; // not logged in — caller falls back to localStorage
  const { data, error } = await supabaseClient
    .from('notes')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) { console.error('Fetch failed:', error); return null; }
  return data;
}

async function upsertNoteToCloud(note) {
  const user = await getCurrentUser();
  if (!user) return; // not logged in — nothing to sync

  if (note.inkData && note.inkData.length > 800 * 1024) {
    console.warn('Large ink note, consider reducing canvas size');
  }

  const { error } = await supabaseClient
    .from('notes')
    .upsert({
      id: note.id,
      user_id: user.id,
      title: note.title || '',
      type: note.type || 'ink',
      text_data: note.textData || '',
      ink_data: note.inkData || null,
      zoom: note.zoom || 1,
      pan_x: note.panX || 0,
      pan_y: note.panY || 0,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
  if (error) console.error('Upsert failed:', error);
}

async function deleteNoteFromCloud(noteId) {
  const user = await getCurrentUser();
  if (!user) return; // not logged in — nothing to delete server-side
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
