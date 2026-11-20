const sg = require('../../../../services/shiguang');

const WAVE_HEIGHTS = [14, 24, 36, 20, 44, 28, 16, 40, 56, 32, 18, 48, 26, 38, 16, 50, 30, 22, 42, 14, 34, 24, 48, 18];
const waveBars = WAVE_HEIGHTS.map((height, index) => ({
  index,
  height,
  at: (index + 1) / WAVE_HEIGHTS.length,
}));

let activePlayer = null;

function formatDuration(value) {
  const seconds = Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : 0;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

Component({
  properties: {
    reference: { type: String, value: "" },
    localSrc: { type: String, value: "" },
    disabled: { type: Boolean, value: false },
    hideControl: { type: Boolean, value: false },
    embedded: { type: Boolean, value: false },
  },
  data: {
    waveBars,
    playing: false,
    loading: false,
    clipRight: 100,
    durationText: "00:00",
  },
  observers: {
    "reference, localSrc"() {
      this.stopAudio(true);
      this.scheduleMetadataLoad();
    },
  },
  lifetimes: {
    attached() {
      this.mediaAlive = true;
      this.scheduleMetadataLoad();
    },
    detached() {
      this.mediaAlive = false;
      this.stopAudio(false);
      this.stopMetadataAudio();
    },
  },
  pageLifetimes: {
    hide() { this.pauseFromPeer(); },
  },
  methods: {
    scheduleMetadataLoad() {
      if (typeof wx === "undefined" || typeof wx.nextTick !== "function") return;
      wx.nextTick(() => {
        if (this.mediaAlive) void this.prepareAudioMetadata();
      });
    },
    stopMetadataAudio() {
      this.metadataRequest = null;
      if (this.metadataTimer) clearTimeout(this.metadataTimer);
      this.metadataTimer = null;
      const audio = this.metadataAudio;
      this.metadataAudio = null;
      if (audio) {
        try { audio.stop(); } catch {}
        try { audio.destroy(); } catch {}
      }
    },
    async prepareAudioMetadata() {
      const reference = String(this.data.reference || "").trim();
      const localSrc = String(this.data.localSrc || "").trim();
      if (!reference && !localSrc) return;
      this.stopMetadataAudio();
      const request = this.metadataRequest = {};
      try {
        const url = localSrc || sg.mediaDisplayUrl(reference, await sg.mediaLinks([reference]));
        if (!this.mediaAlive || this.metadataRequest !== request || !url) return;
        const audio = wx.createInnerAudioContext();
        this.metadataAudio = audio;
        audio.volume = 0;
        let settled = false;
        const cleanup = () => {
          if (this.metadataTimer) clearTimeout(this.metadataTimer);
          this.metadataTimer = null;
          if (this.metadataAudio === audio) this.metadataAudio = null;
          try { audio.stop(); } catch {}
          try { audio.destroy(); } catch {}
        };
        const finish = () => {
          if (settled) return;
          const duration = Number(audio.duration) || 0;
          if (!(duration > 0)) return;
          settled = true;
          if (this.mediaAlive && this.metadataRequest === request) {
            const durationText = formatDuration(duration);
            this.setData({ durationText, clipRight: 100 });
            this.triggerEvent('durationchange', { duration: durationText, seconds: duration });
          }
          cleanup();
        };
        const fail = () => {
          if (settled) return;
          settled = true;
          cleanup();
        };
        audio.onCanplay(finish);
        audio.onTimeUpdate(finish);
        audio.onError(fail);
        audio.src = url;
        audio.play();
        this.metadataTimer = setTimeout(fail, 6000);
      } catch {
        this.stopMetadataAudio();
      }
    },
    async toggleAudio() {
      if (!this.mediaAlive || this.data.disabled) return;
      const reference = String(this.data.reference || "").trim();
      const localSrc = String(this.data.localSrc || "").trim();
      const sourceKey = localSrc || reference;
      if (!sourceKey) return;
      if (this.audio && this.audioKey === sourceKey) {
        if (this.data.playing) {
          this.audio.pause();
          return;
        }
        if (activePlayer && activePlayer !== this) activePlayer.pauseFromPeer();
        activePlayer = this;
        this.audio.play();
        return;
      }
      await this.startAudio(reference, localSrc, sourceKey);
    },
    async startAudio(reference, localSrc, sourceKey) {
      const request = this.request = {};
      this.setData({ loading: true });
      try {
        const url = localSrc || sg.mediaDisplayUrl(reference, await sg.mediaLinks([reference]));
        if (!this.mediaAlive || this.request !== request) return;
        if (!url) throw new Error("音频暂时无法播放");
        this.stopAudio(false);
        this.request = request;
        if (activePlayer && activePlayer !== this) activePlayer.pauseFromPeer();
        const audio = wx.createInnerAudioContext();
        this.audio = audio;
        this.audioKey = sourceKey;
        activePlayer = this;
        audio.onPlay(() => {
          if (this.mediaAlive && this.audio === audio) {
            this.setData({ playing: true, loading: false });
            this.triggerEvent('statechange', { playing: true });
          }
        });
        audio.onPause(() => {
          if (!this.mediaAlive || this.audio !== audio) return;
          if (activePlayer === this) activePlayer = null;
          this.setData({ playing: false });
          this.triggerEvent('statechange', { playing: false });
        });
        audio.onCanplay(() => this.updateTimeline());
        audio.onTimeUpdate(event => this.updateTimeline(event));
        audio.onEnded(() => {
          if (!this.mediaAlive || this.audio !== audio) return;
          if (activePlayer === this) activePlayer = null;
          this.setData({ playing: false, clipRight: 100, loading: false });
          this.triggerEvent('statechange', { playing: false });
        });
        audio.onError(() => {
          if (!this.mediaAlive || this.audio !== audio) return;
          this.stopAudio(false);
          this.setData({ playing: false, loading: false });
          this.triggerEvent('statechange', { playing: false });
          wx.showToast({ title: "音频暂时无法播放", icon: "none" });
        });
        audio.src = url;
        audio.play();
      } catch {
        if (this.mediaAlive && this.request === request) {
          this.setData({ playing: false, loading: false, clipRight: 100 });
          wx.showToast({ title: "音频暂时无法播放", icon: "none" });
        }
      }
    },
    updateTimeline(event) {
      const audio = this.audio;
      if (!this.mediaAlive || !audio) return;
      const duration = Number((event && event.duration) || audio.duration || 0);
      const currentTime = Number((event && event.currentTime) || audio.currentTime || 0);
      if (duration > 0 && Math.abs(duration - Number(this.lastDurationValue || 0)) > 0.25) {
        this.lastDurationValue = duration;
        this.triggerEvent('durationchange', { duration: formatDuration(duration), seconds: duration });
      }
      this.setData({
        durationText: formatDuration(duration),
        clipRight: duration > 0 ? Math.max(0, 100 - Math.min(1, currentTime / duration) * 100) : 100,
      });
    },
    pauseFromPeer() {
      if (this.audio) this.audio.pause();
      if (activePlayer === this) activePlayer = null;
      if (this.mediaAlive) this.setData({ playing: false, loading: false });
    },
    stopAudio(reset) {
      this.request = null;
      const audio = this.audio;
      this.audio = null;
      this.audioKey = "";
      if (activePlayer === this) activePlayer = null;
      if (audio) {
        audio.stop();
        audio.destroy();
      }
      if (reset && this.mediaAlive) {
        this.setData({ playing: false, loading: false, clipRight: 100, durationText: "00:00" });
      }
    },
  },
});
