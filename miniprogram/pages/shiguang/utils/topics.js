const topicPattern = /#([^\s#，。！？、,.!?;:：；（）()\[\]{}<>《》]{1,30})/g;

function cleanTopic(value) {
  return String(value || '').trim().replace(/#+/g, '').replace(/[\s%_\\]+/g, '').slice(0, 30);
}

function topicSegments(content) {
  const source = String(content || '');
  if (!source) return [];
  const segments = [];
  let cursor = 0;
  let match;
  while ((match = topicPattern.exec(source))) {
    const index = match.index;
    const topic = cleanTopic(match[1]);
    if (!topic) continue;
    if (index > cursor) segments.push({ text: source.slice(cursor, index) });
    segments.push({ text: `#${topic}`, topic });
    cursor = index + match[0].length;
  }
  topicPattern.lastIndex = 0;
  if (cursor < source.length) segments.push({ text: source.slice(cursor) });
  return (segments.length ? segments : [{ text: source }]).map((item, index) => ({ ...item, index }));
}

function extractTopics(content) {
  return [...new Set(topicSegments(content).map(item => item.topic).filter(Boolean))];
}

function firstTopic(content) {
  return extractTopics(content)[0] || '';
}

module.exports = { cleanTopic, topicSegments, extractTopics, firstTopic };
