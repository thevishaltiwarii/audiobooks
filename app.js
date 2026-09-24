let audio = new Audio();
let currentBook = null;
let saveDebounceTimer = null;
let networkSeverTimer = null;

// DOM Elements
const views = { library: document.getElementById('library-view'), player: document.getElementById('player-view') };
const listEl = document.getElementById('book-list');
const modal = document.getElementById('add-modal');
const btnPlayPause = document.getElementById('btn-play-pause');
const seekBar = document.getElementById('seek-bar');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const speedBtn = document.getElementById('btn-speed');

// Speeds
const speeds = [0.75, 1, 1.1, 1.25, 1.5, 1.75, 2];

async function initApp() {
  await DB.init();
  renderLibrary();
  setupListeners();
}

function normalizeDropboxUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.set('raw', '1');
    u.searchParams.delete('dl');
    return u.toString();
  } catch(e) {
    return url;
  }
}

function formatTime(sec) {
  if (!sec || isNaN(sec)) return "00:00:00";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

async function renderLibrary() {
  const books = await DB.getAll();
  books.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  listEl.innerHTML = books.map(book => {
    const pct = book.duration ? Math.min(100, (book.position / book.duration) * 100) : 0;
    return `
      <div class="book-card">
        <h3>${book.title}</h3>
        <p>${book.author || 'Unknown Author'}</p>
        <div class="progress-bar-bg"><div class="progress-bar-fill" style="width: ${pct}%"></div></div>
        <p>${formatTime(book.position)} / ${formatTime(book.duration)} (${Math.round(pct)}%)</p>
        <div class="book-actions">
          <button class="btn-delete" onclick="deleteBook('${book.id}')">Delete</button>
          <button class="primary-btn" onclick="openPlayer('${book.id}')">Continue</button>
        </div>
      </div>
    `;
  }).join('');
}

async function deleteBook(id) {
  if (confirm("Remove this book from library? (Dropbox file is untouched)")) {
    if (currentBook && currentBook.id === id) stopPlayer();
    await DB.delete(id);
    renderLibrary();
  }
}

async function openPlayer(id) {
  const books = await DB.getAll();
  currentBook = books.find(b => b.id === id);
  if (!currentBook) return;
  
  // Set UI
  document.getElementById('player-title').innerText = currentBook.title;
  document.getElementById('player-author').innerText = currentBook.author || '';
  audio.playbackRate = currentBook.playbackRate || 1;
  speedBtn.innerText = audio.playbackRate + 'x';
  
  // Initialize stream
  attachAudioStream(currentBook.dropboxUrl, currentBook.position);
  
  views.library.classList.remove('active');
  views.player.classList.active = 'active';
  views.player.style.display = 'flex';
  views.library.style.display = 'none';
}

function attachAudioStream(url, position) {
  audio.src = url;
  audio.preload = 'metadata'; // Prevent aggressive initial download
  audio.currentTime = position || 0;
  audio.load();
}

function stopPlayer() {
  audio.pause();
  audio.removeAttribute('src'); // Fully destroys connection
  audio.load();
  currentBook = null;
}

function togglePlay() {
  if (!currentBook) return;
  
  // Strict Buffering Control logic:
  // If we destroyed the src to save data while paused, we must re-attach it.
  if (!audio.src || audio.src === window.location.href) {
    attachAudioStream(currentBook.dropboxUrl, currentBook.position);
  }

  if (audio.paused) {
    audio.play();
  } else {
    audio.pause();
  }
}

function seekUpdate() {
  if (!currentBook) return;
  audio.currentTime = (seekBar.value / 100) * audio.duration;
  saveProgress();
}

// Throttle saving DB writes
function saveProgress() {
  if (!currentBook || isNaN(audio.currentTime)) return;
  currentBook.position = audio.currentTime;
  currentBook.duration = audio.duration || currentBook.duration;
  currentBook.lastPlayedAt = Date.now();
  
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    DB.save(currentBook);
  }, 3000); // Save every 3 seconds of active state
}

// Event Listeners
function setupListeners() {
  // Add Book Flow
  document.getElementById('btn-show-add').onclick = () => modal.classList.remove('hidden');
  document.getElementById('btn-cancel-add').onclick = () => modal.classList.add('hidden');
  
  document.getElementById('btn-save-add').onclick = async () => {
    const url = document.getElementById('input-url').value.trim();
    const title = document.getElementById('input-title').value.trim();
    const author = document.getElementById('input-author').value.trim();
    if (!url || !title) return alert('URL and Title are required.');
    
    const newBook = {
      id: 'book_' + Date.now(),
      title, author,
      dropboxUrl: normalizeDropboxUrl(url),
      position: 0, duration: 0,
      playbackRate: 1,
      createdAt: Date.now(),
      lastPlayedAt: Date.now()
    };
    await DB.save(newBook);
    modal.classList.add('hidden');
    document.getElementById('input-url').value = '';
    document.getElementById('input-title').value = '';
    document.getElementById('input-author').value = '';
    renderLibrary();
  };

  // Back to library
  document.getElementById('btn-back').onclick = () => {
    saveProgress();
    views.player.style.display = 'none';
    views.library.style.display = 'flex';
    renderLibrary();
  };

  // Player Controls
  btnPlayPause.onclick = togglePlay;
  
  document.getElementById('btn-skip-back').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 15); };
  document.getElementById('btn-skip-fwd').onclick = () => { audio.currentTime = Math.min(audio.duration, audio.currentTime + 30); };
  
  speedBtn.onclick = () => {
    if (!currentBook) return;
    let idx = speeds.indexOf(currentBook.playbackRate);
    currentBook.playbackRate = speeds[(idx + 1) % speeds.length];
    audio.playbackRate = currentBook.playbackRate;
    speedBtn.innerText = currentBook.playbackRate + 'x';
    DB.save(currentBook);
  };

  seekBar.oninput = seekUpdate;

  // Audio Engine Events
  audio.addEventListener('timeupdate', () => {
    if (isNaN(audio.duration)) return;
    timeCurrent.innerText = formatTime(audio.currentTime);
    timeTotal.innerText = formatTime(audio.duration);
    seekBar.value = (audio.currentTime / audio.duration) * 100;
    saveProgress();
  });

  audio.addEventListener('play', () => {
    btnPlayPause.innerText = '⏸';
    clearTimeout(networkSeverTimer);
  });

  audio.addEventListener('pause', () => {
    btnPlayPause.innerText = '▶';
    saveProgress(); // Immediate save on pause
    
    // DATA EFFICIENCY RULE: Stop downloading when paused
    // If paused for more than 10 seconds, fully kill the network connection to stop background buffering.
    clearTimeout(networkSeverTimer);
    networkSeverTimer = setTimeout(() => {
      if (audio.paused && currentBook) {
        console.log('Network severed to save data while paused.');
        audio.removeAttribute('src'); 
        audio.load();
      }
    }, 10000); 
  });

  // Handle app backgrounding (save immediately)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && currentBook) {
      saveProgress();
    }
  });
}

initApp();