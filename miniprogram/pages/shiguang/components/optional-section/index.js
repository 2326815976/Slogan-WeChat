Component({
  properties: {
    label: { type: String, value: '更多信息（选填）' },
    filled: { type: Boolean, value: false },
    status: { type: String, value: '' },
    variant: { type: String, value: 'default' },
  },
  data: { open: false },
  methods: {
    toggle() {
      this.setData({ open: !this.data.open });
    },
  },
});
