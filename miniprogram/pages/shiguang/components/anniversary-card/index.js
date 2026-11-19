Component({
  properties: { slides: { type: Array, value: [] }, current: Number, touchDisabled: Boolean },
  methods: {
    change(event) {
      if (event.detail.source === 'touch') this.triggerEvent('slidechange', event.detail);
    },
    manage() { this.triggerEvent('manage'); },
  },
});
