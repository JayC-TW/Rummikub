// music.js
// 輕鬆的循環背景音樂：使用 Web Audio API 即時合成，不需外部音檔。
// 內容為一段 8 小節的輕柔琶音 + 簡單低音，播完自動從頭重播。

let ctx = null;
let masterGain = null;
let playing = false;
let schedulerTimer = null;
let nextNoteTime = 0;
let stepIndex = 0;

const TEMPO = 84; // BPM，輕鬆步調
const STEP = 60 / TEMPO / 2; // 每步半拍（八分音符）

// 和弦進行（C - Am - F - G），每和弦 8 步，共 32 步循環
// 每步為琶音音高（Hz），0 表示休止
const N = {
  C3: 130.81, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0,
  B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.26,
};
const MELODY = [
  // C 和弦
  N.C4, N.E4, N.G4, N.C5, N.G4, N.E4, N.G4, 0,
  // Am 和弦
  N.A3, N.C4, N.E4, N.A4, N.E4, N.C4, N.E4, 0,
  // F 和弦
  N.F3, N.A3, N.C4, N.F4, N.C4, N.A3, N.C4, 0,
  // G 和弦
  N.G3, N.B3, N.D4, N.G4, N.D4, N.B3, N.D4, 0,
];
const BASS = [N.C3, N.A3 / 2, N.F3, N.G3]; // 每和弦一個低音（Am 用 A2）

function ensureContext() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.16; // 整體音量偏低，作為背景
  masterGain.connect(ctx.destination);
}

/** 播放一顆柔和的音（正弦波 + 短暫的音量包絡） */
function playNote(freq, time, duration, volume) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(volume, time + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(time);
  osc.stop(time + duration + 0.05);
}

/** 排程器：提前把接下來 0.3 秒內的音符排入 AudioContext 時間軸 */
function scheduler() {
  while (nextNoteTime < ctx.currentTime + 0.3) {
    const step = stepIndex % MELODY.length;
    const freq = MELODY[step];
    if (freq > 0) playNote(freq, nextNoteTime, STEP * 1.8, 0.5);
    if (step % 8 === 0) {
      const chord = Math.floor(step / 8);
      playNote(BASS[chord], nextNoteTime, STEP * 7, 0.35);
    }
    nextNoteTime += STEP;
    stepIndex += 1;
  }
  schedulerTimer = setTimeout(scheduler, 100);
}

/** 開始播放（需在使用者手勢事件內首次呼叫，以符合瀏覽器自動播放限制） */
export function startMusic() {
  ensureContext();
  if (ctx.state === 'suspended') ctx.resume();
  if (playing) return;
  playing = true;
  stepIndex = 0;
  nextNoteTime = ctx.currentTime + 0.1;
  scheduler();
}

export function stopMusic() {
  playing = false;
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}

export function toggleMusic() {
  if (playing) stopMusic();
  else startMusic();
  return playing;
}

export function isMusicPlaying() {
  return playing;
}
