const sg = require('../../services/shiguang');
const DRAW_KEY = JSON.stringify(['draw', {}]);
const SECTIONS = [
  { id: 'wheel', label: '转盘抽奖' },
  { id: 'gifts', label: '赠送卡券' },
  { id: 'history', label: '奖券记录' },
];

Page({
  data: {
    sections: SECTIONS, section: 'wheel', loaded: false,
    summary: null, pool: [], canDraw: false, retryDraw: false, own: [], cards: [], tickets: [], grants: [],
    balance: 0, partnerBalance: 0, partnerName: '', angle: 0, gradient: '#FBEFCB', amount: '1',
    form: '', formTitle: '', name: '', content: '', image: '', imageUrl: '', editing: null,
    busy: false, message: '', error: '', ticketMore: false, grantMore: false,
  },
  onLoad() { this.requests = new Map(); },
  onShow() {
    if (!this.data.busy) this.load();
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (!this.data.busy && !this.loading) this.load({ background: true });
    }, 5000);
  },
  onHide() { clearInterval(this.timer); }, onUnload() { clearInterval(this.timer); },
  memberName(summary, id) {
    return summary.space.members.find(member => member.userId === id)?.name || '成员';
  },
  historyItems(resource, items, summary, links) {
    const name = id => this.memberName(summary, id);
    return items.map(item => resource === 'tickets' ? {
      ...item, imageUrl: links[item.image] || '', provider: name(item.providerId), holder: name(item.holderId),
      time: sg.time(item.obtainedAt), usedTime: sg.time(item.usedAt), canRedeem: item.providerId === summary.userId && item.status === 'unused',
    } : { ...item, giver: name(item.giverId), receiver: name(item.receiverId), time: sg.time(item.createdAt) });
  },
  async load({ background = false } = {}) {
    const loading = {};
    this.loading = loading;
    const preserveHistory = page => background && this.data.section === 'history' && page > 0;
    try {
      const [summary, prizes, cards, tickets, grants] = await Promise.all([
        sg.api(), sg.api('/prizes'), sg.api('/gift-cards'),
        preserveHistory(this.ticketsPage) ? null : sg.api('/tickets?page=0'),
        preserveHistory(this.grantsPage) ? null : sg.api('/grants?page=0'),
      ]);
      if (this.loading !== loading) return;
      const partner = summary.space.members.find(member => member.userId !== summary.userId);
      const balance = summary.balances[summary.userId] || 0;
      this.setData({ summary, balance, partnerName: partner.name, partnerBalance: summary.balances[partner.userId] || 0 });

      const links = await sg.mediaLinks([...prizes.items, ...cards.items, ...(tickets?.items || [])].map(item => item.image));
      if (this.loading !== loading) return;
      const offering = item => ({ ...item, imageUrl: links[item.image] || '', time: sg.time(item.createdAt),
        provider: this.memberName(summary, item.providerId), recipient: this.memberName(summary, item.drawerId || item.holderId),
        own: item.providerId === summary.userId,
      });
      const prizeItems = prizes.items.map(offering);
      const pool = prizeItems.filter(item => !item.own).map((item, index, list) => ({
        ...item, labelStyle: `transform:rotate(${(index + .5) * 360 / list.length - 90}deg) translateX(20rpx)`,
      }));
      const colors = ['#FFE2AE', '#F6C6C6', '#DCE7D1', '#FBEFCB'];
      const segments = pool.map((item, index) => `${colors[index % 4]} ${index * 100 / pool.length}% ${(index + 1) * 100 / pool.length}%`);
      const history = {};
      if (tickets && !preserveHistory(this.ticketsPage)) {
        this.ticketsPage = 0;
        history.tickets = this.historyItems('tickets', tickets.items, summary, links);
        history.ticketMore = tickets.hasMore;
      }
      if (grants && !preserveHistory(this.grantsPage)) {
        this.grantsPage = 0;
        history.grants = this.historyItems('grants', grants.items, summary, links);
        history.grantMore = grants.hasMore;
      }
      this.setData({ pool, own: prizeItems.filter(item => item.own), cards: cards.items.map(offering), loaded: true,
        canDraw: pool.length > 0, gradient: pool.length ? `conic-gradient(${segments.join(',')})` : '#FBEFCB',
        ...history,
      });
    } catch (error) { if (this.loading === loading) sg.fail(this, error); }
    finally { if (this.loading === loading) this.loading = null; }
  },
  selectSection(event) {
    const { section } = event.currentTarget.dataset;
    if (section !== this.data.section && !this.data.busy) this.setData({ section, message: '' });
  },
  input(event) { this.setData({ [event.currentTarget.dataset.key]: event.detail.value }); },
  openGrant() {
    if (!this.data.busy && this.data.summary) this.setData({ form: 'grant', formTitle: '赠送抽奖次数', amount: '1', error: '' });
  },
  openForm(event) {
    if (this.data.busy) return;
    const { mode, id } = event.currentTarget.dataset;
    const records = mode === 'gift-cards' ? this.data.cards : this.data.own;
    const record = id ? records.find(item => item.id === id && item.own) : null;
    if (id && !record) return;
    this.recordId = record ? record.id : sg.uuid();
    this.setData({ form: mode, formTitle: `${record ? '编辑' : '新增'}${mode === 'gift-cards' ? '卡券' : '奖项'}`,
      editing: record, name: record?.name || '', content: record?.content || '', image: record?.image || '', imageUrl: record?.imageUrl || '', error: '',
    });
  },
  cancel() { if (!this.data.busy) this.setData({ form: '', editing: null, error: '' }); },
  clearImage() { if (!this.data.busy) this.setData({ image: '', imageUrl: '' }); },
  async mutate(work) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '', message: '' });
    try { await work(); }
    catch (error) { if (!String(error.errMsg || '').includes('cancel')) sg.fail(this, error); }
    finally { this.setData({ busy: false }); }
  },
  chooseImage() {
    return this.mutate(async () => {
      const file = await sg.chooseImage();
      this.setData({ image: await sg.upload(file), imageUrl: file });
    });
  },
  async action(operation, data = {}) {
    await this.mutate(async () => {
      const key = JSON.stringify([operation, data]);
      const requestId = this.requests.get(key) || sg.uuid();
      this.requests.set(key, requestId);
      let result;
      try {
        result = await sg.api('/actions', 'POST', { operation, requestId, ...data });
        this.requests.delete(key);
      } catch (error) {
        if (error.statusCode === 409) this.requests.delete(key);
        throw error;
      } finally { this.setData({ retryDraw: this.requests.has(DRAW_KEY) }); }
      let spin;
      if (operation === 'draw') {
        const { pool, angle } = this.data;
        const index = pool.findIndex(item => item.id === result.prizeId);
        this.setData({
          angle: index < 0 ? angle : Math.ceil(angle / 360) * 360 + 1800 - (index + .5) * 360 / pool.length,
          message: `抽中了「${result.name}」，已经放入你的奖券。`,
        });
        if (index >= 0) spin = new Promise(resolve => setTimeout(resolve, 2500));
      } else {
        this.setData({ message: operation === 'grant' ? '抽奖次数已送达' : operation === 'send-card' ? '心意已送达' : '已记录兑现时间' });
      }
      if (operation === 'grant' || (operation === 'send-card' && this.data.editing?.id === data.cardId)) this.setData({ form: '', editing: null });
      await Promise.all([this.load(), spin]);
    });
  },
  draw() { if (this.data.retryDraw || (this.data.balance > 0 && this.data.canDraw)) return this.action('draw'); },
  grant() { return this.action('grant', { amount: Number(this.data.amount) }); },
  async redeem(event) {
    const ticketId = event.currentTarget.dataset.id;
    if (!this.data.busy && await sg.confirm('确认已经为对方兑现这张券？')) return this.action('redeem', { ticketId });
  },
  async sendCard(event) {
    const card = this.data.cards.find(item => item.id === event.currentTarget.dataset.id && item.own);
    if (card && !this.data.busy && await sg.confirm(`确认把「${card.name}」送给 ${card.recipient}？送出后不可编辑或删除。`)) {
      return this.action('send-card', { cardId: card.id, version: card.version });
    }
  },
  save() {
    const { form, editing, name, content, image } = this.data;
    if (!form) return;
    return this.mutate(async () => {
      await sg.api(`/${form}${editing ? `/${editing.id}` : ''}`, editing ? 'PUT' : 'POST', { id: this.recordId, version: editing?.version, name, content, image });
      this.setData({ form: '', editing: null, message: editing ? '修改已保存' : form === 'gift-cards' ? '卡券已创建，可稍后赠送' : '奖项已创建' });
      await this.load();
    });
  },
  async remove(event) {
    const { mode, id } = event.currentTarget.dataset;
    const records = mode === 'gift-cards' ? this.data.cards : this.data.own;
    const record = records.find(item => item.id === id && item.own);
    if (!record || this.data.busy || !await sg.confirm(mode === 'gift-cards' ? '删除这张待赠卡券？' : '删除这个奖项？已获得的券会保留。')) return;
    await this.mutate(async () => {
      await sg.api(`/${mode}/${id}`, 'DELETE', { version: record.version });
      if (this.data.editing?.id === id) this.setData({ form: '', editing: null });
      await this.load();
    });
  },
  async more(event) {
    const resource = event.currentTarget.dataset.resource;
    await this.mutate(async () => {
      const page = this[`${resource}Page`] + 1;
      const result = await sg.api(`/${resource}?page=${page}`);
      const links = resource === 'tickets' ? await sg.mediaLinks(result.items.map(item => item.image)) : {};
      const items = this.historyItems(resource, result.items, this.data.summary, links);
      this[`${resource}Page`] = page;
      this.setData({ [resource]: this.data[resource].concat(items), [resource === 'tickets' ? 'ticketMore' : 'grantMore']: result.hasMore });
    });
  },
});
