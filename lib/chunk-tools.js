const last = require('./last-array');

const samplesToChunks = (samples) => {
  return samples.reduce((a, e) => {
    const lastChunk = last(a);
    if (!lastChunk ||
        (lastChunk.offset + lastChunk.length) !== e.offset ||
        lastChunk.mdatIndex !== e.mdatIndex ||
        lastChunk.type !== e.type) {
      a.push({
        type: e.type,
        offset: e.offset,
        length: e.length,
        duration: e.type === 'ADTS' ? e.duration : 0,
        mdatIndex: e.mdatIndex,
        samples: [e],
      });
    } else {
      lastChunk.length += e.length;
      lastChunk.duration += e.type === 'ADTS' ? e.duration : 0;
      lastChunk.samples.push(e);
    }
    return a;
  }, []);
};

const splitChunks = (chunks) => {
  return {
    audio: chunks.filter(e => e.type === 'ADTS'),
    video: chunks.filter(e => e.type === 'AVCC'),
  };
};

const spreadAudioDurationToVideo = (chunks) => {
  let lastDuration = 0;
  return chunks.map(e => {
    const n = Object.assign({}, e);
    if (n.type === 'ADTS') {
      lastDuration += n.duration;
    } else {
      n.duration = lastDuration;
      const durationPerSample = Math.round(lastDuration / e.samples.length);
      n.samples = e.samples.map(es => {
        const ns = Object.assign({}, es);
        ns.duration = durationPerSample;
        return ns;
      });
      lastDuration = 0;
    }
    return n;
  });
};

const chunksToSTTS = (chunks) => {
  return chunks.reduce((a, e) => {
    e.samples.forEach(es => {
      const lastChunk = last(a);
      if (!lastChunk || es.duration !== lastChunk.sampleDelta) {
        a.push({
          sampleCount: 1,
          sampleDelta: es.duration
        });
      } else {
        lastChunk.sampleCount += 1;
      }
    });
    return a;
  }, []);
};

const chunksToSTSC = (chunks) => {
  return chunks.reduce((a, e, i) => {
    const lastChunk = last(a);
    if (!lastChunk || e.samples.length !== lastChunk.samplesPerChunk) {
      a.push({
        firstChunk: i + 1,
        samplesPerChunk: e.samples.length,
        sampleDescriptionIndex: 1,
      });
    }
    return a;
  }, []);
};

const chunksToSTSZ = (chunks) => {
  return chunks.reduce((a, e) => {
    e.samples.forEach(es => {
        a.push(es.length);
    });
    return a;
  }, []);
};

const chunksToSTCO = (chunks) => {
  return chunks.reduce((a, e) => {
    a.push(e.offset);
    return a;
  }, []);
};

const chunksToSTSS = (chunks) => {
  let globalIndex = 0;
  return chunks.reduce((a, e) => {
    e.samples.forEach(es => {
      if (es.isSync) {
        a.push(globalIndex);
      }
      globalIndex++;
    });
    return a;
  }, []);
};

const chunksToDuration = (chunks) => chunks.reduce((a, e) => a + e.duration, 0);
const maxChunkOffset = (chunks) => chunks.reduce((m, e) => Math.max(m, e.offset), 0);

module.exports = {
  samplesToChunks,
  splitChunks,
  spreadAudioDurationToVideo,
  chunksToSTTS,
  chunksToSTSC,
  chunksToSTSZ,
  chunksToSTCO,
  chunksToSTSS,
  chunksToDuration,
  maxChunkOffset,
};