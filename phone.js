// KOR ELEC Report iPhone app: unlocks the encrypted reports once, then lists and shows them.
// Encrypted files are kept in IndexedDB (not Cache Storage: other apps on this address clear
// each other's caches), so reports already opened can be read offline.
(function () {
  const app = document.getElementById('app');
  const back = document.getElementById('back');
  const barTitle = document.getElementById('bar-title');
  const DB_NAME = 'kor-elec-report';
  let key = null;
  let reports = [];
  let offline = false;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---------- IndexedDB ----------

  function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('keys');   // the CryptoKey itself; it cannot be read back out
        request.result.createObjectStore('files');  // encrypted library and reports for offline reading
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function stored(name, mode, action) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = action(db.transaction(name, mode).objectStore(name));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  const loadSavedKey = () => stored('keys', 'readonly', (s) => s.get('main')).catch(() => null);
  const saveKey = (record) => stored('keys', 'readwrite', (s) => s.put(record, 'main'));
  const forgetKey = () => stored('keys', 'readwrite', (s) => s.delete('main'));
  const loadFile = (name) => stored('files', 'readonly', (s) => s.get(name)).catch(() => undefined);
  const saveFile = (name, buffer) => stored('files', 'readwrite', (s) => s.put(buffer, name)).catch(() => {});
  const fileNames = () => stored('files', 'readonly', (s) => s.getAllKeys()).catch(() => []);
  const dropFile = (name) => stored('files', 'readwrite', (s) => s.delete(name)).catch(() => {});

  // ---------- Crypto ----------

  function bytes(base64) {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  }

  async function deriveKey(passphrase, info) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(info.salt), iterations: info.iterations },
      material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
  }

  async function openJson(buffer) {
    const data = new Uint8Array(buffer);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // ---------- Loading ----------

  async function fetchBuffer(url) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(String(response.status));
    return response.arrayBuffer();
  }

  async function start() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    back.addEventListener('click', () => { location.hash = ''; });
    window.addEventListener('hashchange', () => { if (key) route(); });

    const saved = await loadSavedKey();
    let info = null;
    try {
      const response = await fetch('data/key.json', { cache: 'no-cache' });
      if (response.status === 404) {
        showMessage('아직 게시된 보고서가 없습니다', '맥에서 보고서를 만든 뒤 비밀번호를 입력해 게시하면 1~2분 후 여기에 나옵니다.');
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      info = await response.json();
    } catch (error) {
      if (saved) {  // offline: open what this iPhone already has
        offline = true;
        key = saved.key;
        await loadLibrary();
        return;
      }
      showMessage('불러오지 못했습니다', '인터넷에 연결한 뒤 다시 열어 주세요.');
      return;
    }
    if (saved && saved.salt === info.salt) {
      key = saved.key;
      await loadLibrary();
    } else {
      showLock(info, Boolean(saved));
    }
  }

  async function loadLibrary() {
    let buffer;
    try {
      buffer = await fetchBuffer('data/library.bin');
      saveFile('library', buffer);
    } catch (error) {
      offline = true;
      buffer = await loadFile('library');
    }
    try {
      if (!buffer) throw new Error('none');
      reports = (await openJson(buffer)).reports;
    } catch (error) {
      showMessage('목록을 열지 못했습니다', '인터넷에 연결한 뒤 다시 열어 주세요. 계속 안 되면 아래 [잠그기]로 비밀번호를 다시 입력하세요.', true);
      return;
    }
    if (!offline) cleanOldFiles();
    route();
  }

  async function cleanOldFiles() {
    const wanted = new Set(['library', ...reports.map((r) => r.file)]);
    for (const name of await fileNames()) if (!wanted.has(name)) dropFile(name);
  }

  async function reportBody(report) {
    let buffer = await loadFile(report.file);  // file names change with the content, so a saved copy is never stale
    if (!buffer) {
      buffer = await fetchBuffer(report.file);
      saveFile(report.file, buffer);
    }
    return (await openJson(buffer)).html;
  }

  // ---------- Screens ----------

  function setBar(title, showBack) {
    barTitle.textContent = title;
    back.hidden = !showBack;
  }

  function showMessage(title, text, withLock = false) {
    setBar('KOR ELEC Report', false);
    const box = el('section', 'message');
    box.append(el('h1', '', title), el('p', 'muted', text));
    if (withLock) box.append(lockButton());
    app.replaceChildren(box);
  }

  function showLock(info, changed) {
    setBar('KOR ELEC Report', false);
    const box = el('form', 'lock');
    const icon = el('img', 'lock-icon');
    icon.src = 'icons/icon-192.png';
    icon.alt = '';
    box.append(icon, el('h1', '', 'KOR ELEC Report'));
    box.append(el('p', 'muted', changed
      ? '맥에서 게시 비밀번호를 새로 정했습니다. 새 비밀번호를 입력하세요.'
      : '맥에서 게시할 때 정한 비밀번호를 한 번 입력하세요. 이 아이폰에서는 다시 묻지 않습니다.'));
    const input = el('input');
    input.type = 'password';
    input.autocomplete = 'current-password';
    input.placeholder = '게시 비밀번호';
    const error = el('p', 'error');
    error.hidden = true;
    const go = el('button', 'button primary', '열기');
    go.type = 'submit';
    box.append(input, error, go);
    box.addEventListener('submit', async (event) => {
      event.preventDefault();
      go.disabled = true;
      go.textContent = '확인 중…';
      error.hidden = true;
      try {
        const candidate = await deriveKey(input.value, info);
        const check = bytes(info.check);
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: check.slice(0, 12) }, candidate, check.slice(12));
        key = candidate;
        input.value = '';
        await saveKey({ key: candidate, salt: info.salt });
        await loadLibrary();
      } catch (problem) {
        error.textContent = '비밀번호가 맞지 않습니다.';
        error.hidden = false;
        go.disabled = false;
        go.textContent = '열기';
      }
    });
    app.replaceChildren(box);
    input.focus();
  }

  function lockButton() {
    const lock = el('button', 'link', '잠그기');
    lock.type = 'button';
    lock.addEventListener('click', async () => {
      if (!confirm('이 아이폰에서 비밀번호를 지우고 잠글까요? 다음에 열 때 다시 입력합니다.')) return;
      await forgetKey();
      location.hash = '';
      location.reload();
    });
    return lock;
  }

  function route() {
    const id = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    const report = reports.find((r) => r.id === id);
    if (report) showReport(report);
    else showList();
  }

  function showList() {
    setBar('KOR ELEC Report', false);
    const page = el('section', 'list');
    if (offline) page.append(el('p', 'offline', '오프라인: 이 아이폰에 저장된 내용만 보입니다.'));
    if (!reports.length) page.append(el('p', 'muted empty', '아직 게시된 보고서가 없습니다.'));
    reports.forEach((report, index) => {
      const card = el('a', 'card');
      card.href = `#/${encodeURIComponent(report.id)}`;
      const top = el('div', 'card-top');
      top.append(el('span', 'card-date', report.date));
      if (index === 0) top.append(el('span', 'badge', '최신'));
      card.append(top, el('div', 'card-title', report.title.replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, '')));
      const facts = [];
      if (report.related) facts.push(`관련 기사 ${report.related}건`);
      if (report.open_jobs) facts.push(`원주 구인 ${report.open_jobs}건`);
      if (facts.length) card.append(el('div', 'card-facts muted', facts.join(' · ')));
      page.append(card);
    });
    const foot = el('div', 'foot');
    foot.append(lockButton());
    page.append(foot);
    app.replaceChildren(page);
    window.scrollTo(0, 0);
  }

  async function showReport(report) {
    setBar(report.date, true);
    app.replaceChildren(el('p', 'muted loading', '여는 중…'));
    let html;
    try {
      html = await reportBody(report);
    } catch (error) {
      app.replaceChildren(el('p', 'error loading', '이 보고서를 열지 못했습니다. 인터넷에 연결한 뒤 다시 열어 주세요.'));
      return;
    }
    const doc = el('article', 'report');
    doc.innerHTML = html;  // built on the Mac from escaped markdown; CSP blocks any script
    doc.querySelectorAll('a[href]').forEach((link) => {
      if (!/^https?:\/\//.test(link.getAttribute('href'))) { link.removeAttribute('href'); return; }
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    });
    doc.querySelectorAll('table').forEach((table) => {
      const labels = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      if (labels.length < 5) {  // short tables (stats) stay tables
        const wrap = el('div', 'table-wrap');
        table.replaceWith(wrap);
        wrap.append(table);
        return;
      }
      // Wide tables (jobs) become one card per row: too narrow on a phone otherwise.
      const cards = el('div', 'row-cards');
      table.querySelectorAll('tbody tr').forEach((row) => {
        const card = el('div', 'row-card');
        [...row.children].forEach((cell, i) => {
          if (!cell.textContent.trim()) return;
          if (i === 0) {
            card.append(el('div', 'row-card-title', cell.textContent.trim()));
            return;
          }
          const line = el('div', 'row-card-line');
          line.append(el('span', 'row-card-label', labels[i] || ''));
          const value = el('span', 'row-card-value');
          value.append(...cell.childNodes);
          line.append(value);
          card.append(line);
        });
        cards.append(card);
      });
      table.replaceWith(cards);
    });
    const headings = [...doc.querySelectorAll('h2')];
    const jump = el('nav', 'jump');
    headings.forEach((heading, i) => {
      heading.id = `s${i}`;
      const chip = el('button', 'chip', heading.textContent.replace(/\s*\(.*\)$/, ''));
      chip.type = 'button';
      chip.addEventListener('click', () => heading.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      jump.append(chip);
    });
    const top = el('button', 'to-top', '↑');
    top.type = 'button';
    top.setAttribute('aria-label', '맨 위로');
    top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    app.replaceChildren(jump, doc, top);
    window.scrollTo(0, 0);
  }

  start();
})();
