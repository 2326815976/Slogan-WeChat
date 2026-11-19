const sg = require('../../services/shiguang');

function pageCount(result, count = result?.items.length || 0) {
  return result ? `${count}${result.hasMore ? '+' : ''}` : '';
}

function whisperPreview(entry, summary, empty) {
  if (!entry) return { text: empty };
  const member = summary.space.members.find(item => item.userId === entry.createdBy);
  const { content, title, audio, image, video } = entry.payload;
  const references = { image, video, audio };
  const mediaKinds = Object.keys(references).filter(kind => references[kind]);
  const single = mediaKinds.length === 1 ? mediaKinds[0] : '';
  return {
    text: content || title || '',
    mediaKinds,
    single,
    reference: single ? references[single] : '',
    thumbnail: single === 'image' ? `${image}?variant=preview` : '',
    imageUrl: '',
    author: member?.name || '成员',
    time: sg.time(entry.createdAt).slice(0, 16),
  };
}

async function loadHomePreview(summary) {
  const [wishes, promises, whispers, tickets] = await Promise.all(
    ['wish', 'promise', 'whisper', 'tickets'].map(kind => sg.api(`/${kind}`).catch(() => null)),
  );
  return {
    wishes: (wishes?.items || []).slice(0, 3).map(entry => ({
      id: entry.id,
      name: entry.payload.content || entry.payload.name || entry.payload.title || '一个愿望',
      fulfilled: entry.payload.status === 'fulfilled',
    })),
    wishCount: pageCount(wishes),
    wishEmpty: wishes ? '还没有愿望' : '暂时无法加载',
    fulfilledCount: pageCount(wishes, wishes?.items.filter(entry => entry.payload.status === 'fulfilled').length),
    promises: (promises?.items || []).slice(0, 3).map(({ id, payload }) => ({
      id,
      title: payload.title || payload.name || '一条心约',
    })),
    promiseEmpty: promises ? '还没有心约' : '暂时无法加载',
    promiseCount: pageCount(promises),
    whispers: {
      latest: whisperPreview(whispers?.items[0], summary, whispers ? '还没有絮语' : '暂时无法加载'),
      mine: whisperPreview(whispers?.items.find(entry => entry.createdBy === summary.userId), summary, whispers ? '近期没有我的絮语' : '暂时无法加载'),
    },
    ticketCount: pageCount(tickets, tickets?.items.filter(ticket => ticket.holderId === summary.userId).length),
  };
}

async function loadWhisperImages({ latest, mine }) {
  if (!latest.thumbnail && !mine.thumbnail) return null;
  const links = await sg.mediaLinks([latest.thumbnail, mine.thumbnail].filter(Boolean));
  return {
    latest: sg.mediaDisplayUrl(latest.thumbnail, links),
    mine: sg.mediaDisplayUrl(mine.thumbnail, links),
  };
}

module.exports = { loadHomePreview, loadWhisperImages };
