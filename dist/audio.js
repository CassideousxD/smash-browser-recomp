// Web Audio engine for Super Smash Bros. Melee:
// Plays GameCube .hps streams with hardware DSP ADPCM decoding & seamless loop points,
// decodes .ssm sound banks for announcer, character voices, and combat SFX,
// and polls simulation audio events from the Melee core every frame.
import { decode_hps, decode_ssm } from './pkg/melee_web.js';

// Stage BGM streams inside GALE01 /audio/ directory:
const STAGE_TRACKS = {
  0: 'audio/sp_zako.hps',    // Battlefield
  1: 'audio/sp_end.hps',     // Final Destination
  2: 'audio/garden.hps',     // Dream Land
  3: 'audio/izumi.hps',      // Fountain of Dreams
  4: 'audio/pstadium.hps',   // Pokemon Stadium
  5: 'audio/ystory.hps',     // Yoshi's Story
  6: 'audio/old_ys.hps',     // Yoshi's Island 64
  7: 'audio/old_dk.hps',     // Kongo Jungle 64
  8: 'audio/kongo.hps',      // Jungle Japes
  10: 'audio/shrine.hps',    // Hyrule Temple
  16: 'audio/onetto.hps',    // Onett
  17: 'audio/zebes.hps',     // Brinstar
  18: 'audio/venom.hps',     // Venom
  19: 'audio/mutecity.hps',  // Mute City
  27: 'audio/bigblue.hps',   // Big Blue
};

// Retail Melee CSS announcer character voice clips in audio/us/nr_name.ssm
// Source: third_party/melee-decomp/src/melee/gm/gm_1601.c (gm_80168C5C)
const ANNOUNCER_CHARACTER_CLIPS = {
  0: 2,   // Dr. Mario (CKIND_DRMARIO -> 0x7C832 -> clip 2)
  1: 21,  // Mario (CKIND_MARIO -> 0x7C845 -> clip 21)
  2: 20,  // Luigi (CKIND_LUIGI -> 0x7C844 -> clip 20)
  3: 16,  // Bowser (CKIND_KOOPA -> 0x7C840 -> clip 16)
  4: 27,  // Peach (CKIND_PEACH -> 0x7C84B -> clip 27)
  5: 31,  // Yoshi (CKIND_YOSHI -> 0x7C84F -> clip 31)
  6: 1,   // Donkey Kong (CKIND_DONKEY -> 0x7C831 -> clip 1)
  7: 0,   // Captain Falcon (CKIND_CAPTAIN -> 0x7C830 -> clip 0)
  8: 6,   // Ganondorf (CKIND_GANON -> 0x7C836 -> clip 6)
  9: 4,   // Falco (CKIND_FALCO -> 0x7C834 -> clip 4)
  10: 5,  // Fox (CKIND_FOX -> 0x7C835 -> clip 5)
  11: 26, // Ness (CKIND_NESS -> 0x7C84A -> clip 26)
  12: 11, // Ice Climbers (CKIND_POPONANA -> 0x7C83B -> clip 11)
  13: 15, // Kirby (CKIND_KIRBY -> 0x7C83F -> clip 15)
  14: 30, // Samus (CKIND_SAMUS -> 0x7C84E -> clip 30)
  15: 33, // Zelda (CKIND_ZELDA -> 0x7C851 -> clip 33)
  16: 32, // Sheik (CKIND_SEAK -> 0x7C850 -> clip 32)
  17: 18, // Link (CKIND_LINK -> 0x7C842 -> clip 18)
  18: 19, // Young Link (CKIND_CLINK -> 0x7C843 -> clip 19)
  19: 28, // Pichu (CKIND_PICHU -> 0x7C84C -> clip 28)
  20: 29, // Pikachu (CKIND_PIKACHU -> 0x7C84D -> clip 29)
  21: 13, // Jigglypuff (CKIND_PURIN -> 0x7C83D -> clip 13)
  22: 24, // Mewtwo (CKIND_MEWTWO -> 0x7C848 -> clip 24)
  23: 10, // Mr. Game & Watch (CKIND_GAMEWATCH -> 0x7C83A -> clip 10)
  24: 22, // Marth (CKIND_MARS -> 0x7C846 -> clip 22)
  25: 12, // Roy (CKIND_EMBLEM -> 0x7C83C -> clip 12)
};

// Retail Melee SSM Sound Bank Definitions (path, count, base wave ID)
// Source: GALE01.iso SSM file headers & third_party/melee-decomp/src/sysdolphin/baselib/synth.c
const SSM_BANKS_MAP = [
  { path: 'audio/main.ssm', count: 246, base: 0 },
  { path: 'audio/pokemon.ssm', count: 44, base: 246 },
  { path: 'audio/us/nr_title.ssm', count: 5, base: 290 },
  { path: 'audio/us/nr_select.ssm', count: 23, base: 295 },
  { path: 'audio/us/nr_1p.ssm', count: 11, base: 318 },
  { path: 'audio/us/nr_vs.ssm', count: 7, base: 329 },
  { path: 'audio/us/captain.ssm', count: 28, base: 336 },
  { path: 'audio/us/clink.ssm', count: 40, base: 364 },
  { path: 'audio/us/dk.ssm', count: 23, base: 404 },
  { path: 'audio/us/drmario.ssm', count: 36, base: 427 },
  { path: 'audio/us/falco.ssm', count: 53, base: 463 },
  { path: 'audio/us/fox.ssm', count: 50, base: 516 },
  { path: 'audio/us/gkoopa.ssm', count: 23, base: 566 },
  { path: 'audio/us/ice.ssm', count: 44, base: 589 },
  { path: 'audio/us/kirby.ssm', count: 52, base: 633 },
  { path: 'audio/us/koopa.ssm', count: 26, base: 685 },
  { path: 'audio/us/link.ssm', count: 37, base: 711 },
  { path: 'audio/us/luigi.ssm', count: 35, base: 748 },
  { path: 'audio/us/mario.ssm', count: 32, base: 783 },
  { path: 'audio/us/mars.ssm', count: 46, base: 815 },
  { path: 'audio/us/mewtwo.ssm', count: 32, base: 861 },
  { path: 'audio/us/ness.ssm', count: 35, base: 893 },
  { path: 'audio/us/peach.ssm', count: 30, base: 928 },
  { path: 'audio/us/pichu.ssm', count: 32, base: 958 },
  { path: 'audio/us/pikachu.ssm', count: 36, base: 990 },
  { path: 'audio/us/purin.ssm', count: 23, base: 1026 },
  { path: 'audio/us/samus.ssm', count: 25, base: 1049 },
  { path: 'audio/us/zs.ssm', count: 62, base: 1074 },
  { path: 'audio/us/yoshi.ssm', count: 33, base: 1136 },
  { path: 'audio/us/gw.ssm', count: 21, base: 1169 },
  { path: 'audio/us/ganon.ssm', count: 28, base: 1190 },
  { path: 'audio/us/emblem.ssm', count: 45, base: 1218 },
  { path: 'audio/us/mhands.ssm', count: 20, base: 1263 },
  { path: 'audio/us/kirbytm.ssm', count: 50, base: 1283 },
  { path: 'audio/us/castle.ssm', count: 6, base: 1333 },
  { path: 'audio/us/corneria.ssm', count: 22, base: 1339 },
  { path: 'audio/us/greatbay.ssm', count: 11, base: 1361 },
  { path: 'audio/us/kongo.ssm', count: 2, base: 1372 },
  { path: 'audio/us/mutecity.ssm', count: 11, base: 1374 },
  { path: 'audio/us/onett.ssm', count: 7, base: 1385 },
  { path: 'audio/us/zebes.ssm', count: 11, base: 1392 },
  { path: 'audio/us/garden.ssm', count: 5, base: 1403 },
  { path: 'audio/us/klaid.ssm', count: 7, base: 1408 },
  { path: 'audio/us/greens.ssm', count: 6, base: 1415 },
  { path: 'audio/us/venom.ssm', count: 21, base: 1421 },
  { path: 'audio/us/bigblue.ssm', count: 4, base: 1442 },
  { path: 'audio/us/fourside.ssm', count: 2, base: 1446 },
  { path: 'audio/us/pupupu.ssm', count: 5, base: 1448 },
  { path: 'audio/us/pstadium.ssm', count: 2, base: 1453 },
  { path: 'audio/us/1padv.ssm', count: 7, base: 1455 },
  { path: 'audio/us/ending.ssm', count: 14, base: 1462 },
  { path: 'audio/us/nr_name.ssm', count: 52, base: 1476 },
  { path: 'audio/us/1pend.ssm', count: 2, base: 1528 },
  { path: 'audio/us/last.ssm', count: 3, base: 1530 },
  { path: 'audio/us/end.ssm', count: 1, base: 1533 },
];

// Announcer VS lines clip indices in audio/us/nr_vs.ssm:
// Source: GALE01.iso retail DOL assembly at 0x80168e90, 0x80177368, 0x80179414
const VS_CLIPS = {
  ready_go: 0,     // "Ready... GO!"
  game: 1,         // "GAME!"
  red_team: 2,     // "RED TEAM!" (Sound 50004 -> clip 2)
  green_team: 3,   // "GREEN TEAM!" (Sound 50003 -> clip 3)
  blue_team: 4,    // "BLUE TEAM!" (Sound 50002 -> clip 4)
  winner_is: 5,    // "This game's winner is..."
  go: 6,           // "GO!" (sudden death start)
};

// Announcer Menu & Mode Selection clips in audio/us/nr_select.ssm:
const SELECT_CLIPS = {
  choose_character: 0, // "Choose your character!"
  free_for_all: 1,     // "Free-for-all!"
  team_battle: 2,      // "Team battle!"
  choose_stage: 4,     // "Choose your stage!"
};

// Common menu sound clip indices in audio/main.ssm (verified against retail lbAudioAx menu table 0x803bc918):
const MENU_CLIPS = {
  move: 172,     // cursor / selector move (0.59s 16kHz)
  confirm: 173,  // menu confirm / select (0.59s 32kHz chime)
  cancel: 174,   // menu cancel / back (0.59s 32kHz chime)
  error: 175,    // menu invalid action (0.04s blip)
  coin: 136,     // token / coin drop
};

const MAX_CACHED_SSM_FILES = 16;
const MAX_CACHED_SFX_CLIPS = 256;

export class AudioEngine {
  constructor(app, readRange) {
    this.app = app;
    this.readRange = readRange;
    this.ctx = null;
    this.masterGain = null;
    this.bgmGain = null;
    this.sfxGain = null;
    this.currentTrack = null;
    this.currentSource = null;
    this.currentGain = null;
    this.bgmBuffers = new Map(); // path -> { buffer, loopStart }
    this.bgmLoading = new Map(); // path -> Promise
    this.ssmRawFiles = new Map(); // path -> Uint8Array (LRU)
    this.ssmClips = new Map(); // `${path}:${clipIndex}` -> AudioBuffer (LRU)
    this.enabled = true;
    this.bgmVolume = 0.6;
    this.sfxVolume = 0.85;
    this.pendingTrack = null;
    this.lastDiscFile = null;
    this.lastMatchStatus = null;
    this.lastScreen = -1;
    this.announcedGame = false;
    this.soundResolveCache = new Map();
    this.semLoaded = false;
    this.semView = null;
    this.semBankOffsets = null;
    this.semMacroOffsets = null;

    try {
      const savedBgm = localStorage.getItem('melee.bgmVolume') ?? localStorage.getItem('melee.audioVolume');
      if (savedBgm != null) this.bgmVolume = Math.max(0, Math.min(1, parseFloat(savedBgm)));
      const savedSfx = localStorage.getItem('melee.sfxVolume');
      if (savedSfx != null) this.sfxVolume = Math.max(0, Math.min(1, parseFloat(savedSfx)));
      const savedEn = localStorage.getItem('melee.audioEnabled');
      if (savedEn != null) this.enabled = savedEn === 'true';
    } catch {}

    const unlock = () => {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          console.log('[AudioEngine] AudioContext resumed on user interaction');
          if (this.pendingTrack && this.lastDiscFile) {
            this.play(this.pendingTrack, this.lastDiscFile);
          }
        });
      }
    };
    window.addEventListener('click', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('pointerdown', unlock, { passive: true });
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      console.warn('[AudioEngine] Web Audio API is not supported in this browser');
      return;
    }
    this.ctx = new AudioContext();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.enabled ? 1.0 : 0.0, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);

    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.setValueAtTime(this.bgmVolume, this.ctx.currentTime);
    this.bgmGain.connect(this.masterGain);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
    this.sfxGain.connect(this.masterGain);

    console.log('[AudioEngine] AudioContext initialized with dual BGM/SFX channels, state:', this.ctx.state);
  }

  setBgmVolume(vol) {
    this.bgmVolume = Math.max(0, Math.min(1, vol));
    try { localStorage.setItem('melee.bgmVolume', String(this.bgmVolume)); } catch {}
    if (this.bgmGain && this.ctx) {
      this.bgmGain.gain.setValueAtTime(this.bgmVolume, this.ctx.currentTime);
    }
  }

  setSfxVolume(vol) {
    this.sfxVolume = Math.max(0, Math.min(1, vol));
    try { localStorage.setItem('melee.sfxVolume', String(this.sfxVolume)); } catch {}
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
    }
  }

  toggleMute() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('melee.audioEnabled', String(this.enabled)); } catch {}
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.enabled ? 1.0 : 0.0, this.ctx.currentTime);
    }
    return this.enabled;
  }

  // ---- BGM (.hps) playback
  async loadTrack(path, discFile) {
    if (this.bgmBuffers.has(path)) return this.bgmBuffers.get(path);
    if (this.bgmLoading.has(path)) return this.bgmLoading.get(path);

    const promise = (async () => {
      const range = this.app.file_range(path);
      if (!range || !discFile) return null;
      const [start, end] = range;
      const bytes = await this.readRange(discFile, start, end);
      const decoded = decode_hps(bytes);
      if (!decoded) return null;

      this.init();
      if (!this.ctx) return null;

      const { sampleRate, channelCount, loopSampleIndex, samples } = decoded;
      const sampleCount = Math.floor(samples.length / channelCount);
      const buffer = this.ctx.createBuffer(channelCount, sampleCount, sampleRate);
      const left = buffer.getChannelData(0);
      const right = channelCount > 1 ? buffer.getChannelData(1) : left;

      for (let i = 0; i < sampleCount; i++) {
        left[i] = samples[i * channelCount] / 32768.0;
        if (channelCount > 1) {
          right[i] = samples[i * channelCount + 1] / 32768.0;
        }
      }

      const loopStart = loopSampleIndex != null ? loopSampleIndex / sampleRate : null;
      const result = { buffer, loopStart };
      this.bgmBuffers.set(path, result);
      return result;
    })();

    this.bgmLoading.set(path, promise);
    try {
      return await promise;
    } catch (e) {
      console.error(`[AudioEngine] Error loading track "${path}":`, e);
      return null;
    } finally {
      this.bgmLoading.delete(path);
    }
  }

  async play(path, discFile) {
    if (!path || !discFile) {
      this.stop();
      return;
    }
    this.pendingTrack = path;
    this.lastDiscFile = discFile;

    if (this.currentTrack === path && this.currentSource) return;

    this.init();
    if (this.ctx && this.ctx.state === 'suspended') return;

    this.currentTrack = path;
    const data = await this.loadTrack(path, discFile);
    if (!data || this.currentTrack !== path) return;

    this.init();
    if (!this.ctx) return;

    // Fade out previous BGM
    if (this.currentSource && this.currentGain) {
      const oldGain = this.currentGain;
      const oldSrc = this.currentSource;
      const now = this.ctx.currentTime;
      oldGain.gain.setValueAtTime(oldGain.gain.value, now);
      oldGain.gain.linearRampToValueAtTime(0.001, now + 0.3);
      setTimeout(() => {
        try { oldSrc.stop(); oldSrc.disconnect(); oldGain.disconnect(); } catch {}
      }, 350);
    }

    const source = this.ctx.createBufferSource();
    source.buffer = data.buffer;
    if (data.loopStart != null) {
      source.loop = true;
      source.loopStart = data.loopStart;
      source.loopEnd = data.buffer.duration;
    } else {
      source.loop = true;
    }

    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(1.0, now + 0.3);

    source.connect(gain);
    gain.connect(this.bgmGain);
    source.start(0);

    this.currentSource = source;
    this.currentGain = gain;
    console.log(`[AudioEngine] BGM: "${path}"`);
  }

  stop() {
    this.currentTrack = null;
    this.pendingTrack = null;
    if (this.currentSource && this.currentGain && this.ctx) {
      const oldGain = this.currentGain;
      const oldSrc = this.currentSource;
      const now = this.ctx.currentTime;
      oldGain.gain.setValueAtTime(oldGain.gain.value, now);
      oldGain.gain.linearRampToValueAtTime(0.001, now + 0.2);
      setTimeout(() => {
        try { oldSrc.stop(); oldSrc.disconnect(); oldGain.disconnect(); } catch {}
      }, 250);
      this.currentSource = null;
      this.currentGain = null;
    }
  }

  // ---- Sound Effects & Announcer (.ssm) decoding with LRU cache
  async getSsmBytes(path, discFile) {
    if (this.ssmRawFiles.has(path)) {
      // Refresh LRU position
      const cached = this.ssmRawFiles.get(path);
      this.ssmRawFiles.delete(path);
      this.ssmRawFiles.set(path, cached);
      return cached;
    }
    let range = this.app.file_range(path);
    if (!range && !path.includes('/us/')) {
      range = this.app.file_range(path.replace('audio/', 'audio/us/'));
    }
    if (!range && path.includes('/us/')) {
      range = this.app.file_range(path.replace('/us/', '/'));
    }
    if (!range || !discFile) return null;
    const [start, end] = range;
    const bytes = await this.readRange(discFile, start, end);

    // Evict oldest if full
    if (this.ssmRawFiles.size >= MAX_CACHED_SSM_FILES) {
      const oldestKey = this.ssmRawFiles.keys().next().value;
      this.ssmRawFiles.delete(oldestKey);
    }
    this.ssmRawFiles.set(path, bytes);
    return bytes;
  }

  async getSfxClipBuffer(path, clipIndex, discFile) {
    const key = `${path}:${clipIndex}`;
    if (this.ssmClips.has(key)) {
      const cached = this.ssmClips.get(key);
      this.ssmClips.delete(key);
      this.ssmClips.set(key, cached);
      return cached;
    }

    const ssmBytes = await this.getSsmBytes(path, discFile);
    if (!ssmBytes) return null;

    try {
      const decoded = decode_ssm(ssmBytes, clipIndex);
      if (!decoded) return null;

      this.init();
      if (!this.ctx) return null;

      const { sampleRate, channelCount, samples } = decoded;
      // Web Audio API handles sample rates between 8kHz and 96kHz natively with hardware acceleration
      // and multi-tap bandlimited sinc reconstruction, eliminating manual loop overhead and muffled sound.
      const targetRate = Math.max(8000, Math.min(96000, sampleRate || 32000));
      const buffer = this.ctx.createBuffer(channelCount, samples.length, targetRate);
      const left = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        left[i] = samples[i] / 32768.0;
      }

      // Evict oldest clip if cache full
      if (this.ssmClips.size >= MAX_CACHED_SFX_CLIPS) {
        const oldestKey = this.ssmClips.keys().next().value;
        this.ssmClips.delete(oldestKey);
      }
      this.ssmClips.set(key, buffer);
      return buffer;
    } catch (e) {
      console.warn(`[AudioEngine] Failed to decode clip ${clipIndex} from ${path}:`, e);
      return null;
    }
  }

  async playSfx(path, clipIndex, discFile, volume = 1.0, pan = 0.0) {
    if (!discFile || !this.enabled) return null;
    this.init();
    if (!this.ctx) return null;
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (e) {
        return null;
      }
    }

    const buffer = await this.getSfxClipBuffer(path, clipIndex, discFile);
    if (!buffer || !this.ctx) return null;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    let lastNode = source;

    // Stereo Panning (GameCube AX pan)
    if (pan !== 0.0 && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-1.0, Math.min(1.0, pan)), this.ctx.currentTime);
      lastNode.connect(panner);
      lastNode = panner;
    }

    // Volume scaling (bounded to avoid digital distortion/clipping)
    const finalVol = Math.max(0, Math.min(1.0, volume));
    if (finalVol !== 1.0) {
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(finalVol, this.ctx.currentTime);
      lastNode.connect(gain);
      lastNode = gain;
    }

    lastNode.connect(this.sfxGain);
    source.start(0);
    return source;
  }

  // Load and parse smash2.sem macro lookup table for authentic GameCube Melee SFX routing
  async loadSem(discFile) {
    if (this.semLoaded || !discFile) return;
    try {
      let bytes = await this.getSsmBytes('audio/us/smash2.sem', discFile);
      if (!bytes) {
        bytes = await this.getSsmBytes('audio/smash2.sem', discFile);
      }
      if (!bytes || bytes.length < 16) return;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const count0 = view.getInt32(0, false);
      let offset = 4 + count0 * 4;
      const count1 = view.getInt32(offset, false);
      offset += 4 + count1 * 4;
      const numBanks = view.getInt32(offset, false);
      offset += 4;
      const bankOffsets = new Uint32Array(numBanks);
      for (let i = 0; i < numBanks; i++) {
        bankOffsets[i] = view.getUint32(offset, false);
        offset += 4;
      }
      const numMacros = view.getInt32(offset, false);
      offset += 4;
      const macroOffsets = new Uint32Array(numMacros);
      for (let i = 0; i < numMacros; i++) {
        macroOffsets[i] = view.getUint32(offset, false);
        offset += 4;
      }
      this.semView = view;
      this.semBankOffsets = bankOffsets;
      this.semMacroOffsets = macroOffsets;
      this.semLoaded = true;
      console.log(`[AudioEngine] smash2.sem loaded: ${numBanks} banks, ${numMacros} sound macros`);
    } catch (e) {
      console.warn('[AudioEngine] Could not load smash2.sem:', e);
    }
  }

  // Resolve simulation sound ID (from ftAction_80071B50, ft_PlaySFX, smash2.sem)
  // to the authentic .ssm bank file and clip index within that bank.
  resolveSound(id) {
    if (this.soundResolveCache.has(id)) {
      return this.soundResolveCache.get(id);
    }
    if (!this.semLoaded || !this.semView || !this.semBankOffsets || !this.semMacroOffsets) {
      return null;
    }

    const bankIdx = Math.floor(id / 10000);
    const bankMem = id % 10000;
    if (bankIdx >= this.semBankOffsets.length) return null;

    const sampleIdx = bankMem + this.semBankOffsets[bankIdx];
    if (sampleIdx >= this.semMacroOffsets.length) return null;

    const moff = this.semMacroOffsets[sampleIdx];
    let pos = moff;
    while (pos + 4 <= this.semView.byteLength) {
      const word = this.semView.getUint32(pos, false);
      const cmdType = word >>> 24;
      if (cmdType === 1) {
        const fid = word & 0xFFFFFF;
        for (const def of SSM_BANKS_MAP) {
          if (fid >= def.base && fid < def.base + def.count) {
            const result = { bankFile: def.path, clipIdx: fid - def.base };
            this.soundResolveCache.set(id, result);
            return result;
          }
        }
        break;
      } else if (cmdType === 0x0E) {
        break;
      }
      pos += 4;
      if (pos - moff > 64) break;
    }

    this.soundResolveCache.set(id, null);
    return null;
  }

  // Poll in-match combat sounds emitted by fighters in the simulation
  pollCombatSounds(discFile) {
    if (!discFile || !this.enabled || !this.app) return;
    if (!this.semLoaded) {
      this.loadSem(discFile);
      return;
    }
    const events = this.app.poll_audio_events?.();
    if (!events || events.length === 0) return;

    for (const ev of events) {
      const { id, volume, pan } = ev;
      // Convert 7-bit values (0..127) to Web Audio gain and pan
      const vol = (volume / 127.0);
      const panPos = ((pan / 127.0) * 2.0 - 1.0);

      const resolved = this.resolveSound(id);
      if (resolved) {
        this.playSfx(resolved.bankFile, resolved.clipIdx, discFile, vol * 0.95, panPos);
      }
    }
  }

  async preloadBanks(discFile) {
    // Disabled background bulk audio preloading to preserve network bandwidth and prevent UI stutter
    return;
  }

  // High-level Announcer & Menu Sound Effects:
  async playAnnouncerName(catalogId, discFile) {
    const clipIndex = ANNOUNCER_CHARACTER_CLIPS[catalogId];
    if (clipIndex == null) return;
    // Play coin/token drop sound effect from main.ssm clip 136 and announcer character voice from nr_name.ssm
    this.playSfx('audio/main.ssm', 136, discFile, 0.7);
    return this.playSfx('audio/us/nr_name.ssm', clipIndex, discFile, 1.0);
  }

  async playAnnouncerVs(key, discFile) {
    const clipIndex = VS_CLIPS[key];
    if (clipIndex == null) return;
    return this.playSfx('audio/us/nr_vs.ssm', clipIndex, discFile, 1.0);
  }

  async playAnnouncerTitle(discFile) {
    return this.playSfx('audio/us/nr_title.ssm', 0, discFile, 0.95);
  }

  async playAnnouncerSelect(key = 0, discFile) {
    const clipIndex = typeof key === 'number' ? key : (SELECT_CLIPS[key] ?? 0);
    return this.playSfx('audio/us/nr_select.ssm', clipIndex, discFile, 1.0);
  }

  async playMenuSound(type, discFile) {
    const clipIndex = MENU_CLIPS[type];
    if (clipIndex == null) return;
    return this.playSfx('audio/main.ssm', clipIndex, discFile, 0.85);
  }

  // Called on every render frame to manage screen music, match transitions, and combat audio
  updateScreen(screen, stageId, discFile) {
    this.lastDiscFile = discFile;

    // Screen transition BGM
    if (screen !== this.lastScreen) {
      this.lastScreen = screen;
      this.lastMatchStatus = null;
      // 0: Disc, 1: Characters, 2: Stages, 3: Loading, 4: Match, 5: Results
      if (screen === 1 || screen === 2) {
        this.announcedGame = false;
        this.play('audio/menu01.hps', discFile);
      } else if (screen === 4) {
        this.announcedGame = false;
        const track = STAGE_TRACKS[stageId] || 'audio/sp_zako.hps';
        this.play(track, discFile);
      } else if (screen === 5) {
        // Results Screen
        if (!this.announcedGame) {
          this.announcedGame = true;
          setTimeout(() => {
            const results = this.app.results?.();
            if (results) {
              if (results.winningTeam != null && results.winningTeam >= 0) {
                const teamClip = results.winningTeam === 0 ? 'red_team' : (results.winningTeam === 1 ? 'blue_team' : 'green_team');
                this.playAnnouncerVs(teamClip, discFile);
              } else if (results.winner != null && results.winner >= 0) {
                const p = this.app.selection?.().players[results.winner];
                if (p && p.character >= 0) {
                  this.playAnnouncerName(p.character, discFile);
                }
              }
            }
          }, 600);
        }
        setTimeout(() => {
          if (this.lastScreen === 5) {
            this.play('audio/vs_hyou1.hps', discFile);
          }
        }, 500);
      } else if (screen === 0) {
        this.stop();
      }
    }

    // In-match event handling (Announcer "Ready... GO!", "GAME!", and combat SFX)
    if ((screen === 4 || screen === 5) && discFile) {
      const status = this.app.match_status?.();
      if (status && status !== this.lastMatchStatus) {
        if (status === 'finished' && !this.announcedGame) {
          this.announcedGame = true;
          this.playAnnouncerVs('game', discFile);
        }
        this.lastMatchStatus = status;
      }

      if (screen === 4) {
        this.pollCombatSounds(discFile);
      }
    }
  }
}
