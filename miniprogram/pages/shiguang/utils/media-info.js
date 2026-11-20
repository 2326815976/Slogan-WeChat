function formatVideoDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return '';
  const seconds = Math.max(1, Math.round(duration));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function getVideoMetadata(src, fallback = "16 / 9") {
  if (!src) return Promise.resolve({ aspectRatio: fallback, durationText: '' });
  return new Promise(resolve => {
    wx.getVideoInfo({
      src,
      success(info) {
        const width = Number(info && info.width);
        const height = Number(info && info.height);
        resolve({
          aspectRatio: width > 0 && height > 0 ? `${width} / ${height}` : fallback,
          durationText: formatVideoDuration(info && info.duration),
        });
      },
      fail() { resolve({ aspectRatio: fallback, durationText: '' }); },
    });
  });
}

async function getVideoAspectRatio(src, fallback = "16 / 9") {
  return (await getVideoMetadata(src, fallback)).aspectRatio;
}

module.exports = { getVideoAspectRatio, getVideoMetadata };
