'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const players = new Set();
const formatTime = seconds => `${String(Math.floor((seconds || 0) / 60)).padStart(2, '0')}:${String(Math.floor((seconds || 0) % 60)).padStart(2, '0')}`;

class SyncedVideos {
  constructor(videos, { container, button = null, onTime = null, visible = false, subject = 'comparison' } = {}) {
    this.videos = videos;
    this.master = videos[videos.length - 1];
    this.container = container;
    this.button = button;
    this.onTime = onTime;
    this.subject = subject;
    this.enabled = true;
    this.visible = visible;
    this.wantsPlay = !reducedMotion.matches;
    this.active = visible;
    this.sourceRevision = 0;
    videos.forEach(video => {
      video.muted = true;
      video.loop = true;
      video.addEventListener('loadedmetadata', () => this.synchronize(true));
      video.addEventListener('canplay', () => { if (this.shouldPlay()) this.start(); });
    });
    this.master.addEventListener('timeupdate', () => {
      this.synchronize();
      this.onTime?.(this.master.currentTime, this.master.duration);
    });
    this.master.addEventListener('playing', () => this.showButton(true));
    this.master.addEventListener('pause', () => this.showButton(false));
    button?.addEventListener('click', () => this.toggle());
    this.showButton(false);
    players.add(this);
  }

  shouldPlay() { return this.enabled && this.wantsPlay && this.visible && !document.hidden; }

  activate() {
    this.active = true;
    this.videos.forEach(video => {
      if (video.dataset.lazySrc) {
        video.preload = 'auto';
        video.src = video.dataset.lazySrc;
        delete video.dataset.lazySrc;
        video.load();
      }
    });
    if (this.shouldPlay()) this.start();
  }

  async start() {
    if (!this.shouldPlay()) return;
    const results = await Promise.allSettled(this.videos.map(video => video.play()));
    if (results.some(result => result.status === 'rejected') && this.master.paused) this.showButton(false);
  }

  stop() { this.videos.forEach(video => video.pause()); }

  toggle() {
    this.wantsPlay = this.master.paused;
    if (this.wantsPlay) { this.visible = true; this.activate(); }
    else this.stop();
  }

  showButton(playing) {
    if (!this.button) return;
    this.button.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${this.subject}`);
    $('use', this.button).setAttribute('href', playing ? '#i-pause' : '#i-play');
    const text = $('span', this.button);
    if (text) text.textContent = playing ? 'Pause animation' : 'Play animation';
  }

  synchronize(force = false) {
    const time = this.master.currentTime;
    for (const video of this.videos) {
      if (video === this.master || video.readyState < 1) continue;
      if (force || Math.abs(video.currentTime - time) > .13) {
        try { video.currentTime = Math.min(time, Math.max(0, video.duration - .025)); } catch (_) { /* A source may still be switching. */ }
      }
    }
  }

  seek(fraction) {
    if (!Number.isFinite(this.master.duration)) return;
    const target = Math.max(0, Math.min(this.master.duration - .035, fraction * this.master.duration));
    this.master.currentTime = target;
    this.videos.forEach(video => {
      if (video !== this.master && Number.isFinite(video.duration)) video.currentTime = Math.min(target, Math.max(0, video.duration - .035));
    });
    this.onTime?.(this.master.currentTime, this.master.duration);
  }

  changeSources(sources) {
    this.sourceRevision++;
    this.stop();
    this.videos.forEach((video, index) => {
      const source = sources[index];
      video.poster = source.replace(/\.mp4$/, '.webp');
      if (this.active) {
        video.preload = 'auto';
        video.src = source;
        video.load();
      } else video.dataset.lazySrc = source;
    });
    this.onTime?.(0, 0);
  }

  replaceSource(video, source) {
    const revision = ++this.sourceRevision;
    const time = this.master.currentTime;
    this.stop();
    video.addEventListener('loadedmetadata', () => {
      if (revision !== this.sourceRevision) return;
      this.videos.forEach(item => {
        if (Number.isFinite(item.duration)) item.currentTime = Math.min(time, Math.max(0, item.duration - .035));
      });
      this.synchronize(true);
      this.onTime?.(this.master.currentTime, this.master.duration);
      if (this.shouldPlay()) this.start();
    }, { once: true });
    video.poster = source.replace(/\.mp4$/, '.webp');
    video.src = source;
    video.load();
  }
}

const teaserScene = {
  label: 'Bottle', core: 'bottle-core', duration: 18,
  comparisons: { input: ['Input video', 'bottle-input'], deformable: ['DeformableGS', 'bottle-deformable'], '4dgs': ['4DGS', 'bottle-4dgs'], before: ['Before pruning', 'bottle-before'] }
};

let currentBaseline = 'input';
const compareStage = $('#comparison-panel');
const compareBefore = $('#compare-before');
const compareAfter = $('#compare-after');
const uncertaintyVideo = $('#compare-uncertainty');
const bottleVideos = [compareBefore, uncertaintyVideo, compareAfter];
const timeline = $('#compare-timeline');
const baselineSelect = $('#baseline-select');
const comparePlayer = new SyncedVideos(bottleVideos, {
  container: $('#real-scene-panel'), button: $('#compare-play'), visible: false,
  onTime(time, duration) {
    $('#compare-time').textContent = formatTime(time);
    $('#compare-duration').textContent = formatTime(Number.isFinite(duration) && duration > 0 ? Math.round(duration) : teaserScene.duration);
    timeline.value = Number.isFinite(duration) && duration > 0 ? Math.round(time / duration * 1000) : 0;
  }
});

function updateComparisonLabels() {
  const scene = teaserScene;
  const [label] = scene.comparisons[currentBaseline];
  $('#before-label').textContent = label;
  compareBefore.setAttribute('aria-label', `${scene.label}: ${label}`);
  compareAfter.setAttribute('aria-label', `${scene.label}: ReCan-GS reconstruction`);
  $('#comparison-note').textContent = 'Drag the two dividers to resize Input, Jacobian uncertainty, and Reconstruction within the same view.';
}

baselineSelect.addEventListener('change', () => {
  currentBaseline = baselineSelect.value;
  updateComparisonLabels();
  updateDividers();
  const [, source] = teaserScene.comparisons[currentBaseline];
  $('#compare-error').hidden = true;
  comparePlayer.replaceSource(compareBefore, `assets/${source}.mp4`);
});
const boundaries = { first: 100 / 3, second: 200 / 3 };
function updateDividers() {
  const { first, second } = boundaries;
  compareStage.style.setProperty('--split-first', `${first}%`);
  compareStage.style.setProperty('--split-second', `${second}%`);
  const widths = [first, second - first, 100 - second];
  const centers = [first / 2, (first + second) / 2, (second + 100) / 2];
  const stageWidth = compareStage.getBoundingClientRect().width;
  ['before-label', 'jacobian-label', 'after-label'].forEach((id, index) => {
    const label = $(`#${id}`);
    label.style.left = `${centers[index]}%`;
    label.style.maxWidth = `${Math.max(0, stageWidth * widths[index] / 100 - 12)}px`;
    label.hidden = widths[index] * stageWidth / 100 < 68;
  });
  const legend = $('#hero-map-legend');
  legend.style.left = `${centers[1]}%`;
  legend.hidden = widths[1] * stageWidth / 100 < 110;
  $('#first-divider').setAttribute('aria-valuemax', String(second));
  $('#second-divider').setAttribute('aria-valuemin', String(first));
  $('#first-divider').setAttribute('aria-valuenow', String(first));
  $('#second-divider').setAttribute('aria-valuenow', String(second));
  $('#first-divider').setAttribute('aria-label', `${teaserScene.comparisons[currentBaseline][0]} and Jacobian boundary`);
  $('#second-divider').setAttribute('aria-label', 'Jacobian and reconstruction boundary');
  const description = `${Math.round(widths[0])} percent input or baseline, ${Math.round(widths[1])} percent Jacobian uncertainty, ${Math.round(widths[2])} percent reconstruction`;
  $$('.region-divider').forEach(handle => handle.setAttribute('aria-valuetext', description));
  compareStage.classList.toggle('close-dividers', second - first < 7);
}
function setBoundary(name, value) {
  boundaries[name] = name === 'first'
    ? Math.max(0, Math.min(boundaries.second, value))
    : Math.max(boundaries.first, Math.min(100, value));
  updateDividers();
}
$$('[data-boundary]').forEach(handle => {
  const name = handle.dataset.boundary;
  let dragId = null;
  const move = event => {
    const rect = compareStage.getBoundingClientRect();
    setBoundary(name, (event.clientX - rect.left) / rect.width * 100);
  };
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    dragId = event.pointerId;
    handle.setPointerCapture(dragId);
    move(event);
  });
  handle.addEventListener('pointermove', event => {
    if (dragId === event.pointerId) move(event);
  });
  const release = event => {
    if (dragId !== event.pointerId) return;
    if (handle.hasPointerCapture(dragId)) handle.releasePointerCapture(dragId);
    dragId = null;
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);
  handle.addEventListener('lostpointercapture', () => { dragId = null; });
  handle.addEventListener('keydown', event => {
    let value = boundaries[name];
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') value += 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') value -= 1;
    else if (event.key === 'PageUp') value += 10;
    else if (event.key === 'PageDown') value -= 10;
    else if (event.key === 'Home') value = name === 'first' ? 0 : boundaries.first;
    else if (event.key === 'End') value = name === 'first' ? boundaries.second : 100;
    else return;
    event.preventDefault();
    setBoundary(name, value);
  });
});
window.addEventListener('resize', updateDividers);
updateDividers();
timeline.addEventListener('input', () => comparePlayer.seek(Number(timeline.value) / 1000));
bottleVideos.forEach(video => video.addEventListener('error', () => { $('#compare-error').hidden = false; }));

// Expand the original interactive surface, preserving its divider and shared playback.
const heroDialog = document.createElement('dialog');
heroDialog.className = 'hero-expanded-dialog';
heroDialog.setAttribute('aria-label', 'Expanded comparison');
document.body.append(heroDialog);
let expandedHero = null;
function resumeComparisonAt(time) {
  updateDividers();
  const rect = comparePlayer.container.getBoundingClientRect();
  comparePlayer.visible = heroDialog.open || (rect.top < window.innerHeight && rect.bottom > 0);
  if (Number.isFinite(comparePlayer.master.duration)) comparePlayer.seek(time / comparePlayer.master.duration);
  if (comparePlayer.shouldPlay()) comparePlayer.start();
}
$$('[data-expand-result]').forEach(button => button.addEventListener('click', () => {
  if (heroDialog.open) { heroDialog.close(); return; }
  const figure = $('#hero-result-core');
  const controls = $('.paired-playback');
  const figureSlot = document.createComment('expanded comparison position');
  const controlsSlot = document.createComment('shared controls position');
  const time = comparePlayer.master.currentTime;
  figure.before(figureSlot);
  controls.before(controlsSlot);
  expandedHero = { figure, controls, figureSlot, controlsSlot, button };
  heroDialog.append(figure, controls);
  button.setAttribute('aria-pressed', 'true');
  button.setAttribute('aria-label', 'Return to page');
  $('use', button).setAttribute('href', '#i-close');
  heroDialog.showModal();
  requestAnimationFrame(() => resumeComparisonAt(time));
}));
heroDialog.addEventListener('close', () => {
  if (!expandedHero) return;
  const time = comparePlayer.master.currentTime;
  const { figure, controls, figureSlot, controlsSlot, button } = expandedHero;
  figureSlot.replaceWith(figure);
  controlsSlot.replaceWith(controls);
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', 'Expand comparison');
  $('use', button).setAttribute('href', '#i-expand');
  expandedHero = null;
  button.focus({ preventScroll: true });
  requestAnimationFrame(() => resumeComparisonAt(time));
});
heroDialog.addEventListener('click', event => {
  if (event.target === heroDialog) heroDialog.close();
});
const startAtPassage = () => {
  if (Number.isFinite(comparePlayer.master.duration)) comparePlayer.seek(14 / comparePlayer.master.duration);
};
if (comparePlayer.master.readyState >= 1) startAtPassage();
else comparePlayer.master.addEventListener('loadedmetadata', startAtPassage, { once: true });

const syntheticScenes = {
  jeep: {
    label: 'Jeep', result: 'jeep-core', resultLabel: 'ReCan-GS', duration: 20, default: 'deformable',
    comparisons: { deformable: ['DeformableGS', 'jeep-deformable'], '4dgs': ['4DGS', 'jeep-4dgs'] },
    note: 'Matched reconstruction views of a stop-motion Jeep. ReCan-GS removes transient hands and reduces moving-shadow artifacts. Choose DeformableGS or 4DGS to compare the same viewpoint.'
  },
  squat: {
    label: 'Squatting', result: 'squat-overlay', resultLabel: 'ReCan-GS + distractor overlay', duration: 18.5, default: 'input',
    comparisons: { input: ['Input video', 'squat-input'], deformable: ['DeformableGS', 'squat-deformable'], '4dgs': ['4DGS', 'squat-4dgs'] },
    note: 'The faint second figure visualizes the separated Distractor Gaussians over the Core render. It is an explanatory overlay, not part of the Core reconstruction.'
  },
  balls: {
    label: 'Bouncing Balls', result: 'balls-core', resultLabel: 'ReCan-GS', duration: 10, default: 'input',
    comparisons: { input: ['Input video', 'balls-input'], deformable: ['DeformableGS', 'balls-deformable'], '4dgs': ['4DGS', 'balls-4dgs'], before: ['Without regularization', 'balls-before'] },
    note: 'Compare the moving balls against the input or a baseline at the same point in the sequence. The input includes a passing distractor; reconstruction artifacts remain visible.'
  }
};
let syntheticScene = 'jeep';
const syntheticBefore = $('#synthetic-before');
const syntheticAfter = $('#synthetic-after');
const syntheticBaseline = $('#synthetic-baseline');
const syntheticTimeline = $('#synthetic-timeline');
const syntheticPlayer = new SyncedVideos([syntheticBefore, syntheticAfter], {
  container: $('.synthetic-explorer'), button: $('#synthetic-play'), subject: 'scene comparison',
  onTime(time, duration) {
    $('#synthetic-time').textContent = formatTime(time);
    $('#synthetic-duration').textContent = formatTime(Math.round(Number.isFinite(duration) && duration > 0 ? duration : syntheticScenes[syntheticScene].duration));
    syntheticTimeline.value = Number.isFinite(duration) && duration > 0 ? Math.round(time / duration * 1000) : 0;
  }
});
function loadSyntheticComparison() {
  const scene = syntheticScenes[syntheticScene];
  const [label, source] = scene.comparisons[syntheticBaseline.value];
  $('#synthetic-error').hidden = true;
  $('#synthetic-before-label').textContent = label;
  $('#synthetic-result-label').textContent = scene.resultLabel;
  $('#synthetic-note').textContent = scene.note;
  $('#synthetic-panel').classList.toggle('balls-scene', syntheticScene === 'balls');
  syntheticBefore.setAttribute('aria-label', `${scene.label}: ${label}`);
  syntheticAfter.setAttribute('aria-label', `${scene.label}: ${scene.resultLabel}`);
  syntheticPlayer.changeSources([`assets/${source}.mp4`, `assets/${scene.result}.mp4`]);
}
$$('[data-synthetic]').forEach(button => button.addEventListener('click', () => {
  if (syntheticScene === button.dataset.synthetic) return;
  syntheticScene = button.dataset.synthetic;
  $$('[data-synthetic]').forEach(tab => {
    const selected = tab === button;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  $('#synthetic-panel').setAttribute('aria-labelledby', button.id);
  syntheticBaseline.replaceChildren(...Object.entries(syntheticScenes[syntheticScene].comparisons).map(([value, [label]]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = label; return option;
  }));
  syntheticBaseline.value = syntheticScenes[syntheticScene].default;
  loadSyntheticComparison();
}));
$('.synthetic-tabs').addEventListener('keydown', event => {
  const tabs = $$('[data-synthetic]');
  let index = tabs.indexOf(document.activeElement);
  if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
  else if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = tabs.length - 1;
  else return;
  event.preventDefault(); tabs[index].focus(); tabs[index].click();
});
syntheticBaseline.addEventListener('change', loadSyntheticComparison);
syntheticTimeline.addEventListener('input', () => syntheticPlayer.seek(Number(syntheticTimeline.value) / 1000));
[syntheticBefore, syntheticAfter].forEach(video => video.addEventListener('error', () => { $('#synthetic-error').hidden = false; }));

const signalPlayer = new SyncedVideos([$('#signal-motion'), $('#signal-jacobian')], {
  container: $('.signal-comparison'), button: $('#signal-play'), subject: 'uncertainty animation',
  onTime(time, duration) {
    if (!Number.isFinite(duration) || duration <= 0) return;
    $('#signal-timeline').value = Math.round(time / duration * 100);
    $('#signal-time').textContent = `${formatTime(time)} / ${formatTime(Math.round(duration))}`;
  }
});
$('#signal-timeline').addEventListener('input', event => signalPlayer.seek(Number(event.target.value) / 100));
const smokePlayer = new SyncedVideos([$('#smoke-input'), $('#smoke-core')], { container: $('.smoke-demo'), button: $('#smoke-play'), subject: 'smoke comparison' });
const smokeNames = { car: 'Muscle car', chair: 'Chair', hotdog: 'Hotdog', lego: 'Lego' };
let smokeScene = 'car';
let smokeMode = 'uncertainty';

function smokeResultSource() {
  return `assets/smoke-${smokeScene}-${smokeMode === 'uncertainty' ? 'uncertainty' : 'ours'}.mp4`;
}

function updateSmokePresentation() {
  const uncertainty = smokeMode === 'uncertainty';
  $('#smoke-result-label').textContent = uncertainty ? 'Jacobian uncertainty' : 'ReCan-GS';
  $('#smoke-result-dot').classList.toggle('signal-dot', uncertainty);
  $('#smoke-score-key').hidden = !uncertainty;
  $('#smoke-core').setAttribute('aria-label', `${smokeNames[smokeScene]} ${uncertainty ? 'Jacobian uncertainty' : 'ReCan-GS reconstruction'}`);
  $('#smoke-instruction').textContent = smokeMode === 'sweep' ? 'Drag to explore the supplied reconstruction sweep.' : uncertainty ? 'Brighter colors indicate higher Jacobian scores. Compare the uncertainty map with the visible smoke at the same moment.' : 'Same scene and viewpoint, before and after reconstruction.';
}

function updateSmokeFrame() {
  const index = Number($('#smoke-pruning').value);
  $('#smoke-sweep-image').src = `assets/sweeps/${smokeScene}/${String(index).padStart(2, '0')}.webp`;
  $('#smoke-sweep-image').alt = `Recorded ${smokeNames[smokeScene]} reconstruction at pruning sweep position ${index + 1} of 33`;
  $('#pruning-output').textContent = index < 11 ? 'Conservative' : index > 22 ? 'Aggressive' : 'Balanced';
  for (const next of [index - 1, index + 1]) {
    if (next >= 0 && next <= 32) { const image = new Image(); image.src = `assets/sweeps/${smokeScene}/${String(next).padStart(2, '0')}.webp`; }
  }
}

$$('[data-smoke]').forEach(button => button.addEventListener('click', () => {
  if (smokeScene === button.dataset.smoke) return;
  smokeScene = button.dataset.smoke;
  $$('[data-smoke]').forEach(item => { item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button)); });
  $('#smoke-scene-name').textContent = smokeNames[smokeScene];
  $('#smoke-input').setAttribute('aria-label', `${smokeNames[smokeScene]} with smoke`);
  updateSmokePresentation();
  smokePlayer.changeSources([`assets/smoke-${smokeScene}-input.mp4`, smokeResultSource()]);
  updateSmokeFrame();
}));

function setSmokeMode(mode) {
  smokeMode = mode;
  const sweep = mode === 'sweep';
  smokePlayer.enabled = !sweep;
  $('#smoke-compare').setAttribute('aria-pressed', String(mode === 'compare'));
  $('#smoke-uncertainty').setAttribute('aria-pressed', String(mode === 'uncertainty'));
  $('#smoke-sweep').setAttribute('aria-pressed', String(sweep));
  $('#smoke-pair').hidden = sweep;
  $('#smoke-sweep-view').hidden = !sweep;
  $('#smoke-pruning-control').hidden = !sweep;
  $('#smoke-play').hidden = sweep;
  updateSmokePresentation();
  if (sweep) { smokePlayer.stop(); return; }
  const desiredSource = smokeResultSource();
  const currentSource = $('#smoke-core').getAttribute('src') || $('#smoke-core').dataset.lazySrc;
  if (currentSource !== desiredSource) {
    if (smokePlayer.active) smokePlayer.replaceSource($('#smoke-core'), desiredSource);
    else smokePlayer.changeSources([`assets/smoke-${smokeScene}-input.mp4`, desiredSource]);
  } else if (smokePlayer.visible) smokePlayer.start();
}
$('#smoke-compare').addEventListener('click', () => setSmokeMode('compare'));
$('#smoke-uncertainty').addEventListener('click', () => setSmokeMode('uncertainty'));
$('#smoke-sweep').addEventListener('click', () => setSmokeMode('sweep'));
$('#smoke-pruning').addEventListener('input', updateSmokeFrame);

let coverageSpeed = 'fast';
let coverageQueued = false;
function updateCoverage() {
  coverageQueued = false;
  const frame = Number($('#coverage-frame').value);
  const name = String(frame).padStart(3, '0');
  for (let camera = 1; camera <= 3; camera++) {
    const image = $(`#coverage-${camera}`);
    image.src = `assets/coverage/${camera}-${coverageSpeed}/${name}.webp`;
    image.alt = `${coverageSpeed === 'fast' ? 'Fast' : 'Slow'} ball uncertainty from ${camera} camera${camera > 1 ? 's' : ''}, frame ${frame}`;
    for (const next of [frame - 1, frame + 1]) {
      if (next >= 1 && next <= 149) { const preload = new Image(); preload.src = `assets/coverage/${camera}-${coverageSpeed}/${String(next).padStart(3, '0')}.webp`; }
    }
  }
  $('#coverage-count').textContent = `${name} / 149`;
}
$('#coverage-frame').addEventListener('input', () => {
  if (!coverageQueued) { coverageQueued = true; requestAnimationFrame(updateCoverage); }
});
$$('[data-speed]').forEach(button => button.addEventListener('click', () => {
  coverageSpeed = button.dataset.speed;
  $$('[data-speed]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  updateCoverage();
}));

const metrics = {
  psnr: { digits: 1, lower: false, values: [[31.5, 27.2, 29.3], [27.8, 22.3, 29.4], [30.3, 29.2, 28.4], [21.6, 16.7, 23.0]] },
  ssim: { digits: 2, lower: false, values: [[.95, .79, .92], [.96, .93, .98], [.94, .91, .93], [.75, .50, .78]] },
  lpips: { digits: 2, lower: true, values: [[.07, .27, .10], [.05, .09, .03], [.05, .16, .07], [.26, .75, .22]] }
};
function renderTable() {
  const metric = metrics[$('#metric-select').value];
  const names = ['Squatting', 'Bouncing balls', 'Jeep', 'Bottle'];
  const rows = metric.values.map((values, index) => {
    const row = document.createElement('tr');
    const name = document.createElement('th'); name.scope = 'row'; name.textContent = names[index]; row.append(name);
    const best = metric.lower ? Math.min(...values) : Math.max(...values);
    values.forEach(value => { const cell = document.createElement('td'); cell.textContent = value.toFixed(metric.digits); if (value === best) { cell.className = 'best'; cell.setAttribute('aria-label', `${value.toFixed(metric.digits)}, best result`); } row.append(cell); });
    return row;
  });
  $('#results-table tbody').replaceChildren(...rows);
}
$('#metric-select').addEventListener('change', renderTable);
renderTable();

$('#copy-citation').addEventListener('click', async () => {
  const button = $('#copy-citation');
  const citation = $('#bibtex').textContent;
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(citation);
    else {
      const field = document.createElement('textarea'); field.value = citation; field.style.position = 'fixed'; field.style.opacity = '0'; document.body.append(field); field.select();
      const success = document.execCommand('copy'); field.remove(); if (!success) throw new Error('Clipboard unavailable');
    }
    $('span', button).textContent = 'Copied'; $('use', button).setAttribute('href', '#i-check');
    $('#copy-status').textContent = 'BibTeX copied to clipboard.';
    setTimeout(() => { $('span', button).textContent = 'Copy BibTeX'; $('use', button).setAttribute('href', '#i-copy'); }, 2200);
  } catch (_) {
    const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents($('#bibtex')); selection.removeAllRanges(); selection.addRange(range);
    $('#copy-status').textContent = 'Citation selected. Press Control C or Command C to copy.';
    $('span', button).textContent = 'Select & copy';
  }
});

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const player = [...players].find(item => item.container === entry.target);
      if (!player) continue;
      player.visible = entry.isIntersecting || (player === comparePlayer && heroDialog.open);
      if (player.visible) {
        if (!player.enabled) continue;
        player.activate();
      } else player.stop();
    }
  }, { threshold: .08 });
  players.forEach(player => observer.observe(player.container));
} else {
  players.forEach(player => { player.visible = true; player.activate(); });
}

document.addEventListener('visibilitychange', () => {
  players.forEach(player => {
    if (document.hidden) player.stop();
    else if (player.visible && !(player === smokePlayer && smokeMode === 'sweep')) player.start();
  });
});

reducedMotion.addEventListener?.('change', event => {
  players.forEach(player => { player.wantsPlay = !event.matches; if (event.matches) player.stop(); else if (player.visible) player.start(); });
});

// Recheck drift across simultaneous video streams without seeking every frame.
setInterval(() => { players.forEach(player => { if (player.visible && !player.master.paused) player.synchronize(); }); }, 350);
