const { updateAdminUserNote } = require("../../services/photo-admin-api");

Component({
  // 让操作按钮参与父级同一行布局，并单向接收管理页已有的按钮、弹窗样式。
  options: { virtualHost: true, styleIsolation: "apply-shared" },
  properties: {
    userId: String,
    userName: String,
    note: String,
    disabled: Boolean,
  },
  data: { open: false, text: "", saving: false, error: "" },
  methods: {
    openEditor() {
      if (this.properties.disabled || this.data.saving) return;
      this.setData({ open: true, text: this.properties.note || "", error: "" });
    },
    closeEditor() {
      if (!this.data.saving) this.setData({ open: false });
    },
    stopTap() {},
    onInput(event) {
      this.setData({ text: String(event.detail.value || ""), error: "" });
    },
    async saveNote() {
      if (this.data.saving || this.properties.disabled) return;
      const note = this.data.text.replace(/\r\n/g, "\n").trim();
      if (note.length > 500) {
        this.setData({ error: "备注最多 500 个字符" });
        return;
      }
      this.setData({ saving: true, error: "" });
      try {
        await updateAdminUserNote(this.properties.userId, note);
        // 保存成功后同步父级列表，失败时保留草稿供重试。
        this.triggerEvent("saved", { userId: this.properties.userId, note });
        this.setData({ open: false });
        wx.showToast({ title: note ? "备注已保存" : "备注已清空", icon: "success" });
      } catch (error) {
        this.setData({ error: String((error && error.message) || "保存备注失败，请重试") });
      } finally {
        this.setData({ saving: false });
      }
    },
  },
});
