Component({
  properties: { title: String, subtitle: String, busy: Boolean, compact: Boolean },
  methods: {
    close() { if (!this.data.busy) this.triggerEvent('close'); },
    keepBackgroundStill() {},
  },
});
