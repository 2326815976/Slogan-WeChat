const sg = require('../../services/shiguang');
const DRAW_KEY = JSON.stringify(['draw', {}]);
const SECTIONS = [
  { id: 'wheel', label: '转盘抽奖' },
  { id: 'cards', label: '我的卡券' },
];

Page({
  data: {
    sections: SECTIONS, section: 'wheel', loaded: false,
    summary: null, pool: [], canDraw: false, retryDraw: false, own: [], cards: [], tickets: [], grants: [],
    balance: 0, partnerBalance: 0, partnerName: '', angle: 0, gradient: '#FBEFCB', amount: '1',
    form: '', formTitle: '', name: '', content: '', image: '', imageUrl: '', editing: null, detail: null,
    busy: false, message: '', error: '', ticketMore: false,
    grantHistoryOpen: false, grantLoading: false, grantError: '', grantMore: false,
  },
  onLoad(options) {
    this.requests = new Map();
    if (['cards', 'gifts', 'history'].includes(options?.section)) this.setData({ section: 'cards' });
  },
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
    if (resource === 'grants') return items.map(item => ({ ...item, giver: name(item.giverId), receiver: name(item.receiverId), time: sg.time(item.createdAt) }));
    return items.map(item => {
      const own = item.providerId === summary.userId;
      const sentGift = item.source === 'gift' && own;
      const sourceLabel = item.source === 'draw'
        ? '抽奖获得'
        : sentGift ? `已赠给 ${name(item.holderId)}` : `收到 ${name(item.providerId)} 的赠送`;
      return { ...item, imageUrl: links[item.image] || '', sentGift, sourceLabel,
        time: sg.time(item.obtainedAt), usedTime: sg.time(item.usedAt), canRedeem: own && item.status === 'unused' };
    });
  },
  async load({ background = false } = {}) {
    const loading = {};
    this.loading = loading;
    const preserveHistory = (section, page) => background && this.data.section === section && page > 0;
    try {
      const [summary, prizes, cards, tickets] = await Promise.all([
        sg.api(), sg.api('/prizes'), sg.api('/gift-cards'),
        preserveHistory('cards', this.ticketsPage) ? null : sg.api('/tickets?page=0'),
      ]);
      if (this.loading !== loading) return;
      const partner = summary.space.members.find(member => member.userId !== summary.userId);
      const balance = summary.balances[summary.userId] || 0;
      this.setData({ summary, balance, partnerName: partner.name, partnerBalance: summary.balances[partner.userId] || 0 });

      const pendingCards = cards.items.filter(item => item.providerId === summary.userId);
      const links = await sg.mediaLinks([...prizes.items, ...pendingCards, ...(tickets?.items || [])].map(item => item.image));
      if (this.loading !== loading) return;
      const offering = item => ({ ...item, imageUrl: links[item.image] || '',
        own: item.providerId === summary.userId,
      });
      const prizeItems = prizes.items.map(offering);
      const pool = prizeItems.filter(item => !item.own).map((item, index, list) => ({
        ...item, labelStyle: `transform:rotate(${(index + .5) * 360 / list.length - 90}deg) translateX(20rpx)`,
      }));
      const colors = ['#FFE2AE', '#F6C6C6', '#DCE7D1', '#FBEFCB'];
      const segments = pool.map((item, index) => `${colors[index % 4]} ${index * 100 / pool.length}% ${(index + 1) * 100 / pool.length}%`);
      const history = {};
      if (tickets && !preserveHistory('cards', this.ticketsPage)) {
        this.ticketsPage = 0;
        history.tickets = this.historyItems('tickets', tickets.items, summary, links);
        history.ticketMore = tickets.hasMore;
      }
      this.setData({ pool, own: prizeItems.filter(item => item.own), cards: pendingCards.map(offering), loaded: true,
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
  openGrantHistory() {
    if (this.data.busy || !this.data.summary) return;
    this.setData({ grantHistoryOpen: true });
    return this.loadGrantHistory();
  },
  closeGrantHistory() { this.setData({ grantHistoryOpen: false }); },
  moreGrants() { return this.loadGrantHistory(this.data.grants.length ? this.grantsPage + 1 : 0); },
  async loadGrantHistory(page = 0) {
    const { summary, grantLoading } = this.data;
    if (!summary || grantLoading) return;
    this.setData({ grantLoading: true, grantError: '', ...(page ? {} : { grants: [], grantMore: false }) });
    try {
      const result = await sg.api(`/grants?page=${page}`);
      const items = this.historyItems('grants', result.items, summary, {});
      this.grantsPage = page;
      this.setData({ grants: page ? this.data.grants.concat(items) : items, grantMore: result.hasMore });
    } catch (error) {
      this.setData({ grantError: error.message || '加载失败，请重试' });
      if ([401, 403].includes(error.statusCode)) sg.fail(this, error);
    } finally { this.setData({ grantLoading: false }); }
  },
  openDetails(event) {
    if (this.data.busy) return;
    const { resource, id } = event.currentTarget.dataset;
    const { cards, own, pool, tickets } = this.data;
    const records = resource === 'tickets' ? tickets : resource === 'gift-cards' ? cards : [...own, ...pool];
    const item = records.find(record => record.id === id);
    if (item) this.setData({ detail: { resource, item }, error: '' });
  },
  closeDetails() { if (!this.data.busy) this.setData({ detail: null, error: '' }); },
  openForm(event) {
    if (this.data.busy) return;
    const { mode, id } = event.currentTarget.dataset;
    const records = mode === 'gift-cards' ? this.data.cards : this.data.own;
    const record = id ? records.find(item => item.id === id && item.own) : null;
    if (id && !record) return;
    this.recordId = record ? record.id : sg.uuid();
    this.setData({ detail: null, form: mode, formTitle: `${record ? '编辑' : '新增'}${mode === 'gift-cards' ? '卡券' : '奖项'}`,
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
          message: `抽中了「${result.name}」，已放入「我的卡券」。`,
        });
        if (index >= 0) spin = new Promise(resolve => setTimeout(resolve, 2500));
      } else {
        this.setData({ message: operation === 'grant' ? '抽奖次数已送达' : operation === 'send-card' ? '心意已送达' : '已记录兑现时间' });
      }
      if (operation === 'grant') this.setData({ form: '', editing: null });
      if (operation === 'send-card' || operation === 'redeem') this.setData({ detail: null });
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
    const { detail, summary, busy } = this.data;
    if (busy || detail?.resource !== 'gift-cards' || detail.item.id !== event.currentTarget.dataset.id || !detail.item.own) return;
    const card = detail.item;
    if (await sg.confirm(`确认把「${card.name}」送给 ${this.memberName(summary, card.holderId)}？送出后不可编辑或删除。`)) {
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
  async moreTickets() {
    await this.mutate(async () => {
      const page = this.ticketsPage + 1;
      const result = await sg.api(`/tickets?page=${page}`);
      const links = await sg.mediaLinks(result.items.map(item => item.image));
      const items = this.historyItems('tickets', result.items, this.data.summary, links);
      this.ticketsPage = page;
      this.setData({ tickets: this.data.tickets.concat(items), ticketMore: result.hasMore });
    });
  },
});
