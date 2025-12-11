const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'data');
const SESSIONS_FILE = path.join(DB_DIR, 'sessions.json');
const TRANSCRIPTS_FILE = path.join(DB_DIR, 'transcripts.json');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Initialize files if they don't exist
function initFile(filePath, defaultData = []) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
  }
}

initFile(SESSIONS_FILE, []);
initFile(TRANSCRIPTS_FILE, []);

// Generic read/write operations
function readData(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
    return [];
  }
}

function writeData(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err.message);
    return false;
  }
}

// App Sessions operations
const sessions = {
  getAll() {
    return readData(SESSIONS_FILE);
  },

  getById(sessionId) {
    const all = this.getAll();
    return all.find(s => s.id === sessionId);
  },

  create(sessionData) {
    const all = this.getAll();
    const newSession = {
      id: sessionData.id || Date.now().toString(),
      created_at: new Date().toISOString(),
      ...sessionData
    };
    all.push(newSession);
    writeData(SESSIONS_FILE, all);
    return newSession;
  },

  update(sessionId, updates) {
    const all = this.getAll();
    const index = all.findIndex(s => s.id === sessionId);
    if (index !== -1) {
      all[index] = { ...all[index], ...updates, updated_at: new Date().toISOString() };
      writeData(SESSIONS_FILE, all);
      return all[index];
    }
    return null;
  },

  delete(sessionId) {
    const all = this.getAll();
    const filtered = all.filter(s => s.id !== sessionId);
    if (filtered.length < all.length) {
      writeData(SESSIONS_FILE, filtered);
      return true;
    }
    return false;
  }
};

// Transcript Entries operations
const transcripts = {
  getAll() {
    return readData(TRANSCRIPTS_FILE);
  },

  getBySessionId(sessionId) {
    const all = this.getAll();
    return all.filter(t => t.app_session_id === sessionId);
  },

  create(transcriptData) {
    const all = this.getAll();
    const newTranscript = {
      id: transcriptData.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      created_at: new Date().toISOString(),
      ...transcriptData
    };
    all.push(newTranscript);
    writeData(TRANSCRIPTS_FILE, all);
    return newTranscript;
  },

  delete(transcriptId) {
    const all = this.getAll();
    const filtered = all.filter(t => t.id !== transcriptId);
    if (filtered.length < all.length) {
      writeData(TRANSCRIPTS_FILE, filtered);
      return true;
    }
    return false;
  },

  deleteBySessionId(sessionId) {
    const all = this.getAll();
    const filtered = all.filter(t => t.app_session_id !== sessionId);
    const deleted = all.length - filtered.length;
    if (deleted > 0) {
      writeData(TRANSCRIPTS_FILE, filtered);
      return deleted;
    }
    return 0;
  }
};

module.exports = {
  sessions,
  transcripts
};

