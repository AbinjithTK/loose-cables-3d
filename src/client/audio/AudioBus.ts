/**
 * AudioBus — the game's sound system.
 *
 * Every sound has a labeled ID matching GAME_DESIGN.md §7. On first play the
 * bus tries to load `/sfx/<id>.ogg` from the public dir (drop in manually
 * sourced files there); if the file is missing it falls back to a synthesized
 * WebAudio placeholder so the game always has audio feedback.
 *
 * All gameplay SFX are pitch-randomized ±4% to avoid fatigue.
 */

export type SfxId =
  | 'sfx_plug_grab'      // search: "plastic connector click", "cable pickup foley"
  | 'sfx_plug_snap'      // search: "connector snap click satisfying", "seatbelt buckle click"
  | 'sfx_plug_deny'      // search: "dull thud metal rattle short"
  | 'sfx_cable_resolve'  // search: "zipper fast whoosh", "rope whip pull"
  | 'sfx_resolve_pop'    // search: "cork pop light chime"
  | 'sfx_cascade'        // search: "marimba ascending notes single" (pitched up per chain link)
  | 'sfx_ui_tap'         // search: "soft ui tap pop"
  | 'sfx_star_award'     // search: "star ding sparkle short"
  | 'sfx_level_win'      // search: "success jingle short warm"
  | 'sfx_world_unlock'   // search: "heavy switch breaker room lights on"
  | 'sfx_ziptie_earn'    // search: "coin tick plastic"
  | 'sfx_streak_flame'   // search: "whoosh flame ignite small"
  | 'sfx_door_open';     // search: "cabinet door creak open short"

const ALL_SFX: SfxId[] = [
  'sfx_plug_grab', 'sfx_plug_snap', 'sfx_plug_deny', 'sfx_cable_resolve',
  'sfx_resolve_pop', 'sfx_cascade', 'sfx_ui_tap', 'sfx_star_award',
  'sfx_level_win', 'sfx_world_unlock', 'sfx_ziptie_earn', 'sfx_streak_flame',
  'sfx_door_open',
];

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<SfxId, AudioBuffer | null>();
  private loading = new Set<SfxId>();
  private _muted = false;

  get muted(): boolean {
    return this._muted;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.8;
  }

  /** Must be called from a user gesture at least once (browser autoplay policy). */
  private ensureContext(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._muted ? 0 : 0.8;
      this.master.connect(this.ctx.destination);
      // Kick off async loading of real files.
      for (const id of ALL_SFX) void this.tryLoad(id);
      return this.ctx;
    } catch {
      return null;
    }
  }

  private async tryLoad(id: SfxId): Promise<void> {
    if (this.buffers.has(id) || this.loading.has(id) || !this.ctx) return;
    this.loading.add(id);
    try {
      const res = await fetch(`/sfx/${id}.ogg`);
      if (!res.ok) throw new Error('missing');
      const data = await res.arrayBuffer();
      const buffer = await this.ctx.decodeAudioData(data);
      this.buffers.set(id, buffer);
    } catch {
      this.buffers.set(id, null); // marks "use synth fallback"
    } finally {
      this.loading.delete(id);
    }
  }

  /**
   * Play a labeled SFX. `pitch` shifts playbackRate in semitones (used for
   * ascending cascade chains); volume is 0..1.
   */
  play(id: SfxId, { pitch = 0, volume = 1 }: { pitch?: number; volume?: number } = {}): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master || this._muted) return;

    const buffer = this.buffers.get(id);
    const rate = Math.pow(2, pitch / 12) * (1 + (Math.random() * 0.08 - 0.04));

    if (buffer) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      const gain = ctx.createGain();
      gain.gain.value = volume;
      src.connect(gain).connect(this.master);
      src.start();
      return;
    }
    this.synth(id, ctx, rate, volume);
  }

  // -------------------------------------------------------------------------
  // Synth fallbacks — small procedural approximations of each labeled sound
  // -------------------------------------------------------------------------

  private synth(id: SfxId, ctx: AudioContext, rate: number, volume: number): void {
    const out = this.master!;
    const now = ctx.currentTime;

    const tone = (
      freq: number, dur: number, type: OscillatorType, vol: number, delay = 0,
      slideTo?: number
    ): void => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq * rate, now + delay);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo * rate, now + delay + dur);
      gain.gain.setValueAtTime(vol * volume, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);
      osc.connect(gain).connect(out);
      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.02);
    };

    const noise = (dur: number, vol: number, delay = 0, lowpass = 4000): void => {
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpass;
      const gain = ctx.createGain();
      gain.gain.value = vol * volume;
      src.connect(filter).connect(gain).connect(out);
      src.start(now + delay);
    };

    switch (id) {
      case 'sfx_plug_grab':
        tone(1800, 0.03, 'square', 0.12);
        noise(0.04, 0.1, 0, 6000);
        break;
      case 'sfx_plug_snap':
        // Signature sound: two-stage click-CLUNK.
        tone(2400, 0.02, 'square', 0.15);
        tone(320, 0.09, 'triangle', 0.4, 0.035, 180);
        noise(0.05, 0.18, 0.03, 2400);
        break;
      case 'sfx_plug_deny':
        tone(140, 0.12, 'triangle', 0.35, 0, 90);
        noise(0.08, 0.12, 0, 900);
        break;
      case 'sfx_cable_resolve':
        noise(0.22, 0.2, 0, 5200);
        tone(500, 0.22, 'sawtooth', 0.06, 0, 1600);
        break;
      case 'sfx_resolve_pop':
        tone(600, 0.07, 'sine', 0.4, 0, 900);
        tone(1319, 0.18, 'sine', 0.14, 0.05);
        break;
      case 'sfx_cascade':
        tone(880, 0.16, 'sine', 0.3);
        tone(1109, 0.16, 'sine', 0.2, 0.02);
        break;
      case 'sfx_ui_tap':
        tone(900, 0.045, 'sine', 0.18, 0, 700);
        break;
      case 'sfx_star_award':
        tone(1568, 0.22, 'sine', 0.28);
        tone(2093, 0.3, 'sine', 0.18, 0.06);
        break;
      case 'sfx_level_win':
        tone(523, 0.16, 'triangle', 0.3);
        tone(659, 0.16, 'triangle', 0.3, 0.12);
        tone(784, 0.16, 'triangle', 0.3, 0.24);
        tone(1047, 0.42, 'triangle', 0.32, 0.36);
        break;
      case 'sfx_world_unlock':
        tone(80, 0.5, 'sawtooth', 0.3, 0, 55);
        noise(0.35, 0.2, 0.05, 1200);
        tone(660, 0.4, 'sine', 0.15, 0.3, 880);
        break;
      case 'sfx_ziptie_earn':
        tone(1760, 0.05, 'square', 0.12);
        tone(2217, 0.08, 'square', 0.1, 0.06);
        break;
      case 'sfx_streak_flame':
        noise(0.3, 0.22, 0, 2600);
        tone(220, 0.3, 'sawtooth', 0.08, 0, 440);
        break;
      case 'sfx_door_open':
        tone(180, 0.5, 'sawtooth', 0.07, 0, 120);
        noise(0.4, 0.1, 0.02, 1500);
        break;
    }
  }
}

export const audio = new AudioBus();
